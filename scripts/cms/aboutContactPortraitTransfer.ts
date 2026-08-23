import { createHash } from "node:crypto";
import {
	type CmsBlogMediaSourceAssetRef,
	createCmsMediaCapabilityRequest,
	parseCmsMediaCapability,
	parseCmsMediaProcessResult,
	validateSanityImageSourceAgainstExpectation,
} from "./sanityBlogMediaTransfer";

export const ABOUT_CONTACT_PORTRAIT_OPERATION = "R6-about-contact-portrait-v1" as const;
export const ABOUT_CONTACT_PORTRAIT_CONFIRMATION =
	"transfer R6 About portrait to www.angelsrest.online" as const;
export const ABOUT_CONTACT_PORTRAIT_SOURCE_MISSING_RESPONSE = "Uploaded object not found" as const;
export const ABOUT_CONTACT_PORTRAIT_SOURCE = {
	path: "src/lib/assets/DSCF7533.jpg",
	sha256: "0e94b665f7654c74158daf3aa2c497139c5cb7c4490d72205cfa3babd6dc4eb0",
	contentType: "image/jpeg",
	sizeBytes: 1_667_575,
	width: 1_440,
	height: 2_160,
} as const;

// A deterministic local transfer identity, not a Sanity content identity.
const BOUNDARY_REF =
	"image-0e94b665f7654c74158daf3aa2c497139c5cb7c4-1440x2160-jpg" as CmsBlogMediaSourceAssetRef;
const SITE_URL = "angelsrest.online" as const;
const CONVEX_ID = /^[a-z0-9]{20,64}$/;
const WORKER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Phase = "source-validated" | "put-attempted" | "registered";
type CapabilityAttempt = 0 | 1 | 2;
export type AboutContactPortraitCheckpoint = {
	schemaVersion: 1;
	operation: typeof ABOUT_CONTACT_PORTRAIT_OPERATION;
	siteUrl: typeof SITE_URL;
	phase: Phase;
	capabilityAttempt: CapabilityAttempt;
	sourceSha256: typeof ABOUT_CONTACT_PORTRAIT_SOURCE.sha256;
	sourceSizeBytes: typeof ABOUT_CONTACT_PORTRAIT_SOURCE.sizeBytes;
	sourceWidth: typeof ABOUT_CONTACT_PORTRAIT_SOURCE.width;
	sourceHeight: typeof ABOUT_CONTACT_PORTRAIT_SOURCE.height;
	workerAssetId?: string;
	mediaAssetId?: string;
};

export type AboutContactPortraitReceipt = {
	schemaVersion: 1;
	operation: typeof ABOUT_CONTACT_PORTRAIT_OPERATION;
	siteUrl: typeof SITE_URL;
	sourcePath: typeof ABOUT_CONTACT_PORTRAIT_SOURCE.path;
	sourceSha256: typeof ABOUT_CONTACT_PORTRAIT_SOURCE.sha256;
	sourceContentType: typeof ABOUT_CONTACT_PORTRAIT_SOURCE.contentType;
	sourceSizeBytes: typeof ABOUT_CONTACT_PORTRAIT_SOURCE.sizeBytes;
	sourceWidth: typeof ABOUT_CONTACT_PORTRAIT_SOURCE.width;
	sourceHeight: typeof ABOUT_CONTACT_PORTRAIT_SOURCE.height;
	mediaAssetId: string;
	workerAssetId: string;
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
		keys.some((key) => actual[key] !== expected[key])
	) {
		throw new Error(`${label} is invalid`);
	}
	return expected;
}

function workerId(value: unknown) {
	if (typeof value !== "string" || !WORKER_ID.test(value)) {
		throw new Error("About portrait Worker media identity is invalid");
	}
	return value;
}

function targetIds(mediaAssetId: unknown, workerAssetId: unknown) {
	if (typeof mediaAssetId !== "string" || !CONVEX_ID.test(mediaAssetId)) {
		throw new Error("About portrait Convex media identity is invalid");
	}
	return { mediaAssetId, workerAssetId: workerId(workerAssetId) };
}

function checkpoint(
	phase: Phase,
	capabilityAttempt: CapabilityAttempt,
	ids: { workerAssetId?: string; mediaAssetId?: string } = {},
): AboutContactPortraitCheckpoint {
	return {
		schemaVersion: 1,
		operation: ABOUT_CONTACT_PORTRAIT_OPERATION,
		siteUrl: SITE_URL,
		phase,
		capabilityAttempt,
		sourceSha256: ABOUT_CONTACT_PORTRAIT_SOURCE.sha256,
		sourceSizeBytes: ABOUT_CONTACT_PORTRAIT_SOURCE.sizeBytes,
		sourceWidth: ABOUT_CONTACT_PORTRAIT_SOURCE.width,
		sourceHeight: ABOUT_CONTACT_PORTRAIT_SOURCE.height,
		...ids,
	};
}

export function createInitialAboutContactPortraitCheckpoint() {
	return checkpoint("source-validated", 0);
}

