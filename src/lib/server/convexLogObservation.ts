import { createHmac, timingSafeEqual } from "node:crypto";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { suppressTracing } from "@sentry/node";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_BATCH_RECORDS = 500;
const MAX_PAST_SKEW_MS = 5 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;
const MAX_SENTRY_RESPONSE_BYTES = 8 * 1024;
const SENTRY_TIMEOUT_MS = 2_000;
const OBSERVATION_PATH = "/api/internal/convex-log-observation";
const OBSERVATION_SCHEMA = "shipment-drain-v1";
const SERVICE_NAME = "angelsrest-convex-observation";
const SENTRY_HOST_PATTERN = /^o\d+\.ingest(?:\.[a-z0-9-]+)?\.sentry\.io$/u;
const SENTRY_PATH_PATTERN = /^\/api\/[1-9]\d*\/integration\/otlp\/v1\/logs$/u;
const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/u;

type ObservationEnvironment = "canary" | "production";
type ConvexFunctionType = "query" | "mutation";
type ConvexStatus = "success" | "failure";
type ObservationCohort =
	| "global_v1"
	| "site_admin_v1"
	| "lookup"
	| "v2"
	| "health"
	| "verification";

const observedFunctions = {
	"orders:claimShipmentEmailNotificationByOrderNumber": {
		cohort: "global_v1",
		type: "mutation",
	},
	"orders:recordShipmentEmailDeliveryByOrderNumber": {
		cohort: "global_v1",
		type: "mutation",
	},
	"orders:claimShipmentEmailNotification": {
		cohort: "site_admin_v1",
		type: "mutation",
	},
	"orders:recordShipmentEmailDelivery": {
		cohort: "site_admin_v1",
		type: "mutation",
	},
	"orders:getByLumaprintsOrderNumber": { cohort: "lookup", type: "query" },
	"orders:claimShipmentEmailNotificationV2": { cohort: "v2", type: "mutation" },
	"orders:authorizeShipmentEmailNotificationSendV2": {
		cohort: "v2",
		type: "mutation",
	},
	"orders:completeShipmentEmailNotificationV2": { cohort: "v2", type: "mutation" },
	"orders:releaseShipmentEmailNotificationV2": { cohort: "v2", type: "mutation" },
	"orders:isShipmentEmailNotificationDeliveryUncertain": {
		cohort: "v2",
		type: "mutation",
	},
	"content:getPublishedSiteSettingsWithRevision": { cohort: "health", type: "query" },
} as const satisfies Record<
	string,
	{ cohort: Exclude<ObservationCohort, "verification">; type: ConvexFunctionType }
>;

export type ConvexLogObservationConfig = {
	hmacSecret: string | undefined;
	sentryOtlpLogsEndpoint: string | undefined;
	sentryPublicKey: string | undefined;
	environment: string | undefined;
};

type ProjectedRecord = {
	body: "convex.function_execution" | "convex.verification";
	severityNumber: 9 | 17;
	severityText: "INFO" | "ERROR";
	cohort: ObservationCohort;
	bucketStart: string;
	functionPath?: keyof typeof observedFunctions;
	functionType?: ConvexFunctionType;
	status?: ConvexStatus;
	mutationRetryCount?: number;
};

type SentryOtlpRequest = {
	endpoint: URL;
	publicKey: string;
	body: Uint8Array;
};

type SentryOtlpResult = "success" | "retryable_failure" | "protocol_failure";
type SentryOtlpTransport = (request: SentryOtlpRequest) => Promise<SentryOtlpResult>;
type NodeRequest = (
	url: URL,
	options: RequestOptions,
	callback: (response: IncomingMessage) => void,
) => ClientRequest;

type ObservationDependencies = {
	now?: () => number;
	transport?: SentryOtlpTransport;
	nodeRequest?: NodeRequest;
};

type ValidConfig = {
	hmacSecret: string;
	endpoint: URL;
	publicKey: string;
	environment: ObservationEnvironment;
};

type ParsedBatch =
	| { kind: "ok"; records: ProjectedRecord[] }
	| { kind: "invalid" }
	| { kind: "expired" };

type ReadBodyResult =
	| { kind: "ok"; bytes: Uint8Array }
	| { kind: "invalid" }
	| { kind: "oversized" };

