import { createHash } from "node:crypto";
import {
	canonicalPortfolioMediaJson,
	PORTFOLIO_MEDIA_CANARY_REF,
	PORTFOLIO_MEDIA_MAX_BYTES,
	PORTFOLIO_MEDIA_OPERATION,
	PORTFOLIO_MEDIA_SITE_URL,
	type PortfolioMediaPlanAsset,
	type PortfolioMediaTransferPlan,
} from "./portfolioMediaTransferPlan";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONVEX_ID = /^[a-z0-9]{20,64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const WORKER_ORIGIN = "https://cms-media-worker.thinkingofview.workers.dev";
const UPLOAD_PATH = "/v1/uploads/source";
const ACTIVE_OPERATION_MESSAGE = "CMS media asset operation is already in progress";

type JsonObject = Record<string, unknown>;
export type PortfolioMediaBoundary = "standard" | "process";
export type PortfolioAnimationInspection = {
	frameCount: 17;
	frameDurationMs: 100;
	loop: "infinite";
};

export type PortfolioTransformedSource = {
	contentType: "image/webp";
	sizeBytes: number;
	width: number;
	height: number;
	sha256: string;
	animation?: PortfolioAnimationInspection;
};

export type PortfolioTargetDerivative = {
	key: string;
	contentType: "image/webp";
	width: number;
	height: number;
};

export type PortfolioPublicDerivative = PortfolioTargetDerivative & {
	sizeBytes: number;
	sha256: string;
	animation?: PortfolioAnimationInspection;
};

export type PortfolioPublicDerivatives = {
	card: PortfolioPublicDerivative;
	display2048: PortfolioPublicDerivative;
};

export type PortfolioRegisteredMedia = {
	mediaAssetId: string;
	workerAssetId: string;
	targetCreatedAt: number;
	derivatives: {
		thumb: PortfolioTargetDerivative;
		card: PortfolioTargetDerivative;
	};
};

export type PortfolioMediaCheckpoint = {
	schemaVersion: 2;
	operation: typeof PORTFOLIO_MEDIA_OPERATION;
	siteUrl: typeof PORTFOLIO_MEDIA_SITE_URL;
	planDigest: string;
	sourceOrder: number;
	sourceAssetRef: string;
	phase: "source-validated" | "put-attempted" | "registered" | "public-verified";
	capabilityAttempt: 0 | 1 | 2;
	transfer: PortfolioTransformedSource;
	workerAssetId?: string;
	target?: PortfolioRegisteredMedia;
	targetPublicDerivatives?: PortfolioPublicDerivatives;
};

export type PortfolioMediaReceipt = {
	schemaVersion: 2;
	operation: typeof PORTFOLIO_MEDIA_OPERATION;
	siteUrl: typeof PORTFOLIO_MEDIA_SITE_URL;
	planDigest: string;
	sourceOrder: number;
	gallerySourceId: string;
	gallerySourceRevision: string;
	galleryPortfolioOrder: number;
	placementOrder: number;
	placementKey: string;
	sourceAltState: "present" | "absent";
	sourceAsset: PortfolioMediaPlanAsset["sourceAsset"];
	transferSource: PortfolioMediaPlanAsset["transferSource"] & PortfolioTransformedSource;
	target: PortfolioRegisteredMedia & {
		status: "ready";
		publicDerivatives: PortfolioPublicDerivatives;
	};
	receiptDigest: string;
};

export type PortfolioMediaReceiptSet = {
	schemaVersion: 2;
	operation: typeof PORTFOLIO_MEDIA_OPERATION;
	siteUrl: typeof PORTFOLIO_MEDIA_SITE_URL;
	planDigest: string;
	assetCount: 294;
	canary: {
		sourceAssetRef: typeof PORTFOLIO_MEDIA_CANARY_REF;
		passed: true;
		animationInspection: {
			card: PortfolioAnimationInspection;
			display2048: PortfolioAnimationInspection;
		};
	};
	receipts: PortfolioMediaReceipt[];
	receiptSetDigest: string;
};

export type PortfolioDecodedImageMetadata = {
	format?: string;
	width?: number;
	height?: number;
	pageHeight?: number;
	pages?: number;
	delay?: number | readonly number[];
	loop?: number;
};

export type PortfolioMediaCapability = {
	assetId: string;
	privateObjectKey: string;
	uploadUrl: string;
	uploadToken: string;
	expiresAt: string;
};

function objectValue(value: unknown, label: string): JsonObject {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as JsonObject;
}

function exactKeys(value: JsonObject, expected: readonly string[], label: string): void {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
		throw new Error(`${label} has unexpected or missing fields`);
	}
}

