import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const V2_CANARY_CONFIRMATION =
	"re-attest the recorded JPEG oversized PNG and paid ZIP with schema 2";
export const V2_CANARY_SITE_URL = "angelsrest.online";
export const V2_CANARY_WORKER_ORIGIN = "https://cms-media-worker.thinkingofview.workers.dev";
export const V2_CANARY_STORAGE_PATH = "/v1/catalog-assets/receipts/storage";
export const V2_CANARY_INSPECTION_PATH = "/v1/catalog-assets/receipts/inspection";
export const V2_CANARY_V1_RECEIPT_SET_ID =
	"catalog-private-assets-v1:e8d573e1558301bfb52fc108baf227d6d74e4e7fbbc0228d2829ded3d32ac63b";
export const V2_CANARY_CONVEX_SELECTOR = "prod:loyal-swan-967";
export const V2_CANARY_CONVEX_SITE_ORIGIN = "https://loyal-swan-967.convex.site";
export const V2_CANARY_DECODER_POLICY = {
	printSource: {
		method: "sharp_libvips_full_raster_v1",
		sharpVersion: "0.35.3",
		libvipsVersion: "8.18.3",
	},
	paidDigitalFile: { method: "safe_zip_v1" },
} as const;
export const V2_CANARY_LABELS = ["JPEG", "oversized PNG", "paid ZIP"] as const;
const V2_CANARY_OWNER_ID = typeof process.getuid === "function" ? process.getuid() : "owner";
export const V2_CANARY_ARTIFACT_DIRECTORY = join(
	tmpdir(),
	`angelsrest-private-catalog-v2-canary-${V2_CANARY_OWNER_ID}`,
);
export const V2_CANARY_REPORT_PATH = join(V2_CANARY_ARTIFACT_DIRECTORY, "report.json");
export const V2_CANARY_FAILURE_ARTIFACT_PATH = join(V2_CANARY_ARTIFACT_DIRECTORY, "failure.json");
export const V2_CANARY_FAILURE_STDERR =
	"V2 canary failed; a sanitized recovery artifact was preserved.";
export const V2_CANARY_ARTIFACT_WRITE_FAILURE_STDERR =
	"V2 canary failed; the sanitized recovery artifact could not be written.";

const EXPECTED_PNG = { sizeBytes: 55_009_177, widthPixels: 6_935, heightPixels: 4_623 };
const RESPONSE_MAX_BYTES = 64 * 1024;
const CONVEX_OUTPUT_MAX_BYTES = 256 * 1024;
const SECRET_MIN_BYTES = 32;
const SECRET_MAX_BYTES = 512;
const FAILURE_ARTIFACT_MAX_BYTES = 512;

export const V2_CANARY_PHASES = [
	"preflight",
	"backfill",
	"storage_resume",
	"storage_replay",
	"inspection",
	"final_replay",
] as const;
export const V2_CANARY_FAILURES = [
	"transport",
	"worker_4xx",
	"worker_5xx",
	"invalid_attestation",
	"state_drift",
	"operator",
] as const;

export type V2CanaryPhase = (typeof V2_CANARY_PHASES)[number];
export type V2CanaryFailure = (typeof V2_CANARY_FAILURES)[number];
export type V2CanaryFailureArtifact = {
	schemaVersion: 1;
	phase: V2CanaryPhase;
	failure: V2CanaryFailure;
	httpStatus?: number;
	timestamp: string;
};

class V2CanaryFailureError extends Error {
	constructor(
		message: string,
		readonly failure: V2CanaryFailure,
		readonly httpStatus?: number,
	) {
		super(message);
		this.name = "V2CanaryFailureError";
	}
}

function canaryFailure(
	failure: V2CanaryFailure,
	message: string,
	httpStatus?: number,
): V2CanaryFailureError {
	return new V2CanaryFailureError(message, failure, httpStatus);
}

function stateDrift(message: string): V2CanaryFailureError {
	return canaryFailure("state_drift", message);
}

export async function runV2CanaryCatalogTransport<T>(operation: () => Promise<T>) {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof V2CanaryFailureError) throw error;
		throw canaryFailure("transport", "Published catalog request did not complete");
	}
}

export async function runV2CanaryCatalogStateValidation<T>(operation: () => T | Promise<T>) {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof V2CanaryFailureError) throw error;
		throw stateDrift("Published catalog state is malformed or has drifted");
	}
}

function boundedHttpStatus(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
		? value
		: undefined;
}

export function createV2CanaryFailureArtifact(
	error: unknown,
	phase: V2CanaryPhase,
	timestamp = new Date().toISOString(),
): V2CanaryFailureArtifact {
	const classified = error instanceof V2CanaryFailureError ? error : undefined;
	const httpStatus = boundedHttpStatus(classified?.httpStatus);
	return {
		schemaVersion: 1,
		phase,
		failure: classified?.failure ?? "operator",
		...(httpStatus === undefined ? {} : { httpStatus }),
		timestamp,
	};
}

function assertV2CanaryFailureArtifact(value: V2CanaryFailureArtifact) {
	const keys = Object.keys(value).sort();
	const expectedKeys = [
		"failure",
		...(value.httpStatus === undefined ? [] : ["httpStatus"]),
		"phase",
		"schemaVersion",
		"timestamp",
	].sort();
	if (
		keys.length !== expectedKeys.length ||
		!keys.every((key, index) => key === expectedKeys[index]) ||
		value.schemaVersion !== 1 ||
		!V2_CANARY_PHASES.includes(value.phase) ||
		!V2_CANARY_FAILURES.includes(value.failure) ||
		(value.httpStatus !== undefined && boundedHttpStatus(value.httpStatus) === undefined) ||
		new Date(value.timestamp).toISOString() !== value.timestamp
	) {
		throw new Error("V2 canary failure artifact is invalid");
	}
}