/**
 * Receive one signed Convex log-stream batch and forward only the frozen,
 * minimized observation schema. Every failure is converted to a static
 * response here so the application-wide Sentry error hook never sees the
 * broad input or a provider response.
 */
export async function handleConvexLogObservationRequest(
	request: Request,
	config: ConvexLogObservationConfig,
	dependencies: ObservationDependencies = {},
): Promise<Response> {
	const url = new URL(request.url);
	if (request.method !== "POST" || url.pathname !== OBSERVATION_PATH) return staticResponse(405);
	if (url.search !== "" || url.hash !== "") return staticResponse(400);
	if (!isJsonContentType(request.headers.get("content-type"))) return staticResponse(415);
	if (request.headers.has("content-encoding")) return staticResponse(415);

	const validConfig = parseConfig(config);
	if (!validConfig) return staticResponse(503);

	const body = await readBoundedBody(request);
	if (body.kind === "oversized") return staticResponse(413);
	if (body.kind === "invalid") return staticResponse(400);
	if (!verifySignature(body.bytes, request.headers.get("x-webhook-signature"), validConfig)) {
		return staticResponse(401);
	}

	const receiptTime = dependencies.now?.() ?? Date.now();
	if (!Number.isSafeInteger(receiptTime) || receiptTime <= 0) return staticResponse(503);
	const parsed = parseAndProjectBatch(body.bytes, receiptTime);
	if (parsed.kind === "invalid") return staticResponse(400);
	if (parsed.kind === "expired") return staticResponse(403);
	if (parsed.records.length === 0) return staticResponse(200);

	const outboundBody = new TextEncoder().encode(
		JSON.stringify(serializeOtlp(parsed.records, validConfig.environment, receiptTime)),
	);
	const transport =
		dependencies.transport ??
		((input: SentryOtlpRequest) =>
			sendSentryObservationOtlp(input, dependencies.nodeRequest ?? httpsRequest));
	let result: SentryOtlpResult;
	try {
		result = await transport({
			endpoint: validConfig.endpoint,
			publicKey: validConfig.publicKey,
			body: outboundBody,
		});
	} catch {
		return staticResponse(503);
	}
	if (result === "success") return staticResponse(200);
	return staticResponse(result === "retryable_failure" ? 503 : 502);
}

/**
 * The real remote adapter. `node:https` is intentionally used instead of
 * global fetch because the installed Sentry fetch instrumentation can attach
 * trace propagation and breadcrumbs. Sentry suppression is active while the
 * Node request is created, which is the instrumentation boundary.
 */
function sendSentryObservationOtlp(
	input: SentryOtlpRequest,
	requestFunction: NodeRequest = httpsRequest,
): Promise<SentryOtlpResult> {
	return new Promise((resolve) => {
		let settled = false;
		let outgoing: ClientRequest | undefined;
		let deadline: ReturnType<typeof setTimeout> | undefined;
		const finish = (result: SentryOtlpResult) => {
			if (settled) return;
			settled = true;
			if (deadline !== undefined) clearTimeout(deadline);
			resolve(result);
		};
		deadline = setTimeout(() => {
			outgoing?.destroy();
			finish("retryable_failure");
		}, SENTRY_TIMEOUT_MS);
		try {
			outgoing = suppressTracing(() =>
				requestFunction(
					input.endpoint,
					{
						method: "POST",
						headers: {
							Accept: "application/json",
							"Content-Length": String(input.body.byteLength),
							"Content-Type": "application/json",
							"X-Sentry-Auth": `sentry sentry_key=${input.publicKey}`,
						},
					},
					(response) => handleSentryResponse(response, finish),
				),
			);
		} catch {
			finish("retryable_failure");
			return;
		}
		outgoing.once("error", () => finish("retryable_failure"));
		outgoing.end(input.body);
	});
}