export function isPortfolioMediaLeaseConflictEnvelope(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const root = value as JsonObject;
	return Object.keys(root).join(",") === "message" && root.message === ACTIVE_OPERATION_MESSAGE;
}

export function isPortfolioMediaLeaseConflictBody(value: string): boolean {
	const body = value.trim();
	if (body === ACTIVE_OPERATION_MESSAGE) return true;
	try {
		return isPortfolioMediaLeaseConflictEnvelope(JSON.parse(body) as unknown);
	} catch {
		return false;
	}
}

export function portfolioMediaBoundaryTimeoutMs(
	boundary: PortfolioMediaBoundary,
): 120_000 | 330_000 {
	return boundary === "process" ? 330_000 : 120_000;
}

function stringValue(value: unknown, label: string): string {
	if (typeof value !== "string" || !value || value !== value.trim()) {
		throw new Error(`${label} must be a non-empty trimmed string`);
	}
	return value;
}

function positiveInteger(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${label} must be a positive integer`);
	}
	return value;
}

function sha256(value: Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function requireDigest(value: unknown, label: string): string {
	const digest = stringValue(value, label);
	if (!SHA256.test(digest)) throw new Error(`${label} is invalid`);
	return digest;
}

function same(left: unknown, right: unknown): boolean {
	return canonicalPortfolioMediaJson(left) === canonicalPortfolioMediaJson(right);
}

function expectedAnimation(metadata: PortfolioDecodedImageMetadata, label: string) {
	const delays = Array.isArray(metadata.delay)
		? metadata.delay
		: metadata.delay === undefined
			? []
			: [metadata.delay];
	if (
		metadata.pages !== 17 ||
		delays.length !== 17 ||
		delays.some((delay) => delay !== 100) ||
		metadata.loop !== 0
	) {
		throw new Error(`${label} did not preserve 17 frames at 100ms with an infinite loop`);
	}
	return {
		frameCount: 17,
		frameDurationMs: 100,
		loop: "infinite",
	} as const;
}

export function validatePortfolioTransformedSource(
	asset: PortfolioMediaPlanAsset,
	bytes: Uint8Array,
	metadata: PortfolioDecodedImageMetadata,
): PortfolioTransformedSource {
	const logicalHeight = metadata.pageHeight ?? metadata.height;
	if (
		bytes.byteLength < 1 ||
		bytes.byteLength > PORTFOLIO_MEDIA_MAX_BYTES ||
		metadata.format !== "webp" ||
		!Number.isSafeInteger(metadata.width) ||
		(metadata.width ?? 0) < 1 ||
		(metadata.width ?? 0) > 1_600 ||
		!Number.isSafeInteger(logicalHeight) ||
		(logicalHeight ?? 0) < 1
	) {
		throw new Error("Portfolio transformed source violates the sealed WebP input boundary");
	}
	const animation = asset.canary
		? expectedAnimation(metadata, "Portfolio GIF transformed source")
		: undefined;
	if (
		asset.canary !== (asset.sourceAsset.id === PORTFOLIO_MEDIA_CANARY_REF) ||
		(asset.sourceAsset.originalContentType === "image/gif") !== asset.canary ||
		(!asset.canary && (metadata.pages ?? 1) !== 1)
	) {
		throw new Error("Portfolio animation source classification changed");
	}
	return {
		contentType: "image/webp",
		sizeBytes: bytes.byteLength,
		width: metadata.width as number,
		height: logicalHeight as number,
		sha256: sha256(bytes),
		...(animation ? { animation } : {}),
	};
}

export function validatePortfolioTargetAnimation(
	metadata: PortfolioDecodedImageMetadata,
	derivative: "card" | "display2048",
): PortfolioAnimationInspection {
	if (metadata.format !== "webp") {
		throw new Error(`Portfolio GIF ${derivative} target is not WebP`);
	}
	return expectedAnimation(metadata, `Portfolio GIF ${derivative} target`);
}

function publicDerivativeKey(workerAssetId: string, derivative: "card" | "display2048") {
	if (!UUID_V4.test(workerAssetId)) throw new Error("Portfolio Worker identity is invalid");
	const filename = derivative === "card" ? "card.webp" : "display-2048.webp";
	return `sites/${PORTFOLIO_MEDIA_SITE_URL}/web/${workerAssetId}/${filename}`;
}

export function validatePortfolioPublicDerivative(
	asset: PortfolioMediaPlanAsset,
	workerAssetId: string,
	derivative: "card" | "display2048",
	contentType: string,
	bytes: Uint8Array,
	metadata: PortfolioDecodedImageMetadata,
): PortfolioPublicDerivative {
	const logicalHeight = metadata.pageHeight ?? metadata.height;
	if (
		contentType !== "image/webp" ||
		bytes.byteLength < 1 ||
		bytes.byteLength > PORTFOLIO_MEDIA_MAX_BYTES ||
		metadata.format !== "webp" ||
		!Number.isSafeInteger(metadata.width) ||
		(metadata.width ?? 0) < 1 ||
		!Number.isSafeInteger(logicalHeight) ||
		(logicalHeight ?? 0) < 1 ||
		asset.canary !== (asset.sourceAsset.id === PORTFOLIO_MEDIA_CANARY_REF) ||
		asset.canary !== (asset.sourceAsset.originalContentType === "image/gif") ||
		(!asset.canary && (metadata.pages ?? 1) !== 1)
	) {
		throw new Error(`Portfolio ${derivative} public derivative boundary is invalid`);
	}
	const animation = asset.canary
		? validatePortfolioTargetAnimation(metadata, derivative)
		: undefined;
	return {
		key: publicDerivativeKey(workerAssetId, derivative),
		contentType: "image/webp",
		sizeBytes: bytes.byteLength,
		width: metadata.width as number,
		height: logicalHeight as number,
		sha256: sha256(bytes),
		...(animation ? { animation } : {}),
	};
}

export function transformedPortfolioFilename(asset: PortfolioMediaPlanAsset): string {
	const sha1 = asset.sourceAsset.sha1;
	if (!/^[0-9a-f]{40}$/.test(sha1)) throw new Error("Portfolio source SHA-1 is invalid");
	return `sanity-${sha1}-w1600-q90.webp`;
}

export function privatePortfolioObjectKey(workerAssetId: string): string {
	if (!UUID_V4.test(workerAssetId)) throw new Error("Portfolio Worker identity is invalid");
	return `sites/${PORTFOLIO_MEDIA_SITE_URL}/web/${workerAssetId}/source.webp`;
}

export function parsePortfolioMediaCapability(
	value: unknown,
	nowMs: number,
): PortfolioMediaCapability {
	const root = objectValue(value, "Portfolio media capability");
	exactKeys(
		root,
		["assetId", "privateObjectKey", "uploadUrl", "uploadToken", "expiresAt"],
		"Portfolio media capability",
	);
	const assetId = stringValue(root.assetId, "Portfolio capability asset ID");
	if (!UUID_V4.test(assetId)) throw new Error("Portfolio capability asset ID is invalid");
	const privateObjectKey = stringValue(
		root.privateObjectKey,
		"Portfolio capability private object key",
	);
	if (privateObjectKey !== privatePortfolioObjectKey(assetId)) {
		throw new Error("Portfolio capability private object identity is invalid");
	}
	let uploadUrl: URL;
	try {
		uploadUrl = new URL(stringValue(root.uploadUrl, "Portfolio capability upload URL"));
	} catch {
		throw new Error("Portfolio capability upload URL is invalid");
	}
	const query = [...uploadUrl.searchParams.entries()];
	if (
		uploadUrl.origin !== WORKER_ORIGIN ||
		uploadUrl.pathname !== UPLOAD_PATH ||
		uploadUrl.username ||
		uploadUrl.password ||
		uploadUrl.hash ||
		query.length !== 1 ||
		query[0]?.[0] !== "key" ||
		query[0]?.[1] !== privateObjectKey
	) {
		throw new Error("Portfolio capability upload boundary is invalid");
	}
	const uploadToken = stringValue(root.uploadToken, "Portfolio capability upload token");
	if (uploadToken.length > 4_096 || /[\r\n]/.test(uploadToken)) {
		throw new Error("Portfolio capability upload token is invalid");
	}
	const expiresAt = stringValue(root.expiresAt, "Portfolio capability expiry");
	const expiryMs = Date.parse(expiresAt);
	const lifetime = expiryMs - nowMs;
	if (
		!Number.isFinite(expiryMs) ||
		new Date(expiryMs).toISOString() !== expiresAt ||
		lifetime < 2 * 60_000 ||
		lifetime > 16 * 60_000
	) {
		throw new Error("Portfolio capability expiry is invalid");
	}
	return {
		assetId,
		privateObjectKey,
		uploadUrl: uploadUrl.toString(),
		uploadToken,
		expiresAt,
	};
}

function parseDerivative(
	value: unknown,
	workerAssetId: string,
	name: "thumb" | "card",
): PortfolioTargetDerivative {
	const root = objectValue(value, `Portfolio target ${name} derivative`);
	exactKeys(root, ["key", "contentType", "width", "height"], `Portfolio target ${name} derivative`);
	const expectedKey = `sites/${PORTFOLIO_MEDIA_SITE_URL}/web/${workerAssetId}/${name}.webp`;
	if (root.key !== expectedKey || root.contentType !== "image/webp") {
		throw new Error(`Portfolio target ${name} derivative identity is invalid`);
	}
	return {
		key: expectedKey,
		contentType: "image/webp",
		width: positiveInteger(root.width, `Portfolio target ${name} width`),
		height: positiveInteger(root.height, `Portfolio target ${name} height`),
	};
}

function parseTransformedSource(
	value: unknown,
	asset: PortfolioMediaPlanAsset,
): PortfolioTransformedSource {
	const root = objectValue(value, "Portfolio checkpoint transfer source");
	exactKeys(
		root,
		asset.canary
			? ["contentType", "sizeBytes", "width", "height", "sha256", "animation"]
			: ["contentType", "sizeBytes", "width", "height", "sha256"],
		"Portfolio checkpoint transfer source",
	);
	const sizeBytes = positiveInteger(root.sizeBytes, "Portfolio checkpoint transfer size");
	const width = positiveInteger(root.width, "Portfolio checkpoint transfer width");
	const height = positiveInteger(root.height, "Portfolio checkpoint transfer height");
	if (
		root.contentType !== "image/webp" ||
		sizeBytes > PORTFOLIO_MEDIA_MAX_BYTES ||
		width > 1_600 ||
		asset.canary !== (asset.sourceAsset.originalContentType === "image/gif")
	) {
		throw new Error("Portfolio checkpoint transfer boundary is invalid");
	}
	const animation = root.animation;
	if (
		asset.canary
			? !same(animation, { frameCount: 17, frameDurationMs: 100, loop: "infinite" })
			: animation !== undefined
	) {
		throw new Error("Portfolio checkpoint source animation is invalid");
	}
	return {
		contentType: "image/webp",
		sizeBytes,
		width,
		height,
		sha256: requireDigest(root.sha256, "Portfolio checkpoint transfer digest"),
		...(asset.canary ? { animation: animation as PortfolioAnimationInspection } : {}),
	};
}

function parseRegisteredMedia(value: unknown, workerAssetId: string): PortfolioRegisteredMedia {
	const root = objectValue(value, "Portfolio checkpoint registered target");
	exactKeys(
		root,
		["mediaAssetId", "workerAssetId", "targetCreatedAt", "derivatives"],
		"Portfolio checkpoint registered target",
	);
	if (
		root.workerAssetId !== workerAssetId ||
		!UUID_V4.test(workerAssetId) ||
		typeof root.mediaAssetId !== "string" ||
		!CONVEX_ID.test(root.mediaAssetId)
	) {
		throw new Error("Portfolio checkpoint target identity is invalid");
	}
	const derivatives = objectValue(root.derivatives, "Portfolio checkpoint target derivatives");
	exactKeys(derivatives, ["thumb", "card"], "Portfolio checkpoint target derivatives");
	return {
		mediaAssetId: root.mediaAssetId,
		workerAssetId,
		targetCreatedAt: positiveInteger(
			root.targetCreatedAt,
			"Portfolio checkpoint target creation time",
		),
		derivatives: {
			thumb: parseDerivative(derivatives.thumb, workerAssetId, "thumb"),
			card: parseDerivative(derivatives.card, workerAssetId, "card"),
		},
	};
}

function parsePublicDerivative(
	value: unknown,
	asset: PortfolioMediaPlanAsset,
	workerAssetId: string,
	derivative: "card" | "display2048",
): PortfolioPublicDerivative {
	const root = objectValue(value, `Portfolio ${derivative} public derivative`);
	exactKeys(
		root,
		asset.canary
			? ["key", "contentType", "sizeBytes", "width", "height", "sha256", "animation"]
			: ["key", "contentType", "sizeBytes", "width", "height", "sha256"],
		`Portfolio ${derivative} public derivative`,
	);
	const sizeBytes = positiveInteger(root.sizeBytes, `Portfolio ${derivative} public byte size`);
	if (
		root.key !== publicDerivativeKey(workerAssetId, derivative) ||
		root.contentType !== "image/webp" ||
		sizeBytes > PORTFOLIO_MEDIA_MAX_BYTES ||
		(asset.canary
			? !same(root.animation, {
					frameCount: 17,
					frameDurationMs: 100,
					loop: "infinite",
				})
			: root.animation !== undefined)
	) {
		throw new Error(`Portfolio ${derivative} public derivative binding is invalid`);
	}
	return {
		key: root.key,
		contentType: "image/webp",
		sizeBytes,
		width: positiveInteger(root.width, `Portfolio ${derivative} public width`),
		height: positiveInteger(root.height, `Portfolio ${derivative} public height`),
		sha256: requireDigest(root.sha256, `Portfolio ${derivative} public digest`),
		...(asset.canary ? { animation: root.animation as PortfolioAnimationInspection } : {}),
	};
}

function parsePublicDerivatives(
	value: unknown,
	asset: PortfolioMediaPlanAsset,
	target: PortfolioRegisteredMedia,
): PortfolioPublicDerivatives {
	const root = objectValue(value, "Portfolio public derivative bindings");
	exactKeys(root, ["card", "display2048"], "Portfolio public derivative bindings");
	const card = parsePublicDerivative(root.card, asset, target.workerAssetId, "card");
	const display2048 = parsePublicDerivative(
		root.display2048,
		asset,
		target.workerAssetId,
		"display2048",
	);
	if (
		card.width !== target.derivatives.card.width ||
		card.height !== target.derivatives.card.height
	) {
		throw new Error("Portfolio public card dimensions differ from registration");
	}
	return { card, display2048 };
}

export function parsePortfolioMediaProcessResult(
	value: unknown,
	asset: PortfolioMediaPlanAsset,
	transfer: PortfolioTransformedSource,
	workerAssetId: string,
): PortfolioRegisteredMedia {
	if (!UUID_V4.test(workerAssetId)) throw new Error("Portfolio Worker identity is invalid");
	const root = objectValue(value, "Portfolio media process response");
	exactKeys(root, ["asset"], "Portfolio media process response");
	const processed = objectValue(root.asset, "Portfolio processed media asset");
	exactKeys(
		processed,
		["_id", "assetId", "originalFilename", "status", "source", "derivatives", "createdAt"],
		"Portfolio processed media asset",
	);
	const mediaAssetId = stringValue(processed._id, "Portfolio target media asset ID");
	if (
		!CONVEX_ID.test(mediaAssetId) ||
		processed.assetId !== workerAssetId ||
		processed.originalFilename !== transformedPortfolioFilename(asset) ||
		processed.status !== "ready"
	) {
		throw new Error("Portfolio processed media asset identity is invalid");
	}
	const source = objectValue(processed.source, "Portfolio processed source");
	exactKeys(source, ["contentType", "sizeBytes", "width", "height"], "Portfolio processed source");
	if (
		source.contentType !== transfer.contentType ||
		source.sizeBytes !== transfer.sizeBytes ||
		source.width !== transfer.width ||
		source.height !== transfer.height
	) {
		throw new Error("Portfolio processed source differs from the exact transformed bytes");
	}
	const derivatives = objectValue(processed.derivatives, "Portfolio target derivatives");
	exactKeys(derivatives, ["thumb", "card"], "Portfolio target derivatives");
	return {
		mediaAssetId,
		workerAssetId,
		targetCreatedAt: positiveInteger(processed.createdAt, "Portfolio target creation time"),
		derivatives: {
			thumb: parseDerivative(derivatives.thumb, workerAssetId, "thumb"),
			card: parseDerivative(derivatives.card, workerAssetId, "card"),
		},
	};
}

function baseCheckpoint(
	plan: PortfolioMediaTransferPlan,
	asset: PortfolioMediaPlanAsset,
	phase: PortfolioMediaCheckpoint["phase"],
	capabilityAttempt: PortfolioMediaCheckpoint["capabilityAttempt"],
	transfer: PortfolioTransformedSource,
): PortfolioMediaCheckpoint {
	if (plan.assets[asset.sourceOrder]?.sourceAsset.id !== asset.sourceAsset.id) {
		throw new Error("Portfolio checkpoint asset is outside the sealed plan order");
	}
	return {
		schemaVersion: 2,
		operation: PORTFOLIO_MEDIA_OPERATION,
		siteUrl: PORTFOLIO_MEDIA_SITE_URL,
		planDigest: plan.planDigest,
		sourceOrder: asset.sourceOrder,
		sourceAssetRef: asset.sourceAsset.id,
		phase,
		capabilityAttempt,
		transfer,
	};
}

export function createPortfolioMediaCheckpoint(
	plan: PortfolioMediaTransferPlan,
	asset: PortfolioMediaPlanAsset,
	transfer: PortfolioTransformedSource,
): PortfolioMediaCheckpoint {
	return baseCheckpoint(plan, asset, "source-validated", 0, transfer);
}

export function checkpointPortfolioMediaPutAttempted(
	plan: PortfolioMediaTransferPlan,
	asset: PortfolioMediaPlanAsset,
	current: PortfolioMediaCheckpoint,
	workerAssetId: string,
): PortfolioMediaCheckpoint {
	if (
		current.phase !== "source-validated" ||
		(current.capabilityAttempt !== 0 && current.capabilityAttempt !== 1) ||
		current.sourceAssetRef !== asset.sourceAsset.id
	) {
		throw new Error("Portfolio media checkpoint cannot issue a capability from this phase");
	}
	privatePortfolioObjectKey(workerAssetId);
	return {
		...baseCheckpoint(
			plan,
			asset,
			"put-attempted",
			(current.capabilityAttempt + 1) as 1 | 2,
			current.transfer,
		),
		workerAssetId,
	};
}

export function checkpointPortfolioMediaConfirmedMissing(
	plan: PortfolioMediaTransferPlan,
	asset: PortfolioMediaPlanAsset,
	current: PortfolioMediaCheckpoint,
): PortfolioMediaCheckpoint {
	if (
		current.phase !== "put-attempted" ||
		current.capabilityAttempt !== 1 ||
		current.sourceAssetRef !== asset.sourceAsset.id
	) {
		throw new Error("Portfolio media source remained missing after the bounded capability reissue");
	}
	return baseCheckpoint(plan, asset, "source-validated", 1, current.transfer);
}

export function checkpointPortfolioMediaRegistered(
	plan: PortfolioMediaTransferPlan,
	asset: PortfolioMediaPlanAsset,
	current: PortfolioMediaCheckpoint,
	target: PortfolioRegisteredMedia,
): PortfolioMediaCheckpoint {
	if (
		current.phase !== "put-attempted" ||
		(current.capabilityAttempt !== 1 && current.capabilityAttempt !== 2) ||
		current.workerAssetId !== target.workerAssetId ||
		current.sourceAssetRef !== asset.sourceAsset.id
	) {
		throw new Error("Portfolio media target cannot be registered from this checkpoint");
	}
	return {
		...baseCheckpoint(plan, asset, "registered", current.capabilityAttempt, current.transfer),
		workerAssetId: target.workerAssetId,
		target,
	};
}

export function checkpointPortfolioPublicDerivativesVerified(
	plan: PortfolioMediaTransferPlan,
	asset: PortfolioMediaPlanAsset,
	current: PortfolioMediaCheckpoint,
	targetPublicDerivatives: PortfolioPublicDerivatives,
): PortfolioMediaCheckpoint {
	if (
		current.phase !== "registered" ||
		!current.target ||
		current.planDigest !== plan.planDigest ||
		current.sourceAssetRef !== asset.sourceAsset.id
	) {
		throw new Error("Portfolio public derivatives cannot be bound from this checkpoint");
	}
	return {
		...current,
		phase: "public-verified",
		targetPublicDerivatives: parsePublicDerivatives(targetPublicDerivatives, asset, current.target),
	};
}

export function createPortfolioMediaReceipt(
	plan: PortfolioMediaTransferPlan,
	asset: PortfolioMediaPlanAsset,
	checkpoint: PortfolioMediaCheckpoint,
): PortfolioMediaReceipt {
	const accepted = parsePortfolioMediaCheckpoint(checkpoint, plan);
	if (
		!accepted.target ||
		!accepted.targetPublicDerivatives ||
		accepted.sourceAssetRef !== asset.sourceAsset.id ||
		accepted.phase !== "public-verified"
	) {
		throw new Error("Portfolio media checkpoint is not ready for a receipt");
	}
	const payload = {
		schemaVersion: 2 as const,
		operation: PORTFOLIO_MEDIA_OPERATION,
		siteUrl: PORTFOLIO_MEDIA_SITE_URL,
		planDigest: plan.planDigest,
		sourceOrder: asset.sourceOrder,
		gallerySourceId: asset.gallerySourceId,
		gallerySourceRevision: asset.gallerySourceRevision,
		galleryPortfolioOrder: asset.galleryPortfolioOrder,
		placementOrder: asset.placementOrder,
		placementKey: asset.placementKey,
		sourceAltState: asset.sourceAltState,
		sourceAsset: asset.sourceAsset,
		transferSource: { ...asset.transferSource, ...accepted.transfer },
		target: {
			...accepted.target,
			status: "ready" as const,
			publicDerivatives: accepted.targetPublicDerivatives,
		},
	};
	return {
		...payload,
		receiptDigest: createHash("sha256").update(canonicalPortfolioMediaJson(payload)).digest("hex"),
	};
}

export function parsePortfolioMediaReceipt(
	value: unknown,
	plan: PortfolioMediaTransferPlan,
): PortfolioMediaReceipt {
	const root = objectValue(value, "Portfolio media receipt");
	exactKeys(
		root,
		[
			"schemaVersion",
			"operation",
			"siteUrl",
			"planDigest",
			"sourceOrder",
			"gallerySourceId",
			"gallerySourceRevision",
			"galleryPortfolioOrder",
			"placementOrder",
			"placementKey",
			"sourceAltState",
			"sourceAsset",
			"transferSource",
			"target",
			"receiptDigest",
		],
		"Portfolio media receipt",
	);
	const sourceOrder = positiveInteger(Number(root.sourceOrder) + 1, "Portfolio source order") - 1;
	const asset = plan.assets[sourceOrder];
	if (!asset) throw new Error("Portfolio media receipt source order is outside the sealed plan");
	const receiptDigest = requireDigest(root.receiptDigest, "Portfolio media receipt digest");
	const { receiptDigest: _ignored, ...payload } = root;
	const transferRoot = objectValue(root.transferSource, "Portfolio receipt transfer source");
	const parsedTransfer = parseTransformedSource(
		{
			contentType: transferRoot.contentType,
			sizeBytes: transferRoot.sizeBytes,
			width: transferRoot.width,
			height: transferRoot.height,
			sha256: transferRoot.sha256,
			...(transferRoot.animation === undefined ? {} : { animation: transferRoot.animation }),
		},
		asset,
	);
	const targetRoot = objectValue(root.target, "Portfolio receipt target");
	const workerAssetId = stringValue(targetRoot.workerAssetId, "Portfolio receipt Worker identity");
	const registered = parseRegisteredMedia(
		{
			mediaAssetId: targetRoot.mediaAssetId,
			workerAssetId,
			targetCreatedAt: targetRoot.targetCreatedAt,
			derivatives: targetRoot.derivatives,
		},
		workerAssetId,
	);
	const publicDerivatives = parsePublicDerivatives(targetRoot.publicDerivatives, asset, registered);
	const expected: PortfolioMediaReceipt = {
		schemaVersion: 2,
		operation: PORTFOLIO_MEDIA_OPERATION,
		siteUrl: PORTFOLIO_MEDIA_SITE_URL,
		planDigest: plan.planDigest,
		sourceOrder,
		gallerySourceId: asset.gallerySourceId,
		gallerySourceRevision: asset.gallerySourceRevision,
		galleryPortfolioOrder: asset.galleryPortfolioOrder,
		placementOrder: asset.placementOrder,
		placementKey: asset.placementKey,
		sourceAltState: asset.sourceAltState,
		sourceAsset: asset.sourceAsset,
		transferSource: { ...asset.transferSource, ...parsedTransfer },
		target: {
			...registered,
			status: "ready",
			publicDerivatives,
		},
		receiptDigest,
	};
	if (
		createHash("sha256").update(canonicalPortfolioMediaJson(payload)).digest("hex") !==
			receiptDigest ||
		targetRoot.status !== "ready" ||
		!same(value, expected)
	) {
		throw new Error("Portfolio media receipt identity or digest is invalid");
	}
	return expected;
}

export function createPortfolioMediaReceiptSet(
	plan: PortfolioMediaTransferPlan,
	receipts: readonly PortfolioMediaReceipt[],
): PortfolioMediaReceiptSet {
	if (
		receipts.length !== 294 ||
		receipts.some(
			(receipt, index) =>
				receipt.sourceOrder !== index ||
				receipt.sourceAsset.id !== plan.assets[index]?.sourceAsset.id,
		)
	) {
		throw new Error("Portfolio media receipt set is incomplete or out of order");
	}
	const canary = receipts.find((receipt) => receipt.sourceAsset.id === PORTFOLIO_MEDIA_CANARY_REF);
	const cardAnimation = canary?.target.publicDerivatives.card.animation;
	const display2048Animation = canary?.target.publicDerivatives.display2048.animation;
	if (!cardAnimation || !display2048Animation) {
		throw new Error("Portfolio media receipt set lacks the accepted GIF canary");
	}
	const payload = {
		schemaVersion: 2 as const,
		operation: PORTFOLIO_MEDIA_OPERATION,
		siteUrl: PORTFOLIO_MEDIA_SITE_URL,
		planDigest: plan.planDigest,
		assetCount: 294 as const,
		canary: {
			sourceAssetRef: PORTFOLIO_MEDIA_CANARY_REF,
			passed: true as const,
			animationInspection: {
				card: cardAnimation,
				display2048: display2048Animation,
			},
		},
		receipts: [...receipts],
	};
	return {
		...payload,
		receiptSetDigest: createHash("sha256")
			.update(canonicalPortfolioMediaJson(payload))
			.digest("hex"),
	};
}

export function parsePortfolioMediaReceiptSet(
	value: unknown,
	plan: PortfolioMediaTransferPlan,
): PortfolioMediaReceiptSet {
	const root = objectValue(value, "Portfolio media receipt set");
	const digest = requireDigest(root.receiptSetDigest, "Portfolio media receipt set digest");
	const rawReceipts = root.receipts;
	if (!Array.isArray(rawReceipts)) throw new Error("Portfolio media receipts must be an array");
	const receipts = rawReceipts.map((receipt) => parsePortfolioMediaReceipt(receipt, plan));
	const expected = createPortfolioMediaReceiptSet(plan, receipts);
	if (expected.receiptSetDigest !== digest || !same(expected, value)) {
		throw new Error("Portfolio media receipt set is invalid");
	}
	return expected;
}

export function parsePortfolioMediaCheckpoint(
	value: unknown,
	plan: PortfolioMediaTransferPlan,
): PortfolioMediaCheckpoint {
	const root = objectValue(value, "Portfolio media checkpoint");
	if (
		root.schemaVersion !== 2 ||
		root.operation !== PORTFOLIO_MEDIA_OPERATION ||
		root.siteUrl !== PORTFOLIO_MEDIA_SITE_URL ||
		root.planDigest !== plan.planDigest ||
		typeof root.sourceOrder !== "number" ||
		!Number.isSafeInteger(root.sourceOrder) ||
		root.sourceOrder < 0
	) {
		throw new Error("Portfolio media checkpoint identity is invalid");
	}
	const asset = plan.assets[root.sourceOrder];
	if (!asset || root.sourceAssetRef !== asset.sourceAsset.id) {
		throw new Error("Portfolio media checkpoint is outside the sealed asset set");
	}
	const parsedTransfer = parseTransformedSource(root.transfer, asset);
	let expected: PortfolioMediaCheckpoint;
	if (root.phase === "source-validated") {
		if (root.capabilityAttempt !== 0 && root.capabilityAttempt !== 1) {
			throw new Error("Portfolio media checkpoint capability attempt is invalid");
		}
		expected = {
			...baseCheckpoint(plan, asset, "source-validated", root.capabilityAttempt, parsedTransfer),
		};
	} else if (root.phase === "put-attempted") {
		if (root.capabilityAttempt !== 1 && root.capabilityAttempt !== 2) {
			throw new Error("Portfolio media checkpoint capability attempt is invalid");
		}
		const workerAssetId = stringValue(root.workerAssetId, "Portfolio checkpoint Worker identity");
		privatePortfolioObjectKey(workerAssetId);
		expected = {
			...baseCheckpoint(plan, asset, "put-attempted", root.capabilityAttempt, parsedTransfer),
			workerAssetId,
		};
	} else if (root.phase === "registered" || root.phase === "public-verified") {
		if (root.capabilityAttempt !== 1 && root.capabilityAttempt !== 2) {
			throw new Error("Portfolio media checkpoint capability attempt is invalid");
		}
		const workerAssetId = stringValue(root.workerAssetId, "Portfolio checkpoint Worker identity");
		const target = parseRegisteredMedia(root.target, workerAssetId);
		expected = {
			...baseCheckpoint(plan, asset, root.phase, root.capabilityAttempt, parsedTransfer),
			workerAssetId,
			target,
			...(root.phase === "public-verified"
				? {
						targetPublicDerivatives: parsePublicDerivatives(
							root.targetPublicDerivatives,
							asset,
							target,
						),
					}
				: {}),
		};
	} else {
		throw new Error("Portfolio media checkpoint phase is invalid");
	}
	if (!same(root, expected)) throw new Error("Portfolio media checkpoint fields are invalid");
	return expected;
}
