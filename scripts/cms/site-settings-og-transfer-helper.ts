import { createHash } from "node:crypto";
import {
	type CmsBlogMediaSourceAssetRef,
	createCmsMediaCapabilityRequest,
	parseCmsMediaCapability,
	parseCmsMediaProcessResult,
} from "./sanityBlogMediaTransfer";

export const SITE_SETTINGS_OG_OPERATION = "R6-site-settings-og-transfer-v1" as const;
export const SITE_SETTINGS_OG_CONFIRMATION =
	"transfer R6 Site Settings OG image to www.angelsrest.online" as const;
export const SITE_SETTINGS_OG_SOURCE_MISSING_RESPONSE = "Uploaded object not found" as const;
export const SITE_SETTINGS_OG_SOURCE = {
	assetRef: "image-0ccd0a41f44c6387c01425cd93579ac5a4a9f341-1848x1848-png",
	assetRev: "Wjt6hHDPdnIIxNbTJB4JTp",
	url: "https://cdn.sanity.io/images/n7rvza4g/production/0ccd0a41f44c6387c01425cd93579ac5a4a9f341-1848x1848.png",
	originalFilename: "20251008_000asdasd550.png",
	sha1: "0ccd0a41f44c6387c01425cd93579ac5a4a9f341",
	contentType: "image/png",
	sizeBytes: 35_666,
	width: 1_848,
	height: 1_848,
	crop: null,
	hotspot: null,
} as const;

const BOUNDARY_REF = SITE_SETTINGS_OG_SOURCE.assetRef as CmsBlogMediaSourceAssetRef;
const SITE_URL = "angelsrest.online" as const;
const SHA256 = /^[0-9a-f]{64}$/;
const CONVEX_ID = /^[a-z0-9]{20,64}$/;
const WORKER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type SiteSettingsOgDerivative = {
	key: string;
	contentType: "image/webp";
	width: number;
	height: number;
};

export type SiteSettingsOgRegisteredAsset = {
	mediaAssetId: string;
	workerAssetId: string;
	createdAt: number;
	derivatives: { thumb: SiteSettingsOgDerivative; card: SiteSettingsOgDerivative };
};

type Phase = "source-validated" | "put-attempted" | "registered";
type CapabilityAttempt = 0 | 1 | 2;
export type SiteSettingsOgCheckpoint = {
	schemaVersion: 1;
	operation: typeof SITE_SETTINGS_OG_OPERATION;
	siteUrl: typeof SITE_URL;
	phase: Phase;
	capabilityAttempt: CapabilityAttempt;
	sourceAssetRef: typeof SITE_SETTINGS_OG_SOURCE.assetRef;
	sourceAssetRev: typeof SITE_SETTINGS_OG_SOURCE.assetRev;
	sourceSha1: typeof SITE_SETTINGS_OG_SOURCE.sha1;
	sourceSha256: string;
	sourceSizeBytes: typeof SITE_SETTINGS_OG_SOURCE.sizeBytes;
	sourceWidth: typeof SITE_SETTINGS_OG_SOURCE.width;
	sourceHeight: typeof SITE_SETTINGS_OG_SOURCE.height;
	workerAssetId?: string;
	mediaAssetId?: string;
	targetCreatedAt?: number;
	derivatives?: SiteSettingsOgRegisteredAsset["derivatives"];
};