function handleSentryResponse(
	response: IncomingMessage,
	finish: (result: SentryOtlpResult) => void,
) {
	const status = response.statusCode ?? 0;
	if (status !== 200) {
		response.destroy();
		finish(status === 429 || status >= 500 ? "retryable_failure" : "protocol_failure");
		return;
	}
	if (!isJsonContentType(response.headers["content-type"] ?? null)) {
		response.destroy();
		finish("protocol_failure");
		return;
	}
	const declaredLength = response.headers["content-length"];
	if (
		declaredLength !== undefined &&
		(!/^\d+$/u.test(declaredLength) || BigInt(declaredLength) > BigInt(MAX_SENTRY_RESPONSE_BYTES))
	) {
		response.destroy();
		finish("protocol_failure");
		return;
	}
	const chunks: Buffer[] = [];
	let total = 0;
	response.on("data", (chunk: Buffer | string) => {
		const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
		total += bytes.byteLength;
		if (total > MAX_SENTRY_RESPONSE_BYTES) {
			finish("protocol_failure");
			response.destroy();
			return;
		}
		chunks.push(bytes);
	});
	response.once("aborted", () => finish("retryable_failure"));
	response.once("error", () => finish("retryable_failure"));
	response.once("end", () => {
		if (total > MAX_SENTRY_RESPONSE_BYTES) return;
		finish(
			isCompleteOtlpSuccess(Buffer.concat(chunks).toString("utf8"))
				? "success"
				: "protocol_failure",
		);
	});
}

function isCompleteOtlpSuccess(responseBody: string) {
	let value: unknown;
	try {
		value = JSON.parse(responseBody);
	} catch {
		return false;
	}
	if (!isPlainObject(value)) return false;
	const topLevelKeys = Object.keys(value);
	if (!("partialSuccess" in value)) return topLevelKeys.length === 0;
	if (topLevelKeys.some((key) => key !== "partialSuccess")) return false;
	const partial = value.partialSuccess;
	if (!isPlainObject(partial)) return false;
	if (Object.keys(partial).some((key) => key !== "rejectedLogRecords" && key !== "errorMessage")) {
		return false;
	}
	const rejected = partial.rejectedLogRecords;
	if (
		rejected !== undefined &&
		!((typeof rejected === "string" && /^0+$/u.test(rejected)) || rejected === 0)
	) {
		return false;
	}
	return partial.errorMessage === undefined || partial.errorMessage === "";
}

function parseConfig(config: ConvexLogObservationConfig): ValidConfig | null {
	if (!config.hmacSecret || config.hmacSecret.length > 4096) return null;
	if (!config.sentryPublicKey || !/^[0-9a-f]{32}$/u.test(config.sentryPublicKey)) return null;
	if (config.environment !== "canary" && config.environment !== "production") return null;
	if (!config.sentryOtlpLogsEndpoint) return null;
	const endpointAuthority = config.sentryOtlpLogsEndpoint.match(/^https:\/\/([^/]+)\//u)?.[1];
	if (!endpointAuthority || endpointAuthority.includes(":")) return null;
	let endpoint: URL;
	try {
		endpoint = new URL(config.sentryOtlpLogsEndpoint);
	} catch {
		return null;
	}
	if (
		endpoint.protocol !== "https:" ||
		endpoint.username !== "" ||
		endpoint.password !== "" ||
		endpoint.port !== "" ||
		endpoint.search !== "" ||
		endpoint.hash !== "" ||
		!SENTRY_HOST_PATTERN.test(endpoint.hostname) ||
		!SENTRY_PATH_PATTERN.test(endpoint.pathname)
	) {
		return null;
	}
	return {
		hmacSecret: config.hmacSecret,
		endpoint,
		publicKey: config.sentryPublicKey,
		environment: config.environment,
	};
}

async function readBoundedBody(request: Request): Promise<ReadBodyResult> {
	const declaredLength = request.headers.get("content-length");
	if (
		declaredLength !== null &&
		(!/^\d+$/u.test(declaredLength) || BigInt(declaredLength) > BigInt(MAX_BODY_BYTES))
	) {
		return { kind: "oversized" };
	}
	if (!request.body) return { kind: "invalid" };
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_BODY_BYTES) {
				void reader.cancel().catch(() => undefined);
				return { kind: "oversized" };
			}
			chunks.push(value);
		}
	} catch {
		return { kind: "invalid" };
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { kind: "ok", bytes };
}

function verifySignature(bytes: Uint8Array, signature: string | null, config: ValidConfig) {
	const match = signature?.match(SIGNATURE_PATTERN);
	if (!match) return false;
	const supplied = Buffer.from(match[1], "hex");
	const expected = createHmac("sha256", config.hmacSecret).update(bytes).digest();
	return timingSafeEqual(expected, supplied);
}