async function assertPrivateArtifactDirectory(directory: string) {
	let handle: Awaited<ReturnType<typeof open>>;
	try {
		handle = await open(
			directory,
			constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
		);
	} catch {
		throw new Error("V2 canary artifact directory is unavailable");
	}
	try {
		const metadata = await handle.stat();
		if (!metadata.isDirectory() || (metadata.mode & 0o777) !== 0o700) {
			throw new Error("V2 canary artifact directory is not private");
		}
		if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
			throw new Error("V2 canary artifact directory has the wrong owner");
		}
	} finally {
		await handle.close();
	}
}

export async function prepareV2CanaryArtifactDirectory(directory = V2_CANARY_ARTIFACT_DIRECTORY) {
	try {
		await mkdir(directory, { mode: 0o700 });
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
	}
	await assertPrivateArtifactDirectory(directory);
}

export async function resetV2CanaryArtifactDirectory(directory = V2_CANARY_ARTIFACT_DIRECTORY) {
	try {
		await lstat(directory);
		await assertPrivateArtifactDirectory(directory);
		await rm(directory, { recursive: true });
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
	await mkdir(directory, { mode: 0o700 });
	await assertPrivateArtifactDirectory(directory);
}

export async function writeV2CanaryFailureArtifact(
	artifactPath: string,
	artifact: V2CanaryFailureArtifact,
) {
	assertV2CanaryFailureArtifact(artifact);
	await assertPrivateArtifactDirectory(dirname(artifactPath));
	try {
		const destination = await lstat(artifactPath);
		if (!destination.isFile() || destination.isSymbolicLink()) {
			throw new Error("V2 canary failure artifact destination is unsafe");
		}
		if (typeof process.getuid === "function" && destination.uid !== process.getuid()) {
			throw new Error("V2 canary failure artifact destination has the wrong owner");
		}
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
	const contents = `${JSON.stringify(artifact, null, 2)}\n`;
	if (Buffer.byteLength(contents) > FAILURE_ARTIFACT_MAX_BYTES) {
		throw new Error("V2 canary failure artifact exceeds its bound");
	}
	const temporaryPath = join(
		dirname(artifactPath),
		`.${basename(artifactPath)}.${process.pid}.${randomUUID()}.tmp`,
	);
	let file: Awaited<ReturnType<typeof open>> | undefined;
	try {
		file = await open(
			temporaryPath,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
			0o600,
		);
		await file.chmod(0o600);
		await file.writeFile(contents, "utf8");
		await file.sync();
		await file.close();
		file = undefined;
		await rename(temporaryPath, artifactPath);
	} finally {
		await file?.close().catch(() => undefined);
		await rm(temporaryPath, { force: true }).catch(() => undefined);
	}
}

const SNAPSHOT_COUNT_KEYS = [
	"receiptCoordinations",
	"authorities",
	"printTargets",
	"paidTargets",
	"products",
	"revisions",
	"variants",
	"mediaPlacements",
	"printSources",
	"setMembers",
	"digitalFiles",
	"shopPlacements",
	"publicationPointers",
] as const;
const SNAPSHOT_DIGEST_KEYS = [
	"receipts",
	"coordinations",
	"timestamps",
	"authorities",
	"registryTargets",
	"products",
	"revisions",
	"variants",
	"mediaPlacements",
	"printSources",
	"setMembers",
	"digitalFiles",
	"shopPlacements",
	"publicationPointers",
] as const;

const PINNED = [
	{
		label: "jpeg" as const,
		kind: "print_source" as const,
		assetKey: "image-1382b9d3b95996a2d7f612c7d1943f1c63dcb695-2160x1440-jpg",
		targetId: "q970hm4246ek96y29w5hrsjkvh8axepc",
	},
	{
		label: "oversized_png" as const,
		kind: "print_source" as const,
		assetKey: "image-4eb6f607de53cc329dafa75645ce38b96459d010-6935x4623-png",
		targetId: "q97em2xrgehs2gg4jmeajgmj9n8awazy",
	},
	{
		label: "paid_zip" as const,
		kind: "paid_digital_file" as const,
		assetKey: "file-69ddd31ce4d9f51c978074210560e7249fe7e42f-zip",
		targetId: "q57679yxvbbbkz74563mvg34gn8axprw",
	},
] as const;

export async function clearV2CanaryArtifactsForExecution(
	args: readonly string[],
	artifactPaths: readonly string[],
) {
	if (args.includes("--execute")) {
		await Promise.all(artifactPaths.map((path) => rm(path, { force: true })));
	}
}

export async function clearV2CanaryReportForExecution(args: readonly string[], reportPath: string) {
	await clearV2CanaryArtifactsForExecution(args, [reportPath]);
}

export async function clearV2CanaryFailureArtifactAfterSuccess(
	artifactPath = V2_CANARY_FAILURE_ARTIFACT_PATH,
) {
	await rm(artifactPath, { force: true });
}

export type V2CanaryOptions = {
	execute: boolean;
	confirmation?: string;
	tenantSecretFile?: string;
	inspectionSecretFile?: string;
	convexEnvFile?: string;
};

type CanarySnapshot = {
	schemaVersion: 1;
	canary: {
		receiptSetId: string;
		targets: Array<{
			label: "jpeg" | "oversized_png" | "paid_zip";
			kind: "print_source" | "paid_digital_file";
			targetId: string;
		}>;
		oversizedPng: { sizeBytes: number; widthPixels: number; heightPixels: number };
	};
	v2: {
		status: "absent" | "pending_inspection" | "verified";
		evidence: null | {
			fullRaster: true;
			safeZip: true;
			sharpVersion: string;
			libvipsVersion: string;
		};
	};
	counts: Record<string, number> & {
		receiptCoordinations: number;
		authorities: number;
		printTargets: number;
		paidTargets: number;
		publicationPointers: number;
	};
	digests: Record<string, string>;
};

type WorkerRole = "storage" | "inspection";

type WorkerResult = {
	status: "pending_inspection" | "verified";
	replayed: boolean;
	assetCount: 3;
	receiptSetId: string;
	attestation: {
		schemaVersion: 2;
		role: WorkerRole;
		derivedReceiptSetId: string;
		convexDeployment: typeof V2_CANARY_CONVEX_SELECTOR;
		convexSiteOrigin: typeof V2_CANARY_CONVEX_SITE_ORIGIN;
		decoderPolicy: typeof V2_CANARY_DECODER_POLICY;
		decoderPolicyState: "required" | "matched";
	};
};

type BackfillResult = { replayed: boolean; targetCount: 12 };

export type V2CanaryExecutionDependencies = {
	/** Untrusted Convex output; parsed and narrowed inside the state machine. */
	snapshot: () => Promise<unknown>;
	/** Untrusted Convex output; parsed and narrowed inside the state machine. */
	backfill: () => Promise<unknown>;
	postWorker: (
		path: typeof V2_CANARY_STORAGE_PATH | typeof V2_CANARY_INSPECTION_PATH,
		secret: string,
		privateObjectKeys: readonly string[],
		expectedReceiptSetId: string,
	) => Promise<WorkerResult>;
	readPublishedManifest: () => Promise<string>;
};

function objectValue(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} is malformed`);
	}
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function parseV2CanaryOptions(args: readonly string[]): V2CanaryOptions {
	const options: V2CanaryOptions = { execute: false };
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") continue;
		if (arg === "--execute") {
			if (options.execute) throw new Error("--execute may be supplied only once");
			options.execute = true;
			continue;
		}
		if (
			arg === "--confirm" ||
			arg === "--tenant-secret-file" ||
			arg === "--inspection-secret-file" ||
			arg === "--convex-env-file"
		) {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) throw new Error(`${arg} requires one value`);
			if (arg === "--confirm") {
				if (options.confirmation) throw new Error("--confirm may be supplied only once");
				options.confirmation = value;
			} else {
				const path = resolve(value);
				if (arg === "--tenant-secret-file") {
					if (options.tenantSecretFile) throw new Error(`${arg} may be supplied only once`);
					options.tenantSecretFile = path;
				}
				if (arg === "--inspection-secret-file") {
					if (options.inspectionSecretFile) throw new Error(`${arg} may be supplied only once`);
					options.inspectionSecretFile = path;
				}
				if (arg === "--convex-env-file") {
					if (options.convexEnvFile) throw new Error(`${arg} may be supplied only once`);
					options.convexEnvFile = path;
				}
			}
			index += 1;
			continue;
		}
		throw new Error("Unsupported V2 canary argument");
	}
	const executionFields = [
		options.confirmation,
		options.tenantSecretFile,
		options.inspectionSecretFile,
		options.convexEnvFile,
	];
	if (!options.execute && executionFields.some(Boolean)) {
		throw new Error("Execution confirmation and files require --execute");
	}
	if (options.execute) {
		if (options.confirmation !== V2_CANARY_CONFIRMATION) {
			throw new Error(`Execution requires --confirm "${V2_CANARY_CONFIRMATION}"`);
		}
		if (!options.tenantSecretFile || !options.inspectionSecretFile || !options.convexEnvFile) {
			throw new Error("Execution requires the tenant, inspection, and Convex selector files");
		}
		if (
			new Set([options.tenantSecretFile, options.inspectionSecretFile, options.convexEnvFile])
				.size !== 3
		)
			throw new Error("Execution files must be different files");
	}
	return options;
}

async function readSecureFile(
	path: string,
	label: string,
	{ minimumBytes, maximumBytes }: { minimumBytes: number; maximumBytes: number },
) {
	let file: Awaited<ReturnType<typeof open>>;
	try {
		file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	} catch {
		throw new Error(`${label} is unavailable or is not a regular file`);
	}
	try {
		const before = await file.stat();
		if (!before.isFile()) throw new Error(`${label} must be a regular file`);
		if ((before.mode & 0o777) !== 0o600) throw new Error(`${label} must have exact mode 0600`);
		if (typeof process.getuid === "function" && before.uid !== process.getuid()) {
			throw new Error(`${label} must be owned by the executing user`);
		}
		if (before.size < minimumBytes || before.size > maximumBytes) {
			throw new Error(`${label} has an invalid size`);
		}
		const buffer = Buffer.alloc(maximumBytes + 1);
		const { bytesRead } = await file.read(buffer, 0, buffer.byteLength, 0);
		const after = await file.stat();
		if (
			bytesRead !== before.size ||
			bytesRead > maximumBytes ||
			after.size !== before.size ||
			after.mtimeMs !== before.mtimeMs ||
			after.ctimeMs !== before.ctimeMs
		) {
			throw new Error(`${label} changed while it was being read`);
		}
		return buffer.subarray(0, bytesRead).toString("utf8");
	} finally {
		await file.close();
	}
}

export async function readV2CanarySecretFile(path: string, label: string) {
	const raw = await readSecureFile(path, label, {
		minimumBytes: SECRET_MIN_BYTES,
		maximumBytes: SECRET_MAX_BYTES + 1,
	});
	const value = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
	if (
		value.length < SECRET_MIN_BYTES ||
		value.length > SECRET_MAX_BYTES ||
		value !== value.trim() ||
		!/^[\x21-\x7e]+$/.test(value)
	)
		throw new Error(`${label} must contain one exact bounded value`);
	return value;
}

export async function readV2CanaryConvexSelectorFile(path: string) {
	const raw = await readSecureFile(path, "Convex selector file", {
		minimumBytes: 1,
		maximumBytes: 128,
	});
	if (
		raw !== `CONVEX_DEPLOYMENT=${V2_CANARY_CONVEX_SELECTOR}\n` &&
		raw !== `CONVEX_DEPLOYMENT=${V2_CANARY_CONVEX_SELECTOR}`
	) {
		throw new Error("Convex selector file must contain only the pinned production selector");
	}
}

export function v2CanaryConvexChildEnvironment(
	environment: Readonly<Record<string, string | undefined>>,
) {
	const allowed = new Set([
		"HOME",
		"PATH",
		"TMPDIR",
		"LANG",
		"LC_ALL",
		"TERM",
		"NO_COLOR",
		"XDG_CONFIG_HOME",
		"XDG_DATA_HOME",
		"XDG_STATE_HOME",
	]);
	return {
		...Object.fromEntries(
			Object.entries(environment).filter(
				(entry): entry is [string, string] => allowed.has(entry[0]) && entry[1] !== undefined,
			),
		),
		CI: "1",
		CONVEX_DEPLOYMENT: V2_CANARY_CONVEX_SELECTOR,
	};
}

export function loadV2CanarySelection(
	journalValue: unknown,
	publishedPrintRefs: readonly string[],
	publishedPaidRefs: readonly string[],
) {
	const journal = objectValue(journalValue, "Private target journal");
	if (!exactKeys(journal, ["schemaVersion", "siteUrl", "receiptSetId", "targets"])) {
		throw stateDrift("Private target journal shape has drifted");
	}
	if (
		journal.schemaVersion !== 1 ||
		journal.siteUrl !== V2_CANARY_SITE_URL ||
		journal.receiptSetId !== V2_CANARY_V1_RECEIPT_SET_ID
	)
		throw stateDrift("Private target journal identity has drifted");
	const targets = objectValue(journal.targets, "Private target journal targets");
	if (!exactKeys(targets, ["printSources", "paidFiles"])) {
		throw stateDrift("Private target journal target groups have drifted");
	}
	const prints = objectValue(targets.printSources, "Private print target journal");
	const paid = objectValue(targets.paidFiles, "Private paid target journal");
	const printKeys = Object.keys(prints);
	const paidKeys = Object.keys(paid);
	if (
		printKeys.length !== 11 ||
		paidKeys.length !== 1 ||
		publishedPrintRefs.length !== 11 ||
		publishedPaidRefs.length !== 1 ||
		new Set(publishedPrintRefs).size !== printKeys.length ||
		new Set(publishedPaidRefs).size !== paidKeys.length ||
		!printKeys.every((key) => publishedPrintRefs.includes(key)) ||
		!paidKeys.every((key) => publishedPaidRefs.includes(key)) ||
		!publishedPrintRefs.every((key) => typeof prints[key] === "string") ||
		!publishedPaidRefs.every((key) => typeof paid[key] === "string")
	)
		throw stateDrift("Published private target set differs from the checked journal");
	for (const expected of PINNED) {
		const actual =
			expected.kind === "print_source" ? prints[expected.assetKey] : paid[expected.assetKey];
		if (actual !== expected.targetId) throw stateDrift("A pinned V2 canary target has drifted");
	}
	if (new Set(PINNED.map((item) => item.targetId)).size !== 3) {
		throw stateDrift("Pinned V2 canary targets are not unique");
	}
	return PINNED.map((item) => ({
		label: item.label,
		kind: item.kind,
		privateObjectKey: `sites/${V2_CANARY_SITE_URL}/catalog/${
			item.kind === "print_source" ? "print-sources" : "paid-digital-files"
		}/${item.assetKey}/original`,
		targetId: item.targetId,
	}));
}

export function assertV2CanaryPngMetadata(value: unknown) {
	const metadata = objectValue(value, "Oversized PNG metadata");
	if (
		metadata.sizeBytes !== EXPECTED_PNG.sizeBytes ||
		metadata.widthPixels !== EXPECTED_PNG.widthPixels ||
		metadata.heightPixels !== EXPECTED_PNG.heightPixels
	)
		throw stateDrift("Published oversized PNG metadata has drifted");
}

export function parseV2CanaryBackfillResult(value: unknown): BackfillResult {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).sort().join(",") !== "replayed,targetCount" ||
		typeof (value as { replayed?: unknown }).replayed !== "boolean" ||
		(value as { targetCount?: unknown }).targetCount !== 12
	) {
		throw stateDrift("Convex authority backfill returned malformed output");
	}
	return value as BackfillResult;
}

async function readBoundedJson(response: Response) {
	const contentType = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
	if (contentType !== "application/json" || !response.body) {
		await response.body?.cancel().catch(() => undefined);
		throw canaryFailure("invalid_attestation", "Worker returned a malformed response");
	}
	const declared = response.headers.get("Content-Length");
	if (declared && (!/^\d+$/.test(declared) || Number(declared) > RESPONSE_MAX_BYTES)) {
		await response.body.cancel().catch(() => undefined);
		throw canaryFailure("invalid_attestation", "Worker returned an oversized response");
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) break;
			length += chunk.value.byteLength;
			if (length > RESPONSE_MAX_BYTES) {
				await reader.cancel().catch(() => undefined);
				throw canaryFailure("invalid_attestation", "Worker returned an oversized response");
			}
			chunks.push(chunk.value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
	} catch {
		throw canaryFailure("invalid_attestation", "Worker returned malformed JSON");
	}
}

function parseWorkerResultValue(
	value: unknown,
	path: typeof V2_CANARY_STORAGE_PATH | typeof V2_CANARY_INSPECTION_PATH,
	expectedReceiptSetId: string,
): WorkerResult {
	const result = objectValue(value, "Worker result");
	const attestation = objectValue(result.attestation, "Worker attestation");
	const decoderPolicy = objectValue(attestation.decoderPolicy, "Worker decoder policy");
	const printSource = objectValue(decoderPolicy.printSource, "Worker print-source policy");
	const paidDigitalFile = objectValue(
		decoderPolicy.paidDigitalFile,
		"Worker paid-digital-file policy",
	);
	const expectedRole: WorkerRole = path === V2_CANARY_STORAGE_PATH ? "storage" : "inspection";
	const expectedPolicyState = expectedRole === "storage" ? "required" : "matched";
	if (
		!exactKeys(result, ["status", "replayed", "assetCount", "receiptSetId", "attestation"]) ||
		!exactKeys(attestation, [
			"schemaVersion",
			"role",
			"derivedReceiptSetId",
			"convexDeployment",
			"convexSiteOrigin",
			"decoderPolicy",
			"decoderPolicyState",
		]) ||
		!exactKeys(decoderPolicy, ["printSource", "paidDigitalFile"]) ||
		!exactKeys(printSource, ["method", "sharpVersion", "libvipsVersion"]) ||
		!exactKeys(paidDigitalFile, ["method"]) ||
		(result.status !== "pending_inspection" && result.status !== "verified") ||
		typeof result.replayed !== "boolean" ||
		result.assetCount !== 3 ||
		result.receiptSetId !== expectedReceiptSetId ||
		attestation.schemaVersion !== 2 ||
		attestation.role !== expectedRole ||
		attestation.derivedReceiptSetId !== expectedReceiptSetId ||
		attestation.convexDeployment !== V2_CANARY_CONVEX_SELECTOR ||
		attestation.convexSiteOrigin !== V2_CANARY_CONVEX_SITE_ORIGIN ||
		printSource.method !== V2_CANARY_DECODER_POLICY.printSource.method ||
		printSource.sharpVersion !== V2_CANARY_DECODER_POLICY.printSource.sharpVersion ||
		printSource.libvipsVersion !== V2_CANARY_DECODER_POLICY.printSource.libvipsVersion ||
		paidDigitalFile.method !== V2_CANARY_DECODER_POLICY.paidDigitalFile.method ||
		attestation.decoderPolicyState !== expectedPolicyState
	)
		throw canaryFailure("invalid_attestation", "Worker returned an invalid receipt attestation");
	return result as WorkerResult;
}

function parseWorkerResult(
	value: unknown,
	path: typeof V2_CANARY_STORAGE_PATH | typeof V2_CANARY_INSPECTION_PATH,
	expectedReceiptSetId: string,
) {
	try {
		return parseWorkerResultValue(value, path, expectedReceiptSetId);
	} catch (error) {
		if (error instanceof V2CanaryFailureError) throw error;
		throw canaryFailure("invalid_attestation", "Worker returned an invalid receipt attestation");
	}
}

export async function postV2CanaryWorkerReceipt({
	path,
	secret,
	privateObjectKeys,
	expectedReceiptSetId,
	fetcher = fetch,
}: {
	path: typeof V2_CANARY_STORAGE_PATH | typeof V2_CANARY_INSPECTION_PATH;
	secret: string;
	privateObjectKeys: readonly string[];
	expectedReceiptSetId: string;
	fetcher?: typeof fetch;
}) {
	if (path !== V2_CANARY_STORAGE_PATH && path !== V2_CANARY_INSPECTION_PATH) {
		throw canaryFailure("operator", "Worker route is not allowlisted");
	}
	if (
		privateObjectKeys.length !== 3 ||
		new Set(privateObjectKeys).size !== 3 ||
		!/^catalog-private-assets-v2:[a-f0-9]{64}$/.test(expectedReceiptSetId) ||
		secret.length < SECRET_MIN_BYTES ||
		secret.length > SECRET_MAX_BYTES ||
		secret !== secret.trim() ||
		/[\r\n]/.test(secret)
	)
		throw canaryFailure("operator", "Worker canary request is invalid");
	let response: Response;
	try {
		response = await fetcher(`${V2_CANARY_WORKER_ORIGIN}${path}`, {
			method: "POST",
			headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
			body: JSON.stringify({
				schemaVersion: 2,
				siteUrl: V2_CANARY_SITE_URL,
				privateObjectKeys,
				expectation: {
					receiptSetId: expectedReceiptSetId,
					convexDeployment: V2_CANARY_CONVEX_SELECTOR,
					convexSiteOrigin: V2_CANARY_CONVEX_SITE_ORIGIN,
					decoderPolicy: V2_CANARY_DECODER_POLICY,
				},
			}),
			redirect: "error",
			signal: AbortSignal.timeout(path === V2_CANARY_INSPECTION_PATH ? 300_000 : 30_000),
		});
	} catch {
		throw canaryFailure(
			"transport",
			"Worker request did not complete; rerun resumes from server state",
		);
	}
	if (response.redirected || !response.ok) {
		await response.body?.cancel().catch(() => undefined);
		const httpStatus = boundedHttpStatus(response.status);
		const failure =
			response.status >= 400 && response.status <= 499
				? "worker_4xx"
				: response.status >= 500 && response.status <= 599
					? "worker_5xx"
					: "transport";
		throw canaryFailure(
			failure,
			"Worker request was rejected; rerun resumes from server state",
			httpStatus,
		);
	}
	try {
		return parseWorkerResult(await readBoundedJson(response), path, expectedReceiptSetId);
	} catch (error) {
		if (error instanceof V2CanaryFailureError) throw error;
		throw canaryFailure(
			"transport",
			"Worker response did not complete; rerun resumes from server state",
		);
	}
}

function parseSnapshotValue(value: unknown): CanarySnapshot {
	const snapshot = objectValue(value, "Convex snapshot");
	const canary = objectValue(snapshot.canary, "Convex canary projection");
	const oversizedPng = objectValue(canary.oversizedPng, "Convex PNG projection");
	const v2 = objectValue(snapshot.v2, "Convex V2 projection");
	const counts = objectValue(snapshot.counts, "Convex count projection");
	const digests = objectValue(snapshot.digests, "Convex digest projection");
	if (
		!exactKeys(snapshot, ["schemaVersion", "canary", "v2", "counts", "digests"]) ||
		!exactKeys(canary, ["receiptSetId", "targets", "oversizedPng"]) ||
		!exactKeys(oversizedPng, ["sizeBytes", "widthPixels", "heightPixels"]) ||
		!exactKeys(v2, ["status", "evidence"]) ||
		!exactKeys(counts, SNAPSHOT_COUNT_KEYS) ||
		!exactKeys(digests, SNAPSHOT_DIGEST_KEYS) ||
		snapshot.schemaVersion !== 1 ||
		typeof canary.receiptSetId !== "string" ||
		!/^catalog-private-assets-v2:[a-f0-9]{64}$/.test(canary.receiptSetId) ||
		!Array.isArray(canary.targets) ||
		canary.targets.length !== 3 ||
		oversizedPng.sizeBytes !== EXPECTED_PNG.sizeBytes ||
		oversizedPng.widthPixels !== EXPECTED_PNG.widthPixels ||
		oversizedPng.heightPixels !== EXPECTED_PNG.heightPixels ||
		(v2.status !== "absent" && v2.status !== "pending_inspection" && v2.status !== "verified") ||
		Object.values(counts).some(
			(count) => typeof count !== "number" || !Number.isSafeInteger(count) || count < 0,
		) ||
		Object.values(digests).some((hash) => typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash))
	)
		throw new Error("Convex snapshot is malformed");
	for (const [index, expected] of PINNED.entries()) {
		const target = objectValue(canary.targets[index], "Convex target projection");
		if (
			!exactKeys(target, ["label", "kind", "targetId"]) ||
			target.label !== expected.label ||
			target.kind !== expected.kind ||
			target.targetId !== expected.targetId
		) {
			throw new Error("Convex target projection differs from the checked journal");
		}
	}
	if (v2.status === "verified") {
		const evidence = objectValue(v2.evidence, "Convex evidence projection");
		if (
			!exactKeys(evidence, ["fullRaster", "safeZip", "sharpVersion", "libvipsVersion"]) ||
			evidence.fullRaster !== true ||
			evidence.safeZip !== true ||
			evidence.sharpVersion !== "0.35.3" ||
			evidence.libvipsVersion !== "8.18.3"
		)
			throw new Error("Convex evidence projection is invalid");
	} else if (v2.evidence !== null) {
		throw new Error("Unverified Convex snapshot contains evidence");
	}
	return snapshot as unknown as CanarySnapshot;
}

function parseSnapshot(value: unknown) {
	try {
		return parseSnapshotValue(value);
	} catch (error) {
		if (error instanceof V2CanaryFailureError) throw error;
		throw stateDrift("Convex snapshot is malformed");
	}
}

export async function runV2CanaryConvexFunction({
	repositoryRoot,
	functionName,
}: {
	repositoryRoot: string;
	functionName:
		| "catalogPrivateAssets:getV2CanarySnapshot"
		| "catalogPrivateAssets:backfillTargetAuthorities";
}) {
	if (
		functionName !== "catalogPrivateAssets:getV2CanarySnapshot" &&
		functionName !== "catalogPrivateAssets:backfillTargetAuthorities"
	)
		throw new Error("Convex function is not allowlisted");
	const convexCli = resolve(repositoryRoot, "node_modules/convex/bin/main.js");
	const args = {};
	let stdout: string;
	let selectorDirectory: string | undefined;
	try {
		selectorDirectory = await mkdtemp(join(tmpdir(), "angelsrest-v2-canary-convex-"));
		const selectorPath = join(selectorDirectory, "selector.env");
		await writeFile(selectorPath, `CONVEX_DEPLOYMENT=${V2_CANARY_CONVEX_SELECTOR}\n`, {
			flag: "wx",
			mode: 0o600,
		});
		const result = await execFileAsync(
			process.execPath,
			[
				convexCli,
				"run",
				functionName,
				JSON.stringify(args),
				"--env-file",
				selectorPath,
				"--codegen",
				"disable",
				"--typecheck",
				"disable",
			],
			{
				cwd: repositoryRoot,
				env: v2CanaryConvexChildEnvironment(process.env),
				timeout: 60_000,
				maxBuffer: CONVEX_OUTPUT_MAX_BYTES,
				windowsHide: true,
			},
		);
		if (result.stderr.trim()) throw new Error("stderr");
		stdout = result.stdout;
	} catch {
		throw new Error("Bounded Convex operator command failed without changing retry policy");
	} finally {
		if (selectorDirectory) {
			await rm(selectorDirectory, { force: true, recursive: true }).catch(() => undefined);
		}
	}
	try {
		return JSON.parse(stdout) as unknown;
	} catch {
		throw stateDrift("Bounded Convex operator command returned malformed output");
	}
}

function snapshotBytes(value: unknown) {
	return JSON.stringify(value);
}

function requireSameSnapshot(left: CanarySnapshot, right: CanarySnapshot, label: string) {
	if (snapshotBytes(left) !== snapshotBytes(right)) {
		throw stateDrift(`${label} changed the snapshot`);
	}
}

function requireOnlyDigestChanged(
	before: CanarySnapshot,
	after: CanarySnapshot,
	allowedCounts: readonly string[],
	allowedDigests: readonly string[],
	label: string,
) {
	if (snapshotBytes(before.canary) !== snapshotBytes(after.canary)) {
		throw stateDrift(`${label} changed canary identity`);
	}
	for (const key of new Set([...Object.keys(before.counts), ...Object.keys(after.counts)])) {
		if (!allowedCounts.includes(key) && before.counts[key] !== after.counts[key]) {
			throw stateDrift(`${label} changed an unapproved table count`);
		}
	}
	for (const key of new Set([...Object.keys(before.digests), ...Object.keys(after.digests)])) {
		if (!allowedDigests.includes(key) && before.digests[key] !== after.digests[key]) {
			throw stateDrift(`${label} changed an unapproved state domain`);
		}
	}
}

function requireBaseline(snapshot: CanarySnapshot) {
	if (
		snapshot.counts.authorities !== 12 ||
		snapshot.counts.printTargets !== 11 ||
		snapshot.counts.paidTargets !== 1 ||
		snapshot.counts.publicationPointers !== 0
	)
		throw stateDrift("Convex pre-canary baseline is not the reviewed 11+1 unpublished state");
}

async function runV2CanaryTransportBoundary<T>(operation: () => Promise<T>) {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof V2CanaryFailureError) throw error;
		throw canaryFailure("transport", "V2 canary operation did not complete");
	}
}

export async function executeV2CanaryStateMachine({
	dependencies,
	tenantSecret,
	inspectionSecret,
	privateObjectKeys,
	preManifest,
	onPhase = () => undefined,
}: {
	dependencies: V2CanaryExecutionDependencies;
	tenantSecret: string;
	inspectionSecret: string;
	privateObjectKeys: readonly string[];
	preManifest: string;
	onPhase?: (phase: V2CanaryPhase) => void;
}) {
	const snapshot = async () =>
		parseSnapshot(await runV2CanaryTransportBoundary(dependencies.snapshot));
	const backfill = async () =>
		parseV2CanaryBackfillResult(await runV2CanaryTransportBoundary(dependencies.backfill));
	let canaryReceiptSetId = "";
	const postWorker = async (
		path: typeof V2_CANARY_STORAGE_PATH | typeof V2_CANARY_INSPECTION_PATH,
		secret: string,
	) =>
		await runV2CanaryTransportBoundary(async () =>
			dependencies.postWorker(path, secret, privateObjectKeys, canaryReceiptSetId),
		);

	onPhase("preflight");
	const initial = await snapshot();
	if (initial.counts.authorities !== 0 && initial.counts.authorities !== 12) {
		throw stateDrift("Authority state is partial; no mutation was attempted");
	}
	onPhase("backfill");
	const firstBackfill = await backfill();
	const afterBackfill = await snapshot();
	if (initial.counts.authorities === 0) {
		if (
			firstBackfill.replayed ||
			firstBackfill.targetCount !== 12 ||
			afterBackfill.counts.authorities !== 12
		) {
			throw stateDrift("Authority backfill did not create the exact verified V1 authority set");
		}
		requireOnlyDigestChanged(
			initial,
			afterBackfill,
			["authorities"],
			["authorities"],
			"Authority backfill",
		);
	} else {
		if (!firstBackfill.replayed || firstBackfill.targetCount !== 12) {
			throw stateDrift("Authority backfill replay was not zero-write");
		}
		requireSameSnapshot(initial, afterBackfill, "Authority backfill replay");
	}
	const secondBackfill = await backfill();
	const preCanary = await snapshot();
	if (!secondBackfill.replayed || secondBackfill.targetCount !== 12) {
		throw stateDrift("Second authority backfill was not the exact zero-write replay");
	}
	requireSameSnapshot(afterBackfill, preCanary, "Second authority backfill");
	requireBaseline(preCanary);
	if (preCanary.canary.receiptSetId.length === 0) {
		throw stateDrift("Canary receipt identity is missing");
	}
	canaryReceiptSetId = preCanary.canary.receiptSetId;

	onPhase("storage_resume");
	const storage = parseWorkerResult(
		await postWorker(V2_CANARY_STORAGE_PATH, tenantSecret),
		V2_CANARY_STORAGE_PATH,
		preCanary.canary.receiptSetId,
	);
	if (storage.receiptSetId !== preCanary.canary.receiptSetId) {
		throw stateDrift("Worker storage receipt identity differs from the internal canary");
	}
	const afterStorage = await snapshot();
	if (preCanary.v2.status === "absent") {
		if (
			storage.status !== "pending_inspection" ||
			storage.replayed ||
			afterStorage.v2.status !== "pending_inspection"
		) {
			throw stateDrift(
				"First storage receipt did not create only the expected pending coordination",
			);
		}
		requireOnlyDigestChanged(
			preCanary,
			afterStorage,
			["receiptCoordinations"],
			["receipts", "coordinations", "timestamps"],
			"First storage receipt",
		);
	} else {
		if (!storage.replayed || storage.status !== preCanary.v2.status) {
			throw stateDrift("Storage resume did not exactly replay server state");
		}
		requireSameSnapshot(preCanary, afterStorage, "Storage resume");
	}

	onPhase("storage_replay");
	const storageReplay = parseWorkerResult(
		await postWorker(V2_CANARY_STORAGE_PATH, tenantSecret),
		V2_CANARY_STORAGE_PATH,
		preCanary.canary.receiptSetId,
	);
	const afterStorageReplay = await snapshot();
	if (
		!storageReplay.replayed ||
		storageReplay.receiptSetId !== preCanary.canary.receiptSetId ||
		storageReplay.status !== afterStorage.v2.status
	) {
		throw stateDrift("Storage replay did not match observed server status");
	}
	requireSameSnapshot(afterStorage, afterStorageReplay, "Pending storage replay");

	onPhase("inspection");
	const inspection = parseWorkerResult(
		await postWorker(V2_CANARY_INSPECTION_PATH, inspectionSecret),
		V2_CANARY_INSPECTION_PATH,
		preCanary.canary.receiptSetId,
	);
	if (
		inspection.receiptSetId !== preCanary.canary.receiptSetId ||
		inspection.status !== "verified"
	) {
		throw stateDrift("Worker inspection did not verify the internal canary identity");
	}
	const afterInspection = await snapshot();
	if (afterStorageReplay.v2.status === "pending_inspection") {
		if (inspection.replayed || afterInspection.v2.status !== "verified") {
			throw stateDrift("Inspection did not atomically complete the pending canary");
		}
		requireOnlyDigestChanged(
			afterStorageReplay,
			afterInspection,
			[],
			["receipts", "coordinations", "timestamps"],
			"Inspection completion",
		);
	} else {
		if (!inspection.replayed) throw stateDrift("Inspection resume was not an exact replay");
		requireSameSnapshot(afterStorageReplay, afterInspection, "Inspection resume");
	}
	requireBaseline(afterInspection);
	const acceptedEvidence = afterInspection.v2.evidence;
	if (!acceptedEvidence?.fullRaster || !acceptedEvidence.safeZip) {
		throw stateDrift("Verified canary lacks accepted full-raster or safe-ZIP evidence");
	}

	onPhase("final_replay");
	const finalStorage = parseWorkerResult(
		await postWorker(V2_CANARY_STORAGE_PATH, tenantSecret),
		V2_CANARY_STORAGE_PATH,
		preCanary.canary.receiptSetId,
	);
	const afterFinalStorage = await snapshot();
	if (finalStorage.status !== "verified" || !finalStorage.replayed) {
		throw stateDrift("Verified storage replay failed");
	}
	requireSameSnapshot(afterInspection, afterFinalStorage, "Verified storage replay");

	const finalInspection = parseWorkerResult(
		await postWorker(V2_CANARY_INSPECTION_PATH, inspectionSecret),
		V2_CANARY_INSPECTION_PATH,
		preCanary.canary.receiptSetId,
	);
	const final = await snapshot();
	if (finalInspection.status !== "verified" || !finalInspection.replayed) {
		throw stateDrift("Verified inspection replay failed");
	}
	requireSameSnapshot(afterFinalStorage, final, "Verified inspection replay");
	if ((await runV2CanaryTransportBoundary(dependencies.readPublishedManifest)) !== preManifest) {
		throw stateDrift("Published Sanity manifest drifted during the canary; no report was written");
	}
	return {
		schemaVersion: 2 as const,
		status: "verified" as const,
		mode: "execute" as const,
		completedAt: new Date().toISOString(),
		convexDeployment: V2_CANARY_CONVEX_SELECTOR,
		receiptSetId: preCanary.canary.receiptSetId,
		assetCount: 3 as const,
		labels: V2_CANARY_LABELS,
		checks: {
			authorityCount: final.counts.authorities,
			printTargetCount: final.counts.printTargets,
			paidTargetCount: final.counts.paidTargets,
			publicationPointerCount: final.counts.publicationPointers,
			fullRaster: true,
			safeZip: true,
			sharpVersion: acceptedEvidence.sharpVersion,
			libvipsVersion: acceptedEvidence.libvipsVersion,
			byteIdenticalReplays: true,
			sanityManifestUnchanged: true,
		},
	};
}
