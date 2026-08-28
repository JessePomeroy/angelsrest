import { execFile } from "node:child_process";
import { createHmac } from "node:crypto";
import { type ClientRequest, createServer, request as httpRequest } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type ConvexLogObservationConfig,
	handleConvexLogObservationRequest,
} from "$lib/server/convexLogObservation";

const NOW = Date.UTC(2026, 7, 28, 12, 34, 56, 789);
const SOURCE_TIME = NOW - 1_234;
const ENDPOINT = "https://o123.ingest.sentry.io/api/456/integration/otlp/v1/logs";
const PUBLIC_KEY = "0123456789abcdef0123456789abcdef";
const HMAC_SECRET = "convex-log-stream-test-secret";
const ROUTE_URL = "https://angelsrest.online/api/internal/convex-log-observation";

const config: ConvexLogObservationConfig = {
	hmacSecret: HMAC_SECRET,
	sentryOtlpLogsEndpoint: ENDPOINT,
	sentryPublicKey: PUBLIC_KEY,
	environment: "canary",
};

const observedPaths = [
	["orders:claimShipmentEmailNotificationByOrderNumber", "mutation", "global_v1"],
	["orders:recordShipmentEmailDeliveryByOrderNumber", "mutation", "global_v1"],
	["orders:claimShipmentEmailNotification", "mutation", "site_admin_v1"],
	["orders:recordShipmentEmailDelivery", "mutation", "site_admin_v1"],
	["orders:getByLumaprintsOrderNumber", "query", "lookup"],
	["orders:claimShipmentEmailNotificationV2", "mutation", "v2"],
	["orders:authorizeShipmentEmailNotificationSendV2", "mutation", "v2"],
	["orders:completeShipmentEmailNotificationV2", "mutation", "v2"],
	["orders:releaseShipmentEmailNotificationV2", "mutation", "v2"],
	["orders:isShipmentEmailNotificationDeliveryUncertain", "mutation", "v2"],
	["content:getPublishedSiteSettingsWithRevision", "query", "health"],
] as const;

afterEach(async () => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function functionEvent(
	path: string = observedPaths[0][0],
	type: "query" | "mutation" = "mutation",
	overrides: Record<string, unknown> = {},
) {
	return {
		topic: "function_execution",
		timestamp: SOURCE_TIME,
		convex: { deployment_name: "discard-me", project_slug: "secret-project" },
		function: { path, type, request_id: "request-secret" },
		status: "success",
		mutation_retry_count: 0,
		error_message: "stack-and-order-ORDER-123",
		stack: "distinct-stack-secret",
		message: "distinct-console-message-secret",
		site_url: "https://secret-site.example",
		unknown_nested: { secret: "distinct-unknown-nested-secret" },
		usage: { database_io_read_bytes: 999 },
		customer: { email: "buyer@example.com", token: "token-secret" },
		...overrides,
	};
}

function signedRequest(body: unknown, options: { headers?: HeadersInit; raw?: Uint8Array } = {}) {
	const raw = options.raw ?? new TextEncoder().encode(JSON.stringify(body));
	const signature = createHmac("sha256", HMAC_SECRET).update(raw).digest("hex");
	return new Request(ROUTE_URL, {
		method: "POST",
		headers: {
			"content-type": "application/json; charset=utf-8",
			"x-webhook-signature": `sha256=${signature}`,
			...options.headers,
		},
		body: raw as BodyInit,
	});
}

function successTransport() {
	return vi.fn(async (_input: { endpoint: URL; publicKey: string; body: Uint8Array }) =>
		Promise.resolve("success" as const),
	);
}

function parseSentBody(transport: ReturnType<typeof successTransport>) {
	const call = transport.mock.calls[0]?.[0];
	if (!call) throw new Error("transport was not called");
	return {
		input: call,
		payload: JSON.parse(new TextDecoder().decode(call.body)) as Record<string, unknown>,
	};
}

function logRecords(payload: Record<string, unknown>) {
	return (
		payload.resourceLogs as Array<{
			scopeLogs: Array<{ logRecords: Array<Record<string, unknown>> }>;
		}>
	)[0].scopeLogs[0].logRecords;
}

function attributes(record: Record<string, unknown>) {
	return Object.fromEntries(
		(
			record.attributes as Array<{
				key: string;
				value: { stringValue?: string; intValue?: string };
			}>
		).map(({ key, value }) => [key, value.stringValue ?? value.intValue]),
	);
}

function runIsolatedNode(script: string) {
	return new Promise<string>((resolveOutput, reject) => {
		execFile(
			process.execPath,
			["--import", "tsx", "--input-type=module", "--eval", script],
			{ cwd: process.cwd(), maxBuffer: 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error(`${error.message}\n${stderr}`));
					return;
				}
				resolveOutput(stdout);
			},
		);
	});
}