export type SiteSettingsOgReceipt = {
	schemaVersion: 1;
	operation: typeof SITE_SETTINGS_OG_OPERATION;
	siteUrl: typeof SITE_URL;
	sourceAssetRef: typeof SITE_SETTINGS_OG_SOURCE.assetRef;
	sourceAssetRev: typeof SITE_SETTINGS_OG_SOURCE.assetRev;
	sourceUrl: typeof SITE_SETTINGS_OG_SOURCE.url;
	sourceOriginalFilename: typeof SITE_SETTINGS_OG_SOURCE.originalFilename;
	sourceSha1: typeof SITE_SETTINGS_OG_SOURCE.sha1;
	sourceSha256: string;
	sourceContentType: typeof SITE_SETTINGS_OG_SOURCE.contentType;
	sourceSizeBytes: typeof SITE_SETTINGS_OG_SOURCE.sizeBytes;
	sourceWidth: typeof SITE_SETTINGS_OG_SOURCE.width;
	sourceHeight: typeof SITE_SETTINGS_OG_SOURCE.height;
	sourceCrop: null;
	sourceHotspot: null;
	mediaAssetId: string;
	workerAssetId: string;
	targetStatus: "ready";
	targetCreatedAt: number;
	derivatives: SiteSettingsOgRegisteredAsset["derivatives"];
	receiptDigest: string;
};

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function exact<T extends Record<string, unknown>>(
	actual: Record<string, unknown>,
	expected: T,
	label: string,
): T {
	const keys = Object.keys(expected);
	if (
		Object.keys(actual).length !== keys.length ||
		keys.some((key) => JSON.stringify(actual[key]) !== JSON.stringify(expected[key]))
	) {
		throw new Error(`${label} is invalid`);
	}
	return expected;
}

function sha256(value: unknown) {
	if (typeof value !== "string" || !SHA256.test(value)) {
		throw new Error("Site Settings OG source SHA-256 is invalid");
	}
	return value;
}