export function checkpointAboutContactPortraitPutAttempted(
	workerAssetId: string,
	capabilityAttempt: 1 | 2,
) {
	return checkpoint("put-attempted", capabilityAttempt, {
		workerAssetId: workerId(workerAssetId),
	});
}

export function checkpointAboutContactPortraitRegistered(
	ids: { mediaAssetId: string; workerAssetId: string },
	capabilityAttempt: 1 | 2,
) {
	targetIds(ids.mediaAssetId, ids.workerAssetId);
	return checkpoint("registered", capabilityAttempt, ids);
}

export function checkpointAboutContactPortraitConfirmedMissing(
	current: AboutContactPortraitCheckpoint,
) {
	if (current.phase !== "put-attempted" || current.capabilityAttempt !== 1) {
		throw new Error("About portrait source remained missing after the bounded capability reissue");
	}
	return checkpoint("source-validated", 1);
}

export function isConfirmedAboutContactPortraitSourceMissing(status: number, body: string) {
	return status === 404 && body.trim() === ABOUT_CONTACT_PORTRAIT_SOURCE_MISSING_RESPONSE;
}

export function parseAboutContactPortraitCheckpoint(value: unknown) {
	const actual = record(value, "About portrait checkpoint");
	if (actual.phase === "source-validated") {
		if (actual.capabilityAttempt === 0) {
			return exact(
				actual,
				createInitialAboutContactPortraitCheckpoint(),
				"About portrait checkpoint",
			);
		}
		if (actual.capabilityAttempt === 1) {
			return exact(actual, checkpoint("source-validated", 1), "About portrait checkpoint");
		}
	}
	if (actual.phase === "put-attempted") {
		if (actual.capabilityAttempt !== 1 && actual.capabilityAttempt !== 2) {
			throw new Error("About portrait checkpoint capability attempt is invalid");
		}
		const workerAssetId = workerId(actual.workerAssetId);
		return exact(
			actual,
			checkpointAboutContactPortraitPutAttempted(workerAssetId, actual.capabilityAttempt),
			"About portrait checkpoint",
		);
	}
	if (actual.phase === "registered") {
		if (actual.capabilityAttempt !== 1 && actual.capabilityAttempt !== 2) {
			throw new Error("About portrait checkpoint capability attempt is invalid");
		}
		const ids = targetIds(actual.mediaAssetId, actual.workerAssetId);
		return exact(
			actual,
			checkpointAboutContactPortraitRegistered(ids, actual.capabilityAttempt),
			"About portrait checkpoint",
		);
	}
	throw new Error("About portrait checkpoint phase is invalid");
}

export function createAboutContactPortraitReceipt(ids: {
	mediaAssetId: string;
	workerAssetId: string;
}): AboutContactPortraitReceipt {
	targetIds(ids.mediaAssetId, ids.workerAssetId);
	const payload = {
		schemaVersion: 1 as const,
		operation: ABOUT_CONTACT_PORTRAIT_OPERATION,
		siteUrl: SITE_URL,
		sourcePath: ABOUT_CONTACT_PORTRAIT_SOURCE.path,
		sourceSha256: ABOUT_CONTACT_PORTRAIT_SOURCE.sha256,
		sourceContentType: ABOUT_CONTACT_PORTRAIT_SOURCE.contentType,
		sourceSizeBytes: ABOUT_CONTACT_PORTRAIT_SOURCE.sizeBytes,
		sourceWidth: ABOUT_CONTACT_PORTRAIT_SOURCE.width,
		sourceHeight: ABOUT_CONTACT_PORTRAIT_SOURCE.height,
		...ids,
	};
	return {
		...payload,
		receiptDigest: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
	};
}

export function parseAboutContactPortraitReceipt(value: unknown) {
	const actual = record(value, "About portrait receipt");
	const ids = targetIds(actual.mediaAssetId, actual.workerAssetId);
	return exact(actual, createAboutContactPortraitReceipt(ids), "About portrait receipt");
}

export function validateAboutContactPortraitSource(
	bytes: Uint8Array,
	decoded: { format?: string; width?: number; height?: number },
) {
	return validateSanityImageSourceAgainstExpectation({
		sourceAssetRef: BOUNDARY_REF,
		bytes,
		decoded,
		expected: {
			...ABOUT_CONTACT_PORTRAIT_SOURCE,
			sourceSha256: ABOUT_CONTACT_PORTRAIT_SOURCE.sha256,
		},
	});
}

export function createAboutContactPortraitCapabilityRequest(adminCookie: string) {
	return createCmsMediaCapabilityRequest(adminCookie, BOUNDARY_REF, ABOUT_CONTACT_PORTRAIT_SOURCE);
}

export function parseAboutContactPortraitCapability(value: unknown, nowMs: number) {
	return parseCmsMediaCapability(value, { sourceAssetRef: BOUNDARY_REF, nowMs });
}

export function parseAboutContactPortraitProcessResult(value: unknown, workerAssetId: string) {
	return parseCmsMediaProcessResult(value, {
		sourceAssetRef: BOUNDARY_REF,
		workerAssetId,
		source: ABOUT_CONTACT_PORTRAIT_SOURCE,
	});
}