describe("Convex log observation projection", () => {
	it("projects every frozen path and deletes every forbidden source field", async () => {
		const transport = successTransport();
		const events = observedPaths.map(([path, type], index) =>
			functionEvent(path, type, {
				status: index === 1 ? "failure" : "success",
				mutation_retry_count: type === "mutation" ? index : undefined,
			}),
		);
		events.push({
			topic: "verification",
			timestamp: SOURCE_TIME,
			convex: { project_slug: "verification-secret" },
			message: "discard-verification-message",
		} as never);
		const response = await handleConvexLogObservationRequest(signedRequest(events), config, {
			now: () => NOW,
			transport,
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.text()).toBe("");
		const { input, payload } = parseSentBody(transport);
		expect(input.endpoint.href).toBe(ENDPOINT);
		expect(input.publicKey).toBe(PUBLIC_KEY);
		expect(Object.keys(payload)).toEqual(["resourceLogs"]);
		const resourceLog = (payload.resourceLogs as Array<Record<string, unknown>>)[0];
		expect(Object.keys(resourceLog)).toEqual(["scopeLogs"]);
		const scopeLog = (resourceLog.scopeLogs as Array<Record<string, unknown>>)[0];
		expect(Object.keys(scopeLog)).toEqual(["logRecords"]);
		const records = logRecords(payload);
		expect(records).toHaveLength(12);
		for (const record of records) {
			expect(Object.keys(record)).toEqual([
				"observedTimeUnixNano",
				"severityNumber",
				"severityText",
				"body",
				"attributes",
			]);
			for (const attribute of record.attributes as Array<Record<string, unknown>>) {
				expect(Object.keys(attribute)).toEqual(["key", "value"]);
				expect(Object.keys(attribute.value as Record<string, unknown>)).toHaveLength(1);
				expect(Object.keys(attribute.value as Record<string, unknown>)[0]).toMatch(
					/^(?:stringValue|intValue)$/u,
				);
			}
		}
		for (const [index, [path, type, cohort]] of observedPaths.entries()) {
			const record = records[index];
			const projected = attributes(record);
			expect(projected).toEqual({
				"service.name": "angelsrest-convex-observation",
				"deployment.environment.name": "canary",
				"observation.source": "convex",
				"observation.schema": "shipment-drain-v1",
				"observation.cohort": cohort,
				"observation.bucket_start": "2026-08-28T12:00:00.000Z",
				"observation.count": "1",
				"convex.function.path": path,
				"convex.function.type": type,
				"convex.status": index === 1 ? "failure" : "success",
				"convex.mutation_retry_count": type === "mutation" ? String(index) : "0",
			});
			expect(record.observedTimeUnixNano).toBe("1787920496789000000");
			expect(record.body).toEqual({ stringValue: "convex.function_execution" });
			expect(record).not.toHaveProperty("timeUnixNano");
			expect(record).not.toHaveProperty("traceId");
			expect(record).not.toHaveProperty("spanId");
			expect(record).not.toHaveProperty("eventName");
		}
		expect(attributes(records[11])).toEqual({
			"service.name": "angelsrest-convex-observation",
			"deployment.environment.name": "canary",
			"observation.source": "convex",
			"observation.schema": "shipment-drain-v1",
			"observation.cohort": "verification",
			"observation.bucket_start": "2026-08-28T12:00:00.000Z",
			"observation.count": "1",
		});
		expect(records[11].body).toEqual({ stringValue: "convex.verification" });
		expect(JSON.stringify(payload)).not.toMatch(
			/request-secret|stack-and-order|ORDER-123|distinct-stack-secret|distinct-console-message-secret|secret-site|distinct-unknown-nested-secret|buyer@example|token-secret|secret-project|verification-secret|discard-verification/,
		);
		expect(JSON.stringify(payload)).not.toContain(String(SOURCE_TIME));
		expect(payload.resourceLogs).toEqual([
			expect.objectContaining({ scopeLogs: expect.any(Array) }),
		]);
		expect((payload.resourceLogs as Array<Record<string, unknown>>)[0]).not.toHaveProperty(
			"resource",
		);
		expect(
			(payload.resourceLogs as Array<{ scopeLogs: Array<Record<string, unknown>> }>)[0]
				.scopeLogs[0],
		).not.toHaveProperty("scope");
	});

	it("acknowledges irrelevant topics and nonallowlisted functions without an outbound call", async () => {
		const transport = successTransport();
		const response = await handleConvexLogObservationRequest(
			signedRequest([
				{ topic: "console", timestamp: NOW, convex: {}, message: "do not parse me" },
				functionEvent("other:unrelated", "mutation"),
			]),
			config,
			{ now: () => NOW, transport },
		);
		expect(response.status).toBe(200);
		expect(transport).not.toHaveBeenCalled();
	});

	it.each([
		"toString",
		"constructor",
		"__proto__",
		"hasOwnProperty",
	])("discards the prototype-name path %s without an outbound call", async (path) => {
		const transport = successTransport();
		const response = await handleConvexLogObservationRequest(
			signedRequest([functionEvent(path, "mutation")]),
			config,
			{ now: () => NOW, transport },
		);
		expect(response.status).toBe(200);
		expect(transport).not.toHaveBeenCalled();
	});

	it("makes canary and production payloads differ only by the fixed environment", async () => {
		const canaryTransport = successTransport();
		const productionTransport = successTransport();
		const requestBody = [functionEvent()];
		await handleConvexLogObservationRequest(signedRequest(requestBody), config, {
			now: () => NOW,
			transport: canaryTransport,
		});
		await handleConvexLogObservationRequest(
			signedRequest(requestBody),
			{ ...config, environment: "production" },
			{ now: () => NOW, transport: productionTransport },
		);
		const canary = new TextDecoder().decode(parseSentBody(canaryTransport).input.body);
		const production = new TextDecoder().decode(parseSentBody(productionTransport).input.body);
		expect(canary.replace('"canary"', '"production"')).toBe(production);
	});
});

describe("Convex log observation request boundary", () => {
	it.each([
		["wrong method", new Request(ROUTE_URL), 405],
		["query string", signedRequest([functionEvent()]), 200],
	])("handles %s", async (_name, request, expected) => {
		const actual = _name === "query string" ? new Request(`${ROUTE_URL}?x=1`, request) : request;
		expect(
			(
				await handleConvexLogObservationRequest(actual, config, {
					now: () => NOW,
					transport: successTransport(),
				})
			).status,
		).toBe(_name === "query string" ? 400 : expected);
	});

	it.each([
		["text/plain", {}, 415],
		["application/json; charset=latin1", {}, 415],
		["application/json", { "content-encoding": "gzip" }, 415],
	])("rejects unsupported media contract %s", async (contentType, extra, status) => {
		const request = signedRequest([functionEvent()], {
			headers: { "content-type": contentType, ...extra },
		});
		expect((await handleConvexLogObservationRequest(request, config)).status).toBe(status);
	});

	it.each([
		[null, 401],
		["sha256=ABCDEF", 401],
		[`sha256=${"A".repeat(64)}`, 401],
		[`sha256=${"0".repeat(64)}`, 401],
	])("rejects a noncanonical signature %s", async (signature, status) => {
		const request = signedRequest([functionEvent()], {
			headers:
				signature === null ? { "x-webhook-signature": "" } : { "x-webhook-signature": signature },
		});
		expect((await handleConvexLogObservationRequest(request, config)).status).toBe(status);
	});

	it("authenticates the exact raw bytes before UTF-8 or JSON parsing", async () => {
		const raw = new TextEncoder().encode('[{"topic":"verification"}] ');
		const request = signedRequest([], { raw });
		expect(
			(
				await handleConvexLogObservationRequest(request, config, {
					now: () => NOW,
					transport: successTransport(),
				})
			).status,
		).toBe(400);
		const changed = raw.slice();
		changed[changed.length - 1] = 10;
		const changedRequest = new Request(ROUTE_URL, {
			method: "POST",
			headers: request.headers,
			body: changed,
		});
		expect((await handleConvexLogObservationRequest(changedRequest, config)).status).toBe(401);
	});

	it("enforces declared and streamed body limits", async () => {
		const declared = signedRequest([functionEvent()], {
			headers: { "content-length": String(1024 * 1024 + 1) },
		});
		expect((await handleConvexLogObservationRequest(declared, config)).status).toBe(413);

		const oversized = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(1024 * 1024));
				controller.enqueue(new Uint8Array([0]));
				controller.close();
			},
		});
		const streamed = new Request(ROUTE_URL, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-webhook-signature": `sha256=${"0".repeat(64)}`,
			},
			body: oversized,
			duplex: "half",
		} as RequestInit & { duplex: "half" });
		expect((await handleConvexLogObservationRequest(streamed, config)).status).toBe(413);
	});

	it.each([
		[new Uint8Array([0xff]), "invalid UTF-8"],
		[new TextEncoder().encode("{"), "invalid JSON"],
	])("rejects %s", async (raw) => {
		const request = signedRequest([], { raw });
		expect((await handleConvexLogObservationRequest(request, config)).status).toBe(400);
	});

	it.each([
		[[], 400],
		[new Array(501).fill({ topic: "console", timestamp: NOW, convex: {} }), 400],
		[[{ topic: "verification", timestamp: NOW, convex: {} }], 400],
		[[{ topic: 1, timestamp: NOW, convex: {} }], 400],
		[[{ topic: "console", timestamp: "bad", convex: {} }], 400],
		[[{ topic: "console", timestamp: NOW }], 400],
	])("rejects a malformed batch %#", async (body, status) => {
		expect(
			(
				await handleConvexLogObservationRequest(signedRequest(body), config, {
					now: () => NOW,
					transport: successTransport(),
				})
			).status,
		).toBe(status);
	});

	it("freezes the newest-record freshness and future-skew boundaries", async () => {
		for (const [timestamp, expected] of [
			[NOW - 5 * 60_000, 200],
			[NOW - 5 * 60_000 - 1, 403],
			[NOW + 60_000, 200],
			[NOW + 60_001, 403],
		] as const) {
			const transport = successTransport();
			const response = await handleConvexLogObservationRequest(
				signedRequest([functionEvent(undefined, undefined, { timestamp })]),
				config,
				{ now: () => NOW, transport },
			);
			expect(response.status).toBe(expected);
		}

		const response = await handleConvexLogObservationRequest(
			signedRequest([
				functionEvent(undefined, undefined, { timestamp: NOW - 60 * 60_000 }),
				{ topic: "console", timestamp: NOW, convex: {} },
			]),
			config,
			{ now: () => NOW, transport: successTransport() },
		);
		expect(response.status).toBe(200);
	});

	it.each([
		[{ function: { path: observedPaths[0][0], type: "query" } }, 400],
		[{ status: "unknown" }, 400],
		[{ mutation_retry_count: undefined }, 400],
		[{ mutation_retry_count: null }, 400],
		[{ mutation_retry_count: -1 }, 400],
		[{ mutation_retry_count: 1.5 }, 400],
	])("rejects malformed retained records %#", async (override, status) => {
		const response = await handleConvexLogObservationRequest(
			signedRequest([functionEvent(undefined, undefined, override)]),
			config,
			{ now: () => NOW, transport: successTransport() },
		);
		expect(response.status).toBe(status);
	});

	it.each([
		[{ ...config, hmacSecret: undefined }],
		[{ ...config, hmacSecret: "" }],
		[{ ...config, sentryPublicKey: "ABC" }],
		[
			{
				...config,
				sentryOtlpLogsEndpoint: "http://o1.ingest.sentry.io/api/1/integration/otlp/v1/logs",
			},
		],
		[{ ...config, sentryOtlpLogsEndpoint: "https://evil.test/api/1/integration/otlp/v1/logs" }],
		[{ ...config, sentryOtlpLogsEndpoint: `${ENDPOINT}?secret=x` }],
		[
			{
				...config,
				sentryOtlpLogsEndpoint: "https://o1.ingest.us.sentry.io:443/api/1/integration/otlp/v1/logs",
			},
		],
		[{ ...config, environment: "preview" }],
	])("fails closed for invalid configuration %#", async (invalidConfig) => {
		expect(
			(
				await handleConvexLogObservationRequest(signedRequest([functionEvent()]), invalidConfig, {
					now: () => NOW,
				})
			).status,
		).toBe(503);
	});

	it.each([
		["success", 200],
		["retryable_failure", 503],
		["protocol_failure", 502],
	])("maps the destination result %s to a static response", async (result, status) => {
		const response = await handleConvexLogObservationRequest(
			signedRequest([functionEvent()]),
			config,
			{
				now: () => NOW,
				transport: vi.fn(
					async () => result as "success" | "retryable_failure" | "protocol_failure",
				),
			},
		);
		expect(response.status).toBe(status);
		expect(await response.text()).toBe("");
	});

	it("contains transport exceptions and invalid clocks", async () => {
		const throwing = vi.fn(async () => {
			throw new Error("provider response with secret");
		});
		expect(
			(
				await handleConvexLogObservationRequest(signedRequest([functionEvent()]), config, {
					now: () => NOW,
					transport: throwing,
				})
			).status,
		).toBe(503);
		expect(
			(
				await handleConvexLogObservationRequest(signedRequest([functionEvent()]), config, {
					now: () => Number.NaN,
					transport: successTransport(),
				})
			).status,
		).toBe(503);
	});

	it("enforces the destination wall-clock deadline before a socket connects", async () => {
		vi.useFakeTimers();
		const destroy = vi.fn();
		const fakeRequest = {
			destroy,
			end: vi.fn(),
			once: vi.fn().mockReturnThis(),
		} as unknown as ClientRequest;
		const pending = handleConvexLogObservationRequest(signedRequest([functionEvent()]), config, {
			now: () => NOW,
			nodeRequest: () => fakeRequest,
		});
		await vi.advanceTimersByTimeAsync(1_999);
		expect(destroy).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect((await pending).status).toBe(503);
		expect(destroy).toHaveBeenCalledOnce();
	});
});

