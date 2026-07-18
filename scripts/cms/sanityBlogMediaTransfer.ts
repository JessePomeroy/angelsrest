import { createHash } from "node:crypto";
import {
	ANGELS_REST_BLOG_MEDIA_EXPECTATIONS,
	type BlogMediaSource,
	parseSanityBlogImageAssetJournal,
	parseSanityBlogMediaTransferReceipts,
	type SanityBlogMediaTransferReceipt,
	type SanityBlogMediaTransferReceipts,
} from "./sanityBlogMediaVerification";

const SANITY_IMAGE_REF_PATTERN = /^image-([0-9a-f]{40})-([1-9]\d*)x([1-9]\d*)-(jpg|png|webp)$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONVEX_ID_PATTERN = /^[a-z0-9]{20,64}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CMS_MEDIA_WORKER_ORIGIN = "https://cms-media-worker.thinkingofview.workers.dev";
const CMS_MEDIA_CAPABILITY_PATH = "/api/admin/media/capability";
const CMS_MEDIA_PROCESS_PATH = "/api/admin/media/process";
const CMS_MEDIA_UPLOAD_PATH = "/v1/uploads/source";
const MIN_CAPABILITY_LIFETIME_MS = 2 * 60 * 1000;
const MAX_CAPABILITY_LIFETIME_MS = 16 * 60 * 1000;
const ACTIVE_OPERATION_MESSAGE = "CMS media asset operation is already in progress";
const MAX_PROCESS_ATTEMPTS = 3;

export const CMS_BLOG_MEDIA_BATCH_ID = "CMS-4.4k" as const;
export const CMS_BLOG_MEDIA_PRODUCTION_ORIGIN = "https://www.angelsrest.online";
export const CMS_BLOG_MEDIA_PRODUCTION_CONFIRMATION = `transfer ${CMS_BLOG_MEDIA_BATCH_ID} two-asset batch to www.angelsrest.online`;
export const CMS_BLOG_MEDIA_SOURCE_ASSET_REFS = [
	"image-d4ee0889a5b82e47027dc57c39604a9320896875-2624x1876-png",
	"image-12b028c5acab8e557ef9736cc9def77ecc33f706-600x600-jpg",
] as const;

export type CmsBlogMediaSourceAssetRef = (typeof CMS_BLOG_MEDIA_SOURCE_ASSET_REFS)[number];

export const CMS_BLOG_MEDIA_SOURCE_EXPECTATIONS: Record<
	CmsBlogMediaSourceAssetRef,
	BlogMediaSource & { sourceSha256: string }
> = {
	"image-d4ee0889a5b82e47027dc57c39604a9320896875-2624x1876-png": {
		contentType: "image/png",
		sizeBytes: 1_760_970,
		width: 2624,
		height: 1876,
		sourceSha256: "6efa62af18bad456200e5d0057775a581aa47840b5094b02e947e0e9e01d2888",
	},
	"image-12b028c5acab8e557ef9736cc9def77ecc33f706-600x600-jpg": {
		contentType: "image/jpeg",
		sizeBytes: 66_734,
		width: 600,
		height: 600,
		sourceSha256: "84eb6d26a16ad4635d85c87e55ef8353c87100449266f48231b37d95838fa39b",
	},
};

export type SanityBlogMediaTransferOptions =
	| { mode: "plan" }
	| {
			mode: "execute";
			cookieFile: string;
			sourceAssetRefs: readonly CmsBlogMediaSourceAssetRef[];
	  };

export type SanityBlogMediaTransferPlanItem = {
	sourceAssetRef: CmsBlogMediaSourceAssetRef;
	status: "pending" | "already-mapped";
	source: BlogMediaSource & { sourceSha256: string };
};

export type CmsMediaCapability = {
	assetId: string;
	privateObjectKey: string;
	uploadUrl: string;
	uploadToken: string;
	expiresAt: string;
};

export type RegisteredCmsMediaAsset = {
	mediaAssetId: string;
	workerAssetId: string;
	source: BlogMediaSource;
};

export type SanityBlogMediaTransferAssetPhase =
	| "source-validated"
	| "capability-issued"
	| "put-attempted"
	| "registered"
	| "registry-verified"
	| "receipt-committed"
	| "journals-committed"
	| "complete";

export type SanityBlogMediaTransferAssetCheckpoint = {
	phase: SanityBlogMediaTransferAssetPhase;
	sourceSha256: string;
	source: BlogMediaSource;
	workerAssetId?: string;
	sourceExtension?: "jpg" | "png" | "webp";
	mediaAssetId?: string;
};

export type SanityBlogMediaTransferCheckpoint = {
	schemaVersion: 1;
	migration: typeof CMS_BLOG_MEDIA_BATCH_ID;
	siteUrl: "angelsrest.online";
	sourceAssetRefs: readonly CmsBlogMediaSourceAssetRef[];
	journalDigests: { imageAssetMap: string; transferReceipts: string };
	nextAssetIndex: number;
	assets: Partial<Record<CmsBlogMediaSourceAssetRef, SanityBlogMediaTransferAssetCheckpoint>>;
};

export type TransferProgressStage =
	| "source-validated"
	| "capability-issued"
	| "put-attempted"
	| "processing"
	| "registered";

export type SanityBlogMediaJournalCommitState =
	| "baseline"
	| "receipt-committed"
	| "journals-committed";