function positiveInteger(value: unknown, label: string) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${label} is invalid`);
	}
	return value;
}

function targetIds(mediaAssetId: unknown, workerAssetId: unknown) {
	if (typeof mediaAssetId !== "string" || !CONVEX_ID.test(mediaAssetId)) {
		throw new Error("Site Settings OG Convex media identity is invalid");
	}
	if (typeof workerAssetId !== "string" || !WORKER_ID.test(workerAssetId)) {
		throw new Error("Site Settings OG Worker media identity is invalid");
	}
	return { mediaAssetId, workerAssetId };
}

function parseDerivative(
	value: unknown,
	workerAssetId: string,
	name: "thumb" | "card",
): SiteSettingsOgDerivative {
	const actual = record(value, `Site Settings OG ${name} derivative`);
	return exact(
		actual,
		{
			key: `sites/${SITE_URL}/web/${workerAssetId}/${name}.webp`,
			contentType: "image/webp" as const,
			width: positiveInteger(actual.width, `${name} derivative width`),
			height: positiveInteger(actual.height, `${name} derivative height`),
		},
		`Site Settings OG ${name} derivative`,
	);
}

function checkpoint(
	phase: Phase,
	capabilityAttempt: CapabilityAttempt,
	sourceSha256: string,
	registered?: SiteSettingsOgRegisteredAsset,
	workerAssetId?: string,
): SiteSettingsOgCheckpoint {
	sha256(sourceSha256);
	const base = {
		schemaVersion: 1 as const,
		operation: SITE_SETTINGS_OG_OPERATION,
		siteUrl: SITE_URL,
		phase,
		capabilityAttempt,
		sourceAssetRef: SITE_SETTINGS_OG_SOURCE.assetRef,
		sourceAssetRev: SITE_SETTINGS_OG_SOURCE.assetRev,
		sourceSha1: SITE_SETTINGS_OG_SOURCE.sha1,
		sourceSha256,
		sourceSizeBytes: SITE_SETTINGS_OG_SOURCE.sizeBytes,
		sourceWidth: SITE_SETTINGS_OG_SOURCE.width,
		sourceHeight: SITE_SETTINGS_OG_SOURCE.height,
	};
	if (registered) {
		return {
			...base,
			mediaAssetId: registered.mediaAssetId,
			workerAssetId: registered.workerAssetId,
			targetCreatedAt: registered.createdAt,
			derivatives: registered.derivatives,
		};
	}
	return workerAssetId ? { ...base, workerAssetId } : base;
}

export function validateSiteSettingsOgSource(
	bytes: Uint8Array,
	decoded: { format?: string; width?: number; height?: number },
) {
	const sourceSha1 = createHash("sha1").update(bytes).digest("hex");
	const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
	if (
		sourceSha1 !== SITE_SETTINGS_OG_SOURCE.sha1 ||
		!SITE_SETTINGS_OG_SOURCE.assetRef.startsWith(`image-${sourceSha1}-`) ||
		bytes.byteLength !== SITE_SETTINGS_OG_SOURCE.sizeBytes ||
		decoded.format !== "png" ||
		decoded.width !== SITE_SETTINGS_OG_SOURCE.width ||
		decoded.height !== SITE_SETTINGS_OG_SOURCE.height
	) {
		throw new Error("Site Settings OG source differs from the sealed Sanity asset");
	}
	return { sourceSha1, sourceSha256 };
}

export function createInitialSiteSettingsOgCheckpoint(sourceSha256: string) {
	return checkpoint("source-validated", 0, sourceSha256);
}

export function checkpointSiteSettingsOgPutAttempted(
	sourceSha256: string,
	workerAssetId: string,
	capabilityAttempt: 1 | 2,
) {
	targetIds("a".repeat(20), workerAssetId);
	return checkpoint("put-attempted", capabilityAttempt, sourceSha256, undefined, workerAssetId);
}

export function checkpointSiteSettingsOgRegistered(
	sourceSha256: string,
	registered: SiteSettingsOgRegisteredAsset,
	capabilityAttempt: 1 | 2,
) {
	targetIds(registered.mediaAssetId, registered.workerAssetId);
	positiveInteger(registered.createdAt, "Site Settings OG target creation time");
	const derivatives = {
		thumb: parseDerivative(registered.derivatives.thumb, registered.workerAssetId, "thumb"),
		card: parseDerivative(registered.derivatives.card, registered.workerAssetId, "card"),
	};
	return checkpoint("registered", capabilityAttempt, sourceSha256, {
		...registered,
		derivatives,
	});
}

export function checkpointSiteSettingsOgConfirmedMissing(current: SiteSettingsOgCheckpoint) {
	if (current.phase !== "put-attempted" || current.capabilityAttempt !== 1) {
		throw new Error(
			"Site Settings OG source remained missing after the bounded capability reissue",
		);
	}
	return checkpoint("source-validated", 1, current.sourceSha256);
}

export function isConfirmedSiteSettingsOgSourceMissing(status: number, body: string) {
	return status === 404 && body.trim() === SITE_SETTINGS_OG_SOURCE_MISSING_RESPONSE;
}

export function parseSiteSettingsOgCheckpoint(value: unknown) {
	const actual = record(value, "Site Settings OG checkpoint");
	const sourceSha256 = sha256(actual.sourceSha256);
	if (actual.phase === "source-validated") {
		if (actual.capabilityAttempt !== 0 && actual.capabilityAttempt !== 1) {
			throw new Error("Site Settings OG checkpoint capability attempt is invalid");
		}
		return exact(
			actual,
			checkpoint("source-validated", actual.capabilityAttempt, sourceSha256),
			"Site Settings OG checkpoint",
		);
	}
	if (actual.phase === "put-attempted") {
		if (actual.capabilityAttempt !== 1 && actual.capabilityAttempt !== 2) {
			throw new Error("Site Settings OG checkpoint capability attempt is invalid");
		}
		const ids = targetIds("a".repeat(20), actual.workerAssetId);
		return exact(
			actual,
			checkpointSiteSettingsOgPutAttempted(
				sourceSha256,
				ids.workerAssetId,
				actual.capabilityAttempt,
			),
			"Site Settings OG checkpoint",
		);
	}
	if (actual.phase === "registered") {
		if (actual.capabilityAttempt !== 1 && actual.capabilityAttempt !== 2) {
			throw new Error("Site Settings OG checkpoint capability attempt is invalid");
		}
		const ids = targetIds(actual.mediaAssetId, actual.workerAssetId);
		const registered = {
			...ids,
			createdAt: positiveInteger(actual.targetCreatedAt, "Site Settings OG target creation time"),
			derivatives: {
				thumb: parseDerivative(
					actual.derivatives && record(actual.derivatives, "derivatives").thumb,
					ids.workerAssetId,
					"thumb",
				),
				card: parseDerivative(
					actual.derivatives && record(actual.derivatives, "derivatives").card,
					ids.workerAssetId,
					"card",
				),
			},
		};
		return exact(
			actual,
			checkpointSiteSettingsOgRegistered(sourceSha256, registered, actual.capabilityAttempt),
			"Site Settings OG checkpoint",
		);
	}
	throw new Error("Site Settings OG checkpoint phase is invalid");
}

export function createSiteSettingsOgReceipt(
	sourceSha256: string,
	registered: SiteSettingsOgRegisteredAsset,
): SiteSettingsOgReceipt {
	const parsed = checkpointSiteSettingsOgRegistered(sourceSha256, registered, 1);
	const payload = {
		schemaVersion: 1 as const,
		operation: SITE_SETTINGS_OG_OPERATION,
		siteUrl: SITE_URL,
		sourceAssetRef: SITE_SETTINGS_OG_SOURCE.assetRef,
		sourceAssetRev: SITE_SETTINGS_OG_SOURCE.assetRev,
		sourceUrl: SITE_SETTINGS_OG_SOURCE.url,
		sourceOriginalFilename: SITE_SETTINGS_OG_SOURCE.originalFilename,
		sourceSha1: SITE_SETTINGS_OG_SOURCE.sha1,
		sourceSha256,
		sourceContentType: SITE_SETTINGS_OG_SOURCE.contentType,
		sourceSizeBytes: SITE_SETTINGS_OG_SOURCE.sizeBytes,
		sourceWidth: SITE_SETTINGS_OG_SOURCE.width,
		sourceHeight: SITE_SETTINGS_OG_SOURCE.height,
		sourceCrop: SITE_SETTINGS_OG_SOURCE.crop,
		sourceHotspot: SITE_SETTINGS_OG_SOURCE.hotspot,
		mediaAssetId: parsed.mediaAssetId as string,
		workerAssetId: parsed.workerAssetId as string,
		targetStatus: "ready" as const,
		targetCreatedAt: parsed.targetCreatedAt as number,
		derivatives: parsed.derivatives as SiteSettingsOgRegisteredAsset["derivatives"],
	};
	return {
		...payload,
		receiptDigest: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
	};
}

export function parseSiteSettingsOgReceipt(value: unknown) {
	const actual = record(value, "Site Settings OG receipt");
	const ids = targetIds(actual.mediaAssetId, actual.workerAssetId);
	const registered = {
		...ids,
		createdAt: positiveInteger(actual.targetCreatedAt, "Site Settings OG target creation time"),
		derivatives: {
			thumb: parseDerivative(
				actual.derivatives && record(actual.derivatives, "derivatives").thumb,
				ids.workerAssetId,
				"thumb",
			),
			card: parseDerivative(
				actual.derivatives && record(actual.derivatives, "derivatives").card,
				ids.workerAssetId,
				"card",
			),
		},
	};
	return exact(
		actual,
		createSiteSettingsOgReceipt(sha256(actual.sourceSha256), registered),
		"Site Settings OG receipt",
	);
}

export function createSiteSettingsOgCapabilityRequest(adminCookie: string) {
	return createCmsMediaCapabilityRequest(adminCookie, BOUNDARY_REF, SITE_SETTINGS_OG_SOURCE);
}

export function parseSiteSettingsOgCapability(value: unknown, nowMs: number) {
	return parseCmsMediaCapability(value, { sourceAssetRef: BOUNDARY_REF, nowMs });
}

export function parseSiteSettingsOgProcessResult(value: unknown, workerAssetId: string) {
	const registered = parseCmsMediaProcessResult(value, {
		sourceAssetRef: BOUNDARY_REF,
		workerAssetId,
		source: SITE_SETTINGS_OG_SOURCE,
	});
	const asset = record(record(value, "CMS media process response").asset, "process.asset");
	const derivatives = record(asset.derivatives, "process.asset.derivatives");
	return {
		mediaAssetId: registered.mediaAssetId,
		workerAssetId: registered.workerAssetId,
		createdAt: positiveInteger(asset.createdAt, "Site Settings OG target creation time"),
		derivatives: {
			thumb: parseDerivative(derivatives.thumb, workerAssetId, "thumb"),
			card: parseDerivative(derivatives.card, workerAssetId, "card"),
		},
	};
}