describe("manual Sentry OTLP transport", () => {
	it("proves instrumentation is active and suppresses propagation and breadcrumbs", async () => {
		const bridgeModuleUrl = pathToFileURL(
			resolve(process.cwd(), "src/lib/server/convexLogObservation.ts"),
		).href;
		const script = String.raw`
const Sentry = await import("@sentry/node");
const breadcrumbs = [];
Sentry.init({
  dsn: "https://0123456789abcdef0123456789abcdef@o1.ingest.sentry.io/1",
  tracesSampleRate: 1,
  tracePropagationTargets: [/127\.0\.0\.1/],
  beforeBreadcrumb(breadcrumb) { breadcrumbs.push(breadcrumb); return breadcrumb; },
  transport: () => ({ send: async () => ({ statusCode: 200 }), flush: async () => true }),
});
const { createHmac } = await import("node:crypto");
const { createServer, request: httpRequest } = await import("node:http");
const { handleConvexLogObservationRequest } = await import(${JSON.stringify(bridgeModuleUrl)});
const received = [];
const server = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  request.on("end", () => {
    received.push({ path: request.url, headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
if (!address || typeof address === "string") throw new Error("missing address");
const base = "http://127.0.0.1:" + address.port;
const sendControl = () => new Promise((resolveRequest, rejectRequest) => {
  const request = httpRequest(base + "/control", { method: "POST" }, (response) => {
    response.resume();
    response.once("end", resolveRequest);
  });
  request.once("error", rejectRequest);
  request.end("control");
});
await Sentry.startSpan({ name: "instrumentation-control", op: "test" }, sendControl);
await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
const controlBreadcrumbs = breadcrumbs.map(({ category, type, data }) => ({ category, type, url: data?.url }));
breadcrumbs.length = 0;
const now = Date.UTC(2026, 7, 28, 12, 34, 56, 789);
const body = Buffer.from(JSON.stringify([{
  topic: "function_execution",
  timestamp: now,
  convex: {},
  function: { path: "orders:claimShipmentEmailNotificationByOrderNumber", type: "mutation" },
  status: "success",
  mutation_retry_count: 0,
}]));
const signature = createHmac("sha256", ${JSON.stringify(HMAC_SECRET)}).update(body).digest("hex");
const inbound = new Request(${JSON.stringify(ROUTE_URL)}, {
  method: "POST",
  headers: { "content-type": "application/json", "x-webhook-signature": "sha256=" + signature },
  body,
});
const handlerResponse = await Sentry.startSpan({ name: "observation", op: "test" }, () =>
  handleConvexLogObservationRequest(inbound, {
    hmacSecret: ${JSON.stringify(HMAC_SECRET)},
    sentryOtlpLogsEndpoint: ${JSON.stringify(ENDPOINT)},
    sentryPublicKey: ${JSON.stringify(PUBLIC_KEY)},
    environment: "canary",
  }, {
    now: () => now,
    nodeRequest: (_url, options, callback) => httpRequest(base + "/observation", options, callback),
  })
);
await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
const observationBreadcrumbs = breadcrumbs.map(({ category, type, data }) => ({ category, type, url: data?.url }));
await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
await Sentry.close(0);
console.log("RESULT:" + JSON.stringify({ handlerStatus: handlerResponse.status, received, controlBreadcrumbs, observationBreadcrumbs }));
`;
		const stdout = await runIsolatedNode(script);
		const resultLine = stdout.split("\n").find((line) => line.startsWith("RESULT:"));
		if (!resultLine) throw new Error(`missing child result:\n${stdout}`);
		const result = JSON.parse(resultLine.slice("RESULT:".length)) as {
			handlerStatus: number;
			received: Array<{ path: string; headers: Record<string, string>; body: string }>;
			controlBreadcrumbs: Array<{ category?: string }>;
			observationBreadcrumbs: Array<{ category?: string }>;
		};
		expect(result.handlerStatus).toBe(200);
		expect(result.received).toHaveLength(2);
		const [control, observation] = result.received;
		expect(control.path).toBe("/control");
		expect(control.headers).toHaveProperty("sentry-trace");
		expect(control.headers).toHaveProperty("baggage");
		expect(result.controlBreadcrumbs.some(({ category }) => category === "http")).toBe(true);
		expect(observation.path).toBe("/observation");
		expect(Object.keys(observation.headers).sort()).toEqual([
			"accept",
			"connection",
			"content-length",
			"content-type",
			"host",
			"x-sentry-auth",
		]);
		expect(observation.headers.accept).toBe("application/json");
		expect(observation.headers["content-type"]).toBe("application/json");
		expect(observation.headers["content-length"]).toBe(String(Buffer.byteLength(observation.body)));
		expect(observation.headers["x-sentry-auth"]).toBe(`sentry sentry_key=${PUBLIC_KEY}`);
		for (const forbidden of [
			"transfer-encoding",
			"user-agent",
			"sentry-trace",
			"baggage",
			"traceparent",
			"cookie",
			"authorization",
		]) {
			expect(observation.headers).not.toHaveProperty(forbidden);
		}
		expect(result.observationBreadcrumbs.some(({ category }) => category === "http")).toBe(false);
	});

	it.each([
		[200, "application/json", "{}", 200],
		[200, "application/json", '{"partialSuccess":{}}', 200],
		[200, "application/json", '{"partialSuccess":{"rejectedLogRecords":"1"}}', 502],
		[200, "application/json", '{"partialSuccess":{"errorMessage":"rejected"}}', 502],
		[200, "application/json", '{"partialSuccess":{},"unexpected":true}', 502],
		[200, "text/plain", "{}", 502],
		[200, "application/json", "", 502],
		[302, "application/json", "{}", 502],
		[400, "application/json", "{}", 502],
		[429, "application/json", "{}", 503],
		[503, "application/json", "{}", 503],
	])("maps HTTP %s / %s", async (status, contentType, body, expected) => {
		const server = createServer((request, response) => {
			request.resume();
			response.writeHead(status, { "content-type": contentType });
			response.end(body);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("missing test server address");
		const result = await handleConvexLogObservationRequest(
			signedRequest([functionEvent()]),
			config,
			{
				now: () => NOW,
				nodeRequest: (_url, options, callback) =>
					httpRequest(`http://127.0.0.1:${address.port}/otlp`, options, callback),
			},
		);
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
		expect(result.status).toBe(expected);
	});

	it("closes the peer immediately after a header-level rejection", async () => {
		let resolvePeerClosed: (() => void) | undefined;
		const peerClosed = new Promise<void>((resolveClosed) => {
			resolvePeerClosed = resolveClosed;
		});
		const server = createServer((request, response) => {
			request.resume();
			response.once("close", () => resolvePeerClosed?.());
			response.writeHead(400, { "content-type": "application/json" });
			response.write("{");
		});
		await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("missing test server address");
		const result = await handleConvexLogObservationRequest(
			signedRequest([functionEvent()]),
			config,
			{
				now: () => NOW,
				nodeRequest: (_url, options, callback) =>
					httpRequest(`http://127.0.0.1:${address.port}/otlp`, options, callback),
			},
		);
		expect(result.status).toBe(502);
		await Promise.race([
			peerClosed,
			new Promise<never>((_resolve, reject) =>
				setTimeout(() => reject(new Error("peer socket remained open")), 1_000),
			),
		]);
		await new Promise<void>((resolveClose, rejectClose) =>
			server.close((error) => (error ? rejectClose(error) : resolveClose())),
		);
	});

	it("rejects oversized success responses and contains network failures", async () => {
		const server = createServer((request, response) => {
			request.resume();
			response.writeHead(200, { "content-type": "application/json" });
			response.end(`{"padding":"${"x".repeat(9 * 1024)}"}`);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("missing test server address");
		const oversized = await handleConvexLogObservationRequest(
			signedRequest([functionEvent()]),
			config,
			{
				now: () => NOW,
				nodeRequest: (_url, options, callback) =>
					httpRequest(`http://127.0.0.1:${address.port}/otlp`, options, callback),
			},
		);
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
		expect(oversized.status).toBe(502);
		const network = await handleConvexLogObservationRequest(
			signedRequest([functionEvent()]),
			config,
			{
				now: () => NOW,
				nodeRequest: (_url, options, callback) =>
					httpRequest(`http://127.0.0.1:${address.port}/otlp`, options, callback),
			},
		);
		expect(network.status).toBe(503);
	});
});