function parseAndProjectBatch(bytes: Uint8Array, now: number): ParsedBatch {
	let value: unknown;
	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		value = JSON.parse(text);
	} catch {
		return { kind: "invalid" };
	}
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BATCH_RECORDS) {
		return { kind: "invalid" };
	}
	const records: ProjectedRecord[] = [];
	let newestTimestamp = -1;
	for (const event of value) {
		if (!isPlainObject(event) || !isPlainObject(event.convex)) return { kind: "invalid" };
		if (typeof event.topic !== "string" || !isTimestamp(event.timestamp)) {
			return { kind: "invalid" };
		}
		if (event.timestamp > now + MAX_FUTURE_SKEW_MS) return { kind: "expired" };
		newestTimestamp = Math.max(newestTimestamp, event.timestamp);
		if (event.topic === "verification") {
			if (typeof event.message !== "string") return { kind: "invalid" };
			records.push({
				body: "convex.verification",
				severityNumber: 9,
				severityText: "INFO",
				cohort: "verification",
				bucketStart: hourBucket(event.timestamp),
			});
			continue;
		}
		if (event.topic !== "function_execution") continue;
		if (!isPlainObject(event.function) || typeof event.function.path !== "string") {
			return { kind: "invalid" };
		}
		if (!Object.hasOwn(observedFunctions, event.function.path)) continue;
		const path = event.function.path as keyof typeof observedFunctions;
		const contract = observedFunctions[path];
		if (event.function.type !== contract.type) return { kind: "invalid" };
		if (event.status !== "success" && event.status !== "failure") return { kind: "invalid" };
		let retryCount = 0;
		if (contract.type === "mutation") {
			const candidateRetryCount = event.mutation_retry_count;
			if (
				typeof candidateRetryCount !== "number" ||
				!Number.isSafeInteger(candidateRetryCount) ||
				candidateRetryCount < 0
			) {
				return { kind: "invalid" };
			}
			retryCount = candidateRetryCount;
		}
		records.push({
			body: "convex.function_execution",
			severityNumber: event.status === "failure" ? 17 : 9,
			severityText: event.status === "failure" ? "ERROR" : "INFO",
			cohort: contract.cohort,
			bucketStart: hourBucket(event.timestamp),
			functionPath: path,
			functionType: contract.type,
			status: event.status,
			mutationRetryCount: retryCount,
		});
	}
	if (newestTimestamp < now - MAX_PAST_SKEW_MS) return { kind: "expired" };
	return { kind: "ok", records };
}

function serializeOtlp(
	records: ProjectedRecord[],
	environment: ObservationEnvironment,
	receiptTime: number,
) {
	return {
		resourceLogs: [
			{
				scopeLogs: [
					{
						logRecords: records.map((record) => ({
							observedTimeUnixNano: String(BigInt(receiptTime) * 1_000_000n),
							severityNumber: record.severityNumber,
							severityText: record.severityText,
							body: { stringValue: record.body },
							attributes: otlpAttributes(record, environment),
						})),
					},
				],
			},
		],
	};
}

function otlpAttributes(record: ProjectedRecord, environment: ObservationEnvironment) {
	const attributes = [
		stringAttribute("service.name", SERVICE_NAME),
		stringAttribute("deployment.environment.name", environment),
		stringAttribute("observation.source", "convex"),
		stringAttribute("observation.schema", OBSERVATION_SCHEMA),
		stringAttribute("observation.cohort", record.cohort),
		stringAttribute("observation.bucket_start", record.bucketStart),
		integerAttribute("observation.count", 1),
	];
	if (record.functionPath !== undefined) {
		attributes.push(
			stringAttribute("convex.function.path", record.functionPath),
			stringAttribute("convex.function.type", record.functionType as ConvexFunctionType),
			stringAttribute("convex.status", record.status as ConvexStatus),
			integerAttribute("convex.mutation_retry_count", record.mutationRetryCount as number),
		);
	}
	return attributes;
}

function stringAttribute(key: string, value: string) {
	return { key, value: { stringValue: value } };
}

function integerAttribute(key: string, value: number) {
	return { key, value: { intValue: String(value) } };
}

function hourBucket(timestamp: number) {
	return new Date(Math.floor(timestamp / 3_600_000) * 3_600_000).toISOString();
}

function isTimestamp(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isJsonContentType(value: string | null) {
	return value !== null && /^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function staticResponse(status: number) {
	return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}