export class SanityBlogMediaTransferError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly resumable = false,
	) {
		super(message);
		this.name = "SanityBlogMediaTransferError";
	}
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new SanityBlogMediaTransferError("invalid-response", `${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
		throw new SanityBlogMediaTransferError(
			"invalid-response",
			`${label} has unexpected or missing fields`,
		);
	}
}

function trimmedString(value: unknown, label: string) {
	if (typeof value !== "string" || !value || value !== value.trim()) {
		throw new SanityBlogMediaTransferError(
			"invalid-response",
			`${label} must be a non-empty trimmed string`,
		);
	}
	return value;
}

function positiveInteger(value: unknown, label: string) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
		throw new SanityBlogMediaTransferError(
			"invalid-response",
			`${label} must be a positive integer`,
		);
	}
	return value;
}

function parseSource(value: unknown, label: string): BlogMediaSource {
	const source = objectValue(value, label);
	exactKeys(source, ["contentType", "sizeBytes", "width", "height"], label);
	if (
		source.contentType !== "image/jpeg" &&
		source.contentType !== "image/png" &&
		source.contentType !== "image/webp"
	) {
		throw new SanityBlogMediaTransferError("invalid-response", `${label}.contentType is invalid`);
	}
	return {
		contentType: source.contentType,
		sizeBytes: positiveInteger(source.sizeBytes, `${label}.sizeBytes`),
		width: positiveInteger(source.width, `${label}.width`),
		height: positiveInteger(source.height, `${label}.height`),
	};
}

function sameSource(left: BlogMediaSource, right: BlogMediaSource) {
	return (
		left.contentType === right.contentType &&
		left.sizeBytes === right.sizeBytes &&
		left.width === right.width &&
		left.height === right.height
	);
}

function sha256Bytes(bytes: Uint8Array) {
	return createHash("sha256").update(bytes).digest("hex");
}

function isCmsBlogMediaSourceRef(value: string): value is CmsBlogMediaSourceAssetRef {
	return (CMS_BLOG_MEDIA_SOURCE_ASSET_REFS as readonly string[]).includes(value);
}

function sourceRefParts(sourceAssetRef: string) {
	const match = SANITY_IMAGE_REF_PATTERN.exec(sourceAssetRef);
	if (!match) {
		throw new SanityBlogMediaTransferError("invalid-source", "Source reference is not canonical");
	}
	const [, assetId, width, height, extension] = match;
	return {
		assetId,
		width: Number(width),
		height: Number(height),
		extension: extension as "jpg" | "png" | "webp",
		contentType: (extension === "jpg" ? "image/jpeg" : `image/${extension}`) as
			| "image/jpeg"
			| "image/png"
			| "image/webp",
	};
}

export function deterministicSanitySourceFilename(sourceAssetRef: string) {
	const { assetId, width, height, extension } = sourceRefParts(sourceAssetRef);
	return `${assetId}-${width}x${height}.${extension}`;
}

export function parseSanityBlogMediaTransferOptions(
	args: readonly string[],
): SanityBlogMediaTransferOptions {
	let execute = false;
	let confirmation: string | undefined;
	let cookieFile: string | undefined;
	const sourceAssetRefs: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") continue;
		if (arg === "--execute") {
			if (execute) throw new Error("--execute may only be supplied once");
			execute = true;
			continue;
		}
		if (arg === "--confirm" || arg === "--cookie-file" || arg === "--source-ref") {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
			if (arg === "--confirm") {
				if (confirmation !== undefined) throw new Error("--confirm may only be supplied once");
				confirmation = value;
			}
			if (arg === "--cookie-file") {
				if (cookieFile !== undefined) throw new Error("--cookie-file may only be supplied once");
				cookieFile = value;
			}
			if (arg === "--source-ref") sourceAssetRefs.push(value);
			index += 1;
			continue;
		}
		throw new Error(`Unsupported argument: ${arg}`);
	}
	if (!execute) {
		if (confirmation !== undefined || cookieFile !== undefined || sourceAssetRefs.length > 0) {
			throw new Error("Execution options require --execute");
		}
		return { mode: "plan" };
	}
	if (confirmation !== CMS_BLOG_MEDIA_PRODUCTION_CONFIRMATION) {
		throw new Error(`--confirm must exactly equal "${CMS_BLOG_MEDIA_PRODUCTION_CONFIRMATION}"`);
	}
	if (!cookieFile || cookieFile !== cookieFile.trim()) {
		throw new Error("--cookie-file requires one trimmed path");
	}
	if (sourceAssetRefs.length !== CMS_BLOG_MEDIA_SOURCE_ASSET_REFS.length) {
		throw new Error("Execution requires exactly two explicit --source-ref values");
	}
	if (new Set(sourceAssetRefs).size !== sourceAssetRefs.length) {
		throw new Error("Execution source references must be unique");
	}
	if (sourceAssetRefs.some((ref) => !isCmsBlogMediaSourceRef(ref))) {
		throw new Error("Execution is restricted to the active reviewed source batch");
	}
	return {
		mode: "execute",
		cookieFile,
		sourceAssetRefs: CMS_BLOG_MEDIA_SOURCE_ASSET_REFS,
	};
}

export function createSanityBlogMediaTransferPlan({
	journal,
	receiptFile,
	publishedSourceAssetRefs,
	allowExistingMappings,
}: {
	journal: Readonly<Record<string, string>>;
	receiptFile: SanityBlogMediaTransferReceipts;
	publishedSourceAssetRefs: readonly string[];
	allowExistingMappings: boolean;
}): SanityBlogMediaTransferPlanItem[] {
	const published = new Set(publishedSourceAssetRefs);
	const journalRefs = Object.keys(journal);
	if (
		journalRefs.length !== published.size ||
		journalRefs.some((ref) => !published.has(ref)) ||
		publishedSourceAssetRefs.some((ref) => !(ref in journal))
	) {
		throw new Error("Published Sanity source set and media journal have drifted");
	}
	return CMS_BLOG_MEDIA_SOURCE_ASSET_REFS.map((sourceAssetRef) => {
		if (!published.has(sourceAssetRef)) {
			throw new Error("The active reviewed source batch is not fully published");
		}
		const mediaAssetId = journal[sourceAssetRef] ?? "";
		const receipt = receiptFile.receipts[sourceAssetRef];
		if (Boolean(mediaAssetId) !== Boolean(receipt)) {
			throw new Error("A selected source has inconsistent mapping provenance");
		}
		if (mediaAssetId && receipt?.mediaAssetId !== mediaAssetId) {
			throw new Error("A selected source mapping and receipt disagree");
		}
		if (mediaAssetId && !allowExistingMappings) {
			throw new Error("Execution refuses a selected source that is already mapped");
		}
		return {
			sourceAssetRef,
			status: mediaAssetId ? "already-mapped" : "pending",
			source: CMS_BLOG_MEDIA_SOURCE_EXPECTATIONS[sourceAssetRef],
		};
	});
}

export function validateSanityBlogMediaSource(
	sourceAssetRef: CmsBlogMediaSourceAssetRef,
	bytes: Uint8Array,
	decoded: { format?: string; width?: number; height?: number },
) {
	const expected = CMS_BLOG_MEDIA_SOURCE_EXPECTATIONS[sourceAssetRef];
	return validateSanityImageSourceAgainstExpectation({
		sourceAssetRef,
		bytes,
		decoded,
		expected,
	});
}

export function validateSanityImageSourceAgainstExpectation({
	sourceAssetRef,
	bytes,
	decoded,
	expected,
}: {
	sourceAssetRef: string;
	bytes: Uint8Array;
	decoded: { format?: string; width?: number; height?: number };
	expected: BlogMediaSource & { sourceSha256: string };
}) {
	const parts = sourceRefParts(sourceAssetRef);
	const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
	if (
		expected.contentType !== parts.contentType ||
		expected.width !== parts.width ||
		expected.height !== parts.height
	) {
		throw new Error("Reviewed Sanity source expectation does not match its asset reference");
	}
	// The asset ID identifies Sanity's uploaded original, while its public CDN may
	// serve a different byte representation. The exact allowlisted reference and
	// reviewed SHA-256 deliberately protect those two boundaries independently.
	if (sourceSha256 !== expected.sourceSha256) {
		throw new Error("Sanity source SHA-256 differs from the active reviewed batch");
	}
	if (bytes.byteLength !== expected.sizeBytes) {
		throw new Error("Sanity source byte count differs from the active reviewed batch");
	}
	const expectedFormat = parts.extension === "jpg" ? "jpeg" : parts.extension;
	if (
		decoded.format !== expectedFormat ||
		decoded.width !== parts.width ||
		decoded.height !== parts.height
	) {
		throw new Error("Sanity source decoded image metadata is invalid");
	}
	return {
		sourceAssetRef,
		sourceSha256,
		source: {
			contentType: expected.contentType,
			sizeBytes: expected.sizeBytes,
			width: expected.width,
			height: expected.height,
		} satisfies BlogMediaSource,
	};
}

export function privateObjectKeyForAsset(workerAssetId: string, extension: "jpg" | "png" | "webp") {
	if (!UUID_V4_PATTERN.test(workerAssetId)) throw new Error("Worker identity is not a UUID v4");
	return `sites/${ANGELS_REST_BLOG_MEDIA_EXPECTATIONS.siteUrl}/web/${workerAssetId}/source.${extension}`;
}

export function parseCmsMediaCapability(
	value: unknown,
	{ sourceAssetRef, nowMs }: { sourceAssetRef: CmsBlogMediaSourceAssetRef; nowMs: number },
): CmsMediaCapability {
	const capability = objectValue(value, "CMS media capability");
	exactKeys(
		capability,
		["assetId", "privateObjectKey", "uploadUrl", "uploadToken", "expiresAt"],
		"CMS media capability",
	);
	const assetId = trimmedString(capability.assetId, "capability.assetId");
	if (!UUID_V4_PATTERN.test(assetId)) {
		throw new SanityBlogMediaTransferError("invalid-capability", "Capability asset ID is invalid");
	}
	const extension = sourceRefParts(sourceAssetRef).extension;
	const privateObjectKey = trimmedString(
		capability.privateObjectKey,
		"capability.privateObjectKey",
	);
	if (privateObjectKey !== privateObjectKeyForAsset(assetId, extension)) {
		throw new SanityBlogMediaTransferError(
			"invalid-capability",
			"Capability private object identity is invalid",
		);
	}
	const uploadUrlString = trimmedString(capability.uploadUrl, "capability.uploadUrl");
	let uploadUrl: URL;
	try {
		uploadUrl = new URL(uploadUrlString);
	} catch {
		throw new SanityBlogMediaTransferError(
			"invalid-capability",
			"Capability upload URL is invalid",
		);
	}
	const queryEntries = [...uploadUrl.searchParams.entries()];
	if (
		uploadUrl.origin !== CMS_MEDIA_WORKER_ORIGIN ||
		uploadUrl.pathname !== CMS_MEDIA_UPLOAD_PATH ||
		uploadUrl.username ||
		uploadUrl.password ||
		uploadUrl.hash ||
		queryEntries.length !== 1 ||
		queryEntries[0]?.[0] !== "key" ||
		queryEntries[0]?.[1] !== privateObjectKey
	) {
		throw new SanityBlogMediaTransferError(
			"invalid-capability",
			"Capability upload boundary is invalid",
		);
	}
	const uploadToken = trimmedString(capability.uploadToken, "capability.uploadToken");
	if (uploadToken.length > 4096 || /[\r\n]/.test(uploadToken)) {
		throw new SanityBlogMediaTransferError(
			"invalid-capability",
			"Capability upload token is invalid",
		);
	}
	const expiresAt = trimmedString(capability.expiresAt, "capability.expiresAt");
	const expiryMs = Date.parse(expiresAt);
	const lifetimeMs = expiryMs - nowMs;
	if (
		!Number.isFinite(expiryMs) ||
		new Date(expiryMs).toISOString() !== expiresAt ||
		lifetimeMs < MIN_CAPABILITY_LIFETIME_MS ||
		lifetimeMs > MAX_CAPABILITY_LIFETIME_MS
	) {
		throw new SanityBlogMediaTransferError("invalid-capability", "Capability expiry is invalid");
	}
	return { assetId, privateObjectKey, uploadUrl: uploadUrl.toString(), uploadToken, expiresAt };
}

function validateDerivative(value: unknown, workerAssetId: string, name: "thumb" | "card") {
	const derivative = objectValue(value, `process.asset.derivatives.${name}`);
	exactKeys(
		derivative,
		["key", "contentType", "width", "height"],
		`process.asset.derivatives.${name}`,
	);
	const expectedKey = `sites/${ANGELS_REST_BLOG_MEDIA_EXPECTATIONS.siteUrl}/web/${workerAssetId}/${name}.webp`;
	if (
		derivative.key !== expectedKey ||
		derivative.contentType !== "image/webp" ||
		positiveInteger(derivative.width, `${name}.width`) < 1 ||
		positiveInteger(derivative.height, `${name}.height`) < 1
	) {
		throw new SanityBlogMediaTransferError(
			"invalid-response",
			`Processed ${name} derivative is invalid`,
		);
	}
}

export function parseCmsMediaProcessResult(
	value: unknown,
	{
		sourceAssetRef,
		workerAssetId,
		source,
	}: {
		sourceAssetRef: CmsBlogMediaSourceAssetRef;
		workerAssetId: string;
		source: BlogMediaSource;
	},
): RegisteredCmsMediaAsset {
	const root = objectValue(value, "CMS media process response");
	exactKeys(root, ["asset"], "CMS media process response");
	const asset = objectValue(root.asset, "process.asset");
	exactKeys(
		asset,
		["_id", "assetId", "originalFilename", "status", "source", "derivatives", "createdAt"],
		"process.asset",
	);
	const mediaAssetId = trimmedString(asset._id, "process.asset._id");
	if (!CONVEX_ID_PATTERN.test(mediaAssetId)) {
		throw new SanityBlogMediaTransferError("invalid-response", "Processed Convex ID is invalid");
	}
	if (
		asset.assetId !== workerAssetId ||
		asset.status !== "ready" ||
		asset.originalFilename !== deterministicSanitySourceFilename(sourceAssetRef)
	) {
		throw new SanityBlogMediaTransferError(
			"invalid-response",
			"Processed asset identity is invalid",
		);
	}
	positiveInteger(asset.createdAt, "process.asset.createdAt");
	const processedSource = parseSource(asset.source, "process.asset.source");
	if (!sameSource(processedSource, source)) {
		throw new SanityBlogMediaTransferError(
			"invalid-response",
			"Processed source metadata differs from the validated source",
		);
	}
	const derivatives = objectValue(asset.derivatives, "process.asset.derivatives");
	exactKeys(derivatives, ["thumb", "card"], "process.asset.derivatives");
	validateDerivative(derivatives.thumb, workerAssetId, "thumb");
	validateDerivative(derivatives.card, workerAssetId, "card");
	return { mediaAssetId, workerAssetId, source: processedSource };
}

const CHECKPOINT_PHASES: readonly SanityBlogMediaTransferAssetPhase[] = [
	"source-validated",
	"capability-issued",
	"put-attempted",
	"registered",
	"registry-verified",
	"receipt-committed",
	"journals-committed",
	"complete",
];

function parseCheckpointAsset(
	value: unknown,
	sourceAssetRef: CmsBlogMediaSourceAssetRef,
): SanityBlogMediaTransferAssetCheckpoint {
	const asset = objectValue(value, `checkpoint.assets.${sourceAssetRef}`);
	const phase = asset.phase;
	if (typeof phase !== "string" || !CHECKPOINT_PHASES.includes(phase as never)) {
		throw new Error("Checkpoint asset phase is invalid");
	}
	const needsWorker = phase !== "source-validated";
	const needsMedia = CHECKPOINT_PHASES.indexOf(phase as SanityBlogMediaTransferAssetPhase) >= 3;
	const expectedKeys = ["phase", "sourceSha256", "source"];
	if (needsWorker) expectedKeys.push("workerAssetId", "sourceExtension");
	if (needsMedia) expectedKeys.push("mediaAssetId");
	exactKeys(asset, expectedKeys, `checkpoint.assets.${sourceAssetRef}`);
	const sourceSha256 = trimmedString(asset.sourceSha256, "checkpoint source SHA-256");
	if (!SHA256_PATTERN.test(sourceSha256)) throw new Error("Checkpoint source SHA-256 is invalid");
	const source = parseSource(asset.source, "checkpoint source");
	const parsed: SanityBlogMediaTransferAssetCheckpoint = {
		phase: phase as SanityBlogMediaTransferAssetPhase,
		sourceSha256,
		source,
	};
	if (needsWorker) {
		const workerAssetId = trimmedString(asset.workerAssetId, "checkpoint Worker identity");
		if (!UUID_V4_PATTERN.test(workerAssetId))
			throw new Error("Checkpoint Worker identity is invalid");
		const sourceExtension = asset.sourceExtension;
		if (sourceExtension !== "jpg" && sourceExtension !== "png" && sourceExtension !== "webp") {
			throw new Error("Checkpoint source extension is invalid");
		}
		if (sourceExtension !== sourceRefParts(sourceAssetRef).extension) {
			throw new Error("Checkpoint source extension differs from the source reference");
		}
		parsed.workerAssetId = workerAssetId;
		parsed.sourceExtension = sourceExtension;
	}
	if (needsMedia) {
		const mediaAssetId = trimmedString(asset.mediaAssetId, "checkpoint Convex identity");
		if (!CONVEX_ID_PATTERN.test(mediaAssetId))
			throw new Error("Checkpoint Convex identity is invalid");
		parsed.mediaAssetId = mediaAssetId;
	}
	return parsed;
}

export function parseSanityBlogMediaTransferCheckpoint(
	value: unknown,
): SanityBlogMediaTransferCheckpoint {
	const root = objectValue(value, `${CMS_BLOG_MEDIA_BATCH_ID} checkpoint`);
	exactKeys(
		root,
		[
			"schemaVersion",
			"migration",
			"siteUrl",
			"sourceAssetRefs",
			"journalDigests",
			"nextAssetIndex",
			"assets",
		],
		`${CMS_BLOG_MEDIA_BATCH_ID} checkpoint`,
	);
	if (
		root.schemaVersion !== 1 ||
		root.migration !== CMS_BLOG_MEDIA_BATCH_ID ||
		root.siteUrl !== ANGELS_REST_BLOG_MEDIA_EXPECTATIONS.siteUrl
	) {
		throw new Error("Checkpoint identity is invalid");
	}
	if (
		!Array.isArray(root.sourceAssetRefs) ||
		root.sourceAssetRefs.length !== CMS_BLOG_MEDIA_SOURCE_ASSET_REFS.length ||
		root.sourceAssetRefs.some((ref, index) => ref !== CMS_BLOG_MEDIA_SOURCE_ASSET_REFS[index])
	) {
		throw new Error("Checkpoint source batch is invalid");
	}
	const journalDigests = objectValue(root.journalDigests, "checkpoint journal digests");
	exactKeys(journalDigests, ["imageAssetMap", "transferReceipts"], "checkpoint journal digests");
	const imageAssetMap = trimmedString(journalDigests.imageAssetMap, "mapping digest");
	const transferReceipts = trimmedString(journalDigests.transferReceipts, "receipt digest");
	if (!SHA256_PATTERN.test(imageAssetMap) || !SHA256_PATTERN.test(transferReceipts)) {
		throw new Error("Checkpoint journal digest is invalid");
	}
	if (
		typeof root.nextAssetIndex !== "number" ||
		!Number.isSafeInteger(root.nextAssetIndex) ||
		root.nextAssetIndex < 0 ||
		root.nextAssetIndex > CMS_BLOG_MEDIA_SOURCE_ASSET_REFS.length
	) {
		throw new Error("Checkpoint next asset index is invalid");
	}
	const rawAssets = objectValue(root.assets, "checkpoint assets");
	const assets: SanityBlogMediaTransferCheckpoint["assets"] = {};
	for (const [sourceAssetRef, asset] of Object.entries(rawAssets)) {
		if (!isCmsBlogMediaSourceRef(sourceAssetRef))
			throw new Error("Checkpoint contains a foreign source");
		assets[sourceAssetRef] = parseCheckpointAsset(asset, sourceAssetRef);
	}
	return {
		schemaVersion: 1,
		migration: CMS_BLOG_MEDIA_BATCH_ID,
		siteUrl: ANGELS_REST_BLOG_MEDIA_EXPECTATIONS.siteUrl,
		sourceAssetRefs: CMS_BLOG_MEDIA_SOURCE_ASSET_REFS,
		journalDigests: { imageAssetMap, transferReceipts },
		nextAssetIndex: root.nextAssetIndex,
		assets,
	};
}

export function createInitialSanityBlogMediaTransferCheckpoint(journalDigests: {
	imageAssetMap: string;
	transferReceipts: string;
}): SanityBlogMediaTransferCheckpoint {
	return parseSanityBlogMediaTransferCheckpoint({
		schemaVersion: 1,
		migration: CMS_BLOG_MEDIA_BATCH_ID,
		siteUrl: ANGELS_REST_BLOG_MEDIA_EXPECTATIONS.siteUrl,
		sourceAssetRefs: CMS_BLOG_MEDIA_SOURCE_ASSET_REFS,
		journalDigests,
		nextAssetIndex: 0,
		assets: {},
	});
}

export function replaceCheckpointAsset(
	checkpoint: SanityBlogMediaTransferCheckpoint,
	sourceAssetRef: CmsBlogMediaSourceAssetRef,
	asset: SanityBlogMediaTransferAssetCheckpoint,
	updates: Partial<
		Pick<SanityBlogMediaTransferCheckpoint, "journalDigests" | "nextAssetIndex">
	> = {},
) {
	return parseSanityBlogMediaTransferCheckpoint({
		...checkpoint,
		...updates,
		assets: { ...checkpoint.assets, [sourceAssetRef]: asset },
	});
}

export function createCmsMediaCapabilityRequest(
	adminCookie: string,
	sourceAssetRef: CmsBlogMediaSourceAssetRef,
	source: BlogMediaSource,
) {
	return {
		url: `${CMS_BLOG_MEDIA_PRODUCTION_ORIGIN}${CMS_MEDIA_CAPABILITY_PATH}`,
		init: {
			method: "POST",
			redirect: "error" as const,
			headers: { "Content-Type": "application/json", Cookie: adminCookie },
			body: JSON.stringify({
				filename: deterministicSanitySourceFilename(sourceAssetRef),
				contentType: source.contentType,
				sizeBytes: source.sizeBytes,
			}),
		},
	};
}

export function createCmsMediaUploadRequest(
	capability: CmsMediaCapability,
	bytes: Uint8Array,
	contentType: BlogMediaSource["contentType"],
) {
	return {
		url: capability.uploadUrl,
		init: {
			method: "PUT",
			redirect: "error" as const,
			headers: {
				"Content-Type": contentType,
				"Content-Length": String(bytes.byteLength),
				"X-CMS-Media-Upload-Token": capability.uploadToken,
			},
			body: bytes as BodyInit,
		},
	};
}

export function createCmsMediaProcessRequest(adminCookie: string, privateObjectKey: string) {
	return {
		url: `${CMS_BLOG_MEDIA_PRODUCTION_ORIGIN}${CMS_MEDIA_PROCESS_PATH}`,
		init: {
			method: "POST",
			redirect: "error" as const,
			headers: { "Content-Type": "application/json", Cookie: adminCookie },
			body: JSON.stringify({ privateObjectKey }),
		},
	};
}

async function readJson(response: Response) {
	try {
		return (await response.json()) as unknown;
	} catch {
		throw new SanityBlogMediaTransferError(
			"invalid-response",
			"CMS media boundary returned invalid JSON",
			true,
		);
	}
}

async function processSameAsset({
	fetcher,
	adminCookie,
	privateObjectKey,
	sourceAssetRef,
	workerAssetId,
	source,
	sleep,
}: {
	fetcher: typeof fetch;
	adminCookie: string;
	privateObjectKey: string;
	sourceAssetRef: CmsBlogMediaSourceAssetRef;
	workerAssetId: string;
	source: BlogMediaSource;
	sleep: (milliseconds: number) => Promise<void>;
}) {
	for (let attempt = 1; attempt <= MAX_PROCESS_ATTEMPTS; attempt += 1) {
		let response: Response;
		try {
			const request = createCmsMediaProcessRequest(adminCookie, privateObjectKey);
			response = await fetcher(request.url, request.init);
		} catch {
			if (attempt < MAX_PROCESS_ATTEMPTS) {
				await sleep(500 * attempt);
				continue;
			}
			throw new SanityBlogMediaTransferError(
				"process-ambiguous",
				"CMS media processing outcome is ambiguous; resume the same checkpoint",
				true,
			);
		}
		if (response.ok) {
			return parseCmsMediaProcessResult(await readJson(response), {
				sourceAssetRef,
				workerAssetId,
				source,
			});
		}
		if (response.status === 401 || response.status === 403) {
			throw new SanityBlogMediaTransferError(
				"admin-session-expired",
				"Admin session is no longer authorized; checkpoint preserved",
				true,
			);
		}
		if (response.status === 409) {
			const message = (await response.text()).trim();
			if (message !== ACTIVE_OPERATION_MESSAGE) {
				throw new SanityBlogMediaTransferError(
					"process-conflict",
					"CMS media processing returned an unexpected conflict",
				);
			}
			if (attempt < MAX_PROCESS_ATTEMPTS) {
				await sleep(500 * attempt);
				continue;
			}
			throw new SanityBlogMediaTransferError(
				"operation-in-progress",
				"CMS media processing is still active; resume the same checkpoint later",
				true,
			);
		}
		if (response.status >= 500) {
			if (attempt < MAX_PROCESS_ATTEMPTS) {
				await sleep(500 * attempt);
				continue;
			}
			throw new SanityBlogMediaTransferError(
				"process-ambiguous",
				"CMS media processing did not return a stable result; resume the checkpoint",
				true,
			);
		}
		throw new SanityBlogMediaTransferError(
			"process-rejected",
			`CMS media processing was rejected with status ${response.status}`,
		);
	}
	throw new SanityBlogMediaTransferError("process-ambiguous", "CMS media processing stopped", true);
}

export async function transferSanityBlogMediaAsset({
	checkpoint,
	sourceAssetRef,
	validatedSource,
	sourceBytes,
	adminCookie,
	fetcher,
	writeCheckpoint,
	now = Date.now,
	sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
	onProgress = () => undefined,
}: {
	checkpoint: SanityBlogMediaTransferCheckpoint;
	sourceAssetRef: CmsBlogMediaSourceAssetRef;
	validatedSource: { sourceSha256: string; source: BlogMediaSource };
	sourceBytes: Uint8Array;
	adminCookie: string;
	fetcher: typeof fetch;
	writeCheckpoint: (checkpoint: SanityBlogMediaTransferCheckpoint) => Promise<void>;
	now?: () => number;
	sleep?: (milliseconds: number) => Promise<void>;
	onProgress?: (event: {
		sourceAssetRef: CmsBlogMediaSourceAssetRef;
		stage: TransferProgressStage;
	}) => void;
}) {
	let current = checkpoint;
	if (
		sourceBytes.byteLength !== validatedSource.source.sizeBytes ||
		sha256Bytes(sourceBytes) !== validatedSource.sourceSha256
	) {
		throw new SanityBlogMediaTransferError(
			"source-drift",
			"Source bytes differ from the validated transfer input",
		);
	}
	let asset = current.assets[sourceAssetRef];
	if (asset) {
		if (
			asset.sourceSha256 !== validatedSource.sourceSha256 ||
			!sameSource(asset.source, validatedSource.source)
		) {
			throw new SanityBlogMediaTransferError(
				"source-drift",
				"Validated source differs from the durable checkpoint",
			);
		}
	} else {
		asset = {
			phase: "source-validated",
			sourceSha256: validatedSource.sourceSha256,
			source: validatedSource.source,
		};
		current = replaceCheckpointAsset(current, sourceAssetRef, asset);
		await writeCheckpoint(current);
		onProgress({ sourceAssetRef, stage: "source-validated" });
	}
	if (
		asset.phase === "registered" ||
		asset.phase === "registry-verified" ||
		asset.phase === "receipt-committed" ||
		asset.phase === "journals-committed" ||
		asset.phase === "complete"
	) {
		if (!asset.workerAssetId || !asset.mediaAssetId) {
			throw new SanityBlogMediaTransferError("invalid-checkpoint", "Checkpoint is incomplete");
		}
		return {
			checkpoint: current,
			registered: {
				mediaAssetId: asset.mediaAssetId,
				workerAssetId: asset.workerAssetId,
				source: asset.source,
			} satisfies RegisteredCmsMediaAsset,
		};
	}

	let workerAssetId = asset.workerAssetId;
	let sourceExtension = asset.sourceExtension;
	let privateObjectKey: string;
	if (asset.phase === "put-attempted") {
		if (!workerAssetId || !sourceExtension) {
			throw new SanityBlogMediaTransferError("invalid-checkpoint", "Checkpoint is incomplete");
		}
		privateObjectKey = privateObjectKeyForAsset(workerAssetId, sourceExtension);
	} else {
		const capabilityRequest = createCmsMediaCapabilityRequest(
			adminCookie,
			sourceAssetRef,
			validatedSource.source,
		);
		let capabilityResponse: Response;
		try {
			capabilityResponse = await fetcher(capabilityRequest.url, capabilityRequest.init);
		} catch {
			throw new SanityBlogMediaTransferError(
				"capability-unavailable",
				"CMS media capability request failed before upload",
				true,
			);
		}
		if (!capabilityResponse.ok) {
			throw new SanityBlogMediaTransferError(
				"capability-rejected",
				`CMS media capability request was rejected with status ${capabilityResponse.status}`,
				capabilityResponse.status >= 500 || capabilityResponse.status === 401,
			);
		}
		const capability = parseCmsMediaCapability(await readJson(capabilityResponse), {
			sourceAssetRef,
			nowMs: now(),
		});
		workerAssetId = capability.assetId;
		sourceExtension = sourceRefParts(sourceAssetRef).extension;
		privateObjectKey = capability.privateObjectKey;
		asset = {
			...asset,
			phase: "capability-issued",
			workerAssetId,
			sourceExtension,
		};
		current = replaceCheckpointAsset(current, sourceAssetRef, asset);
		await writeCheckpoint(current);
		onProgress({ sourceAssetRef, stage: "capability-issued" });
		asset = { ...asset, phase: "put-attempted" };
		current = replaceCheckpointAsset(current, sourceAssetRef, asset);
		await writeCheckpoint(current);
		onProgress({ sourceAssetRef, stage: "put-attempted" });
		try {
			const uploadRequest = createCmsMediaUploadRequest(
				capability,
				sourceBytes,
				validatedSource.source.contentType,
			);
			const uploadResponse = await fetcher(uploadRequest.url, uploadRequest.init);
			if (uploadResponse.ok) {
				try {
					const uploaded = objectValue(await readJson(uploadResponse), "CMS media upload response");
					exactKeys(uploaded, ["success", "assetId", "status"], "CMS media upload response");
					if (
						uploaded.success !== true ||
						uploaded.assetId !== workerAssetId ||
						uploaded.status !== "uploaded"
					) {
						throw new Error("ambiguous upload response");
					}
				} catch {
					// A successful PUT with a malformed/lost body is reconciled through processing.
				}
			} else if (uploadResponse.status !== 409 && uploadResponse.status < 500) {
				throw new SanityBlogMediaTransferError(
					"upload-rejected",
					`CMS media upload was rejected with status ${uploadResponse.status}`,
				);
			}
		} catch (error) {
			if (error instanceof SanityBlogMediaTransferError) throw error;
			// A network failure after the durable put-attempted checkpoint is ambiguous.
		}
	}

	if (!workerAssetId || !sourceExtension) {
		throw new SanityBlogMediaTransferError("invalid-checkpoint", "Checkpoint is incomplete");
	}
	onProgress({ sourceAssetRef, stage: "processing" });
	const registered = await processSameAsset({
		fetcher,
		adminCookie,
		privateObjectKey,
		sourceAssetRef,
		workerAssetId,
		source: validatedSource.source,
		sleep,
	});
	asset = {
		...asset,
		phase: "registered",
		workerAssetId,
		sourceExtension,
		mediaAssetId: registered.mediaAssetId,
	};
	current = replaceCheckpointAsset(current, sourceAssetRef, asset);
	await writeCheckpoint(current);
	onProgress({ sourceAssetRef, stage: "registered" });
	return { checkpoint: current, registered };
}

function sameJournalDigests(
	left: SanityBlogMediaTransferCheckpoint["journalDigests"],
	right: SanityBlogMediaTransferCheckpoint["journalDigests"],
) {
	return (
		left.imageAssetMap === right.imageAssetMap && left.transferReceipts === right.transferReceipts
	);
}

export function reconcileSanityBlogMediaJournalState({
	phase,
	checkpointDigests,
	actualDigests,
	baselineDigests,
	candidateDigests,
}: {
	phase: Extract<
		SanityBlogMediaTransferAssetPhase,
		"registered" | "registry-verified" | "receipt-committed" | "journals-committed" | "complete"
	>;
	checkpointDigests: SanityBlogMediaTransferCheckpoint["journalDigests"];
	actualDigests: SanityBlogMediaTransferCheckpoint["journalDigests"];
	baselineDigests: SanityBlogMediaTransferCheckpoint["journalDigests"];
	candidateDigests: SanityBlogMediaTransferCheckpoint["journalDigests"];
}): SanityBlogMediaJournalCommitState {
	const checkpointExpectsCandidate = phase === "journals-committed" || phase === "complete";
	const expectedCheckpointDigests = checkpointExpectsCandidate ? candidateDigests : baselineDigests;
	if (!sameJournalDigests(checkpointDigests, expectedCheckpointDigests)) {
		throw new Error("Versioned Blog media journals changed outside this transfer checkpoint");
	}

	let actualState: SanityBlogMediaJournalCommitState;
	if (sameJournalDigests(actualDigests, baselineDigests)) {
		actualState = "baseline";
	} else if (
		actualDigests.imageAssetMap === baselineDigests.imageAssetMap &&
		actualDigests.transferReceipts === candidateDigests.transferReceipts
	) {
		actualState = "receipt-committed";
	} else if (sameJournalDigests(actualDigests, candidateDigests)) {
		actualState = "journals-committed";
	} else {
		throw new Error("Versioned Blog media journals are in an unrecognized partial state");
	}

	const allowedStates: Record<typeof phase, readonly SanityBlogMediaJournalCommitState[]> = {
		registered: ["baseline"],
		"registry-verified": ["baseline", "receipt-committed"],
		"receipt-committed": ["receipt-committed", "journals-committed"],
		"journals-committed": ["journals-committed"],
		complete: ["journals-committed"],
	};
	if (!allowedStates[phase].includes(actualState)) {
		throw new Error("Versioned Blog media journals do not match the durable commit phase");
	}
	return actualState;
}

export function validateCompletedSanityBlogMediaAsset({
	checkpoint,
	sourceAssetRef,
	journalMediaAssetId,
	receipt,
	actualJournalDigests,
	requireGlobalDigestMatch,
}: {
	checkpoint: SanityBlogMediaTransferCheckpoint;
	sourceAssetRef: CmsBlogMediaSourceAssetRef;
	journalMediaAssetId: string | undefined;
	receipt: SanityBlogMediaTransferReceipt | undefined;
	actualJournalDigests: SanityBlogMediaTransferCheckpoint["journalDigests"];
	requireGlobalDigestMatch: boolean;
}) {
	const asset = checkpoint.assets[sourceAssetRef];
	if (
		asset?.phase !== "complete" ||
		!asset.mediaAssetId ||
		!asset.workerAssetId ||
		journalMediaAssetId !== asset.mediaAssetId ||
		!receipt ||
		receipt.mediaAssetId !== asset.mediaAssetId ||
		receipt.workerAssetId !== asset.workerAssetId ||
		receipt.sourceSha256 !== asset.sourceSha256 ||
		!sameSource(receipt.source, asset.source)
	) {
		throw new Error("Completed checkpoint no longer matches its versioned journal entries");
	}
	if (
		requireGlobalDigestMatch &&
		!sameJournalDigests(actualJournalDigests, checkpoint.journalDigests)
	) {
		throw new Error("Completed checkpoint no longer matches the versioned journal digests");
	}
}

function sortedRecord<T>(entries: Iterable<readonly [string, T]>) {
	return Object.fromEntries(
		[...entries].sort(([left], [right]) => left.localeCompare(right)),
	) as Record<string, T>;
}

export function createCandidateSanityBlogMediaJournals({
	journal,
	receiptFile,
	sourceAssetRef,
	registered,
	sourceSha256,
}: {
	journal: Readonly<Record<string, string>>;
	receiptFile: SanityBlogMediaTransferReceipts;
	sourceAssetRef: CmsBlogMediaSourceAssetRef;
	registered: RegisteredCmsMediaAsset;
	sourceSha256: string;
}) {
	if (journal[sourceAssetRef] || receiptFile.receipts[sourceAssetRef]) {
		throw new Error("Candidate source is already mapped");
	}
	if (!SHA256_PATTERN.test(sourceSha256)) throw new Error("Candidate source SHA-256 is invalid");
	const nextJournal = parseSanityBlogImageAssetJournal(
		sortedRecord([...Object.entries(journal), [sourceAssetRef, registered.mediaAssetId]]),
	);
	const receipt: SanityBlogMediaTransferReceipt = {
		mediaAssetId: registered.mediaAssetId,
		workerAssetId: registered.workerAssetId,
		sourceSha256,
		source: registered.source,
	};
	const nextReceiptFile = parseSanityBlogMediaTransferReceipts({
		...receiptFile,
		receipts: sortedRecord([
			...Object.entries(receiptFile.receipts),
			[sourceAssetRef, receipt] as const,
		]),
	});
	return { journal: nextJournal, receiptFile: nextReceiptFile };
}
