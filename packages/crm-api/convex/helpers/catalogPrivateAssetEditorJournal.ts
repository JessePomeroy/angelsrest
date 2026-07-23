import { ConvexError } from "convex/values";
import type { CatalogProductKind } from "./catalogProductValidators";

export const CATALOG_EDITOR_SUPPORTED_SITE = "angelsrest.online";
export const CATALOG_EDITOR_UPLOAD_ORIGIN = "https://www.angelsrest.online";
export const CATALOG_EDITOR_WORKER_ORIGIN = "https://cms-media-worker.thinkingofview.workers.dev";
export const CATALOG_EDITOR_WORKER_PREPARE_PATH = "/v1/catalog-assets/editor-uploads/prepare";
export const CATALOG_EDITOR_WORKER_UPLOAD_PATH = "/v1/catalog-assets/editor-uploads/source";
export const CATALOG_EDITOR_WORKER_STORAGE_PATH = "/v1/catalog-assets/editor-uploads/storage";
export const CATALOG_EDITOR_WORKER_INSPECTION_PATH = "/v1/catalog-assets/editor-uploads/inspection";
export const CATALOG_EDITOR_PREPARE_ATTESTATION_HEADER =
	"X-CMS-Editor-Prepare-Attestation";
export const CATALOG_EDITOR_PREPARE_ATTESTATION_VERSION = "v1";
export const CATALOG_EDITOR_PREPARE_ATTESTATION_DOMAIN =
	"cms-media-worker\0production\0editor-upload-prepare-attestation\0v1\0";
export const CATALOG_EDITOR_UPLOAD_TOKEN_TTL_MS = 15 * 60 * 1000;
export const CATALOG_EDITOR_CONTINUATION_TTL_MS = 24 * 60 * 60 * 1000;
export const CATALOG_EDITOR_CAPABILITY_PURGE_SKEW_MS = 60 * 1000;
export const CATALOG_EDITOR_PAID_FILE_MAX_SIZE_BYTES = 16_777_216;
export const CATALOG_EDITOR_PRINT_MAX_SIZE_BYTES = 100_000_000;
export const CATALOG_EDITOR_FULL_RASTER_PIXEL_MAX = 100_000_000;
export const CATALOG_EDITOR_MAX_ATTEMPTS = 8;
export const CATALOG_EDITOR_STORAGE_LEASE_MS = 60 * 1000;
export const CATALOG_EDITOR_INSPECTION_LEASE_MS = 180 * 1000;
// A continuation must remain valid beyond the complete execution lease so a
// claim made at a clock boundary cannot authorize work after token expiry.
export const CATALOG_EDITOR_CLAIM_EXPIRY_SKEW_MS = 5 * 1000;

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const OPERATION_ID_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TOKEN_PATTERN = /^cms-editor-upload-v1\.[A-Za-z0-9_-]{2768}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const LOWERCASE_SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SHA256_BYTES = 32;
const encoder = new TextEncoder();

export type CatalogEditorJournalDescriptor =
	| {
			productKind: "print" | "print_set";
			kind: "print_source";
			originalFilename: string;
			contentType: "image/jpeg" | "image/png";
			sizeBytes: number;
			sha256: string;
			widthPixels: number;
			heightPixels: number;
	  }
	| {
			productKind: "digital_download";
			kind: "paid_digital_file";
			originalFilename: string;
			contentType: "application/zip";
			sizeBytes: number;
			sha256: string;
			version?: string;
	  };

export type CatalogEditorBeginBody = CatalogEditorJournalDescriptor & { uploadHandle: string };

export function isCatalogEditorUploadHandle(value: unknown): value is string {
	return typeof value === "string" && UUID_V4_PATTERN.test(value);
}

export type CatalogEditorPrepareExchangeBinding = {
	siteUrl: string;
	operationId: string;
	declarationHash: string;
};

export type CatalogEditorWorkerPrepareResponse = {
	binding: CatalogEditorPrepareExchangeBinding;
	uploadToken: string;
	uploadExpiresAt: number;
	storageContinuation: string;
	storageExpiresAt: number;
	inspectionContinuation: string;
	inspectionExpiresAt: number;
	issuedAt: number;
};

type JournalErrorCategory = "validation" | "conflict" | "gone" | "rate_limited";

type JournalErrorData = {
	scope: "catalog_private_editor_journal";
	category: JournalErrorCategory;
};

export function catalogEditorJournalError(category: JournalErrorCategory) {
	return new ConvexError<JournalErrorData>({
		scope: "catalog_private_editor_journal",
		category,
	});
}

export function catalogEditorJournalErrorCategory(error: unknown): JournalErrorCategory | null {
	if (!(error instanceof ConvexError)) return null;
	const data = error.data;
	if (
		!data
		|| typeof data !== "object"
		|| Array.isArray(data)
		|| data.scope !== "catalog_private_editor_journal"
		|| !["validation", "conflict", "gone", "rate_limited"].includes(data.category)
	) return null;
	return data.category as JournalErrorCategory;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
	const keys = Object.keys(value);
	return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isWellFormedText(value: unknown, maximum: number) {
	if (
		typeof value !== "string"
		|| value.length === 0
		|| value.length > maximum
		|| value !== value.trim()
		|| CONTROL_CHARACTER_PATTERN.test(value)
	) return false;
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const trailing = value.charCodeAt(index + 1);
			if (!(trailing >= 0xdc00 && trailing <= 0xdfff)) return false;
			index += 1;
		} else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
	}
	return true;
}

function positiveSafeInteger(value: unknown, maximum: number): value is number {
	return typeof value === "number"
		&& Number.isSafeInteger(value)
		&& value > 0
		&& value <= maximum;
}

export function parseCatalogEditorBeginBody(value: Record<string, unknown>): CatalogEditorBeginBody | null {
	if (!isCatalogEditorUploadHandle(value.uploadHandle)) {
		return null;
	}
	if (
		(value.productKind === "print" || value.productKind === "print_set")
		&& exactKeys(value, [
			"uploadHandle",
			"productKind",
			"originalFilename",
			"contentType",
			"sizeBytes",
			"sha256",
			"widthPixels",
			"heightPixels",
		])
		&& isWellFormedText(value.originalFilename, 255)
		&& !/[\\/]/.test(value.originalFilename as string)
		&& (value.contentType === "image/jpeg" || value.contentType === "image/png")
		&& positiveSafeInteger(value.sizeBytes, CATALOG_EDITOR_PRINT_MAX_SIZE_BYTES)
		&& positiveSafeInteger(value.widthPixels, 100_000)
		&& positiveSafeInteger(value.heightPixels, 100_000)
		&& value.widthPixels * value.heightPixels <= CATALOG_EDITOR_FULL_RASTER_PIXEL_MAX
		&& SHA256_PATTERN.test(typeof value.sha256 === "string" ? value.sha256 : "")
		&& (value.contentType === "image/jpeg"
			? /\.jpe?g$/i.test(value.originalFilename as string)
			: /\.png$/i.test(value.originalFilename as string))
	) {
		return {
			uploadHandle: value.uploadHandle as string,
			productKind: value.productKind,
			kind: "print_source",
			originalFilename: value.originalFilename as string,
			contentType: value.contentType,
			sizeBytes: value.sizeBytes,
			sha256: value.sha256 as string,
			widthPixels: value.widthPixels,
			heightPixels: value.heightPixels,
		};
	}
	const digitalKeys = value.version === undefined
		? ["uploadHandle", "productKind", "originalFilename", "contentType", "sizeBytes", "sha256"]
		: [
				"uploadHandle",
				"productKind",
				"originalFilename",
				"contentType",
				"sizeBytes",
				"sha256",
				"version",
			];
	if (
		value.productKind === "digital_download"
		&& exactKeys(value, digitalKeys)
		&& isWellFormedText(value.originalFilename, 255)
		&& !/[\\/]/.test(value.originalFilename as string)
		&& /\.zip$/i.test(value.originalFilename as string)
		&& value.contentType === "application/zip"
		&& positiveSafeInteger(value.sizeBytes, CATALOG_EDITOR_PAID_FILE_MAX_SIZE_BYTES)
		&& SHA256_PATTERN.test(typeof value.sha256 === "string" ? value.sha256 : "")
		&& (value.version === undefined || isWellFormedText(value.version, 64))
	) {
		return {
			uploadHandle: value.uploadHandle as string,
			productKind: "digital_download",
			kind: "paid_digital_file",
			originalFilename: value.originalFilename as string,
			contentType: "application/zip",
			sizeBytes: value.sizeBytes,
			sha256: value.sha256 as string,
			...(value.version === undefined ? {} : { version: value.version as string }),
		};
	}
	return null;
}

export function productKindMatchesAssetKind(
	productKind: CatalogProductKind,
	kind: "print_source" | "paid_digital_file",
) {
	return kind === "print_source"
		? productKind === "print" || productKind === "print_set"
		: productKind === "digital_download";
}

export function privateObjectKey(
	siteUrl: string,
	operationId: string,
	kind: "print_source" | "paid_digital_file",
) {
	const boundary = kind === "print_source" ? "print-sources" : "paid-digital-files";
	return `sites/${siteUrl}/catalog/${boundary}/editor-upload-${operationId}/original`;
}

export function createCatalogEditorWorkerDeclaration(
	siteUrl: string,
	operationId: string,
	descriptor: CatalogEditorJournalDescriptor,
) {
	if (!OPERATION_ID_PATTERN.test(operationId)) throw catalogEditorJournalError("validation");
	return {
		operationId,
		siteUrl,
		uploadOrigin: CATALOG_EDITOR_UPLOAD_ORIGIN,
		kind: descriptor.kind,
		originalFilename: descriptor.originalFilename,
		contentType: descriptor.contentType,
		sizeBytes: descriptor.sizeBytes,
		sha256: descriptor.sha256,
		...(descriptor.kind === "print_source"
			? { widthPixels: descriptor.widthPixels, heightPixels: descriptor.heightPixels }
			: descriptor.version === undefined
				? {}
				: { version: descriptor.version }),
	};
}

export function canonicalCatalogEditorDeclaration(
	siteUrl: string,
	operationId: string,
	descriptor: CatalogEditorJournalDescriptor,
) {
	return JSON.stringify(createCatalogEditorWorkerDeclaration(siteUrl, operationId, descriptor));
}

async function sha256Bytes(value: Uint8Array) {
	return new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(value)));
}

function lowercaseHex(bytes: Uint8Array) {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeLowercaseHex(value: string) {
	if (!LOWERCASE_SHA256_PATTERN.test(value)) return null;
	return Uint8Array.from(value.match(/.{2}/g) ?? [], (byte) => Number.parseInt(byte, 16));
}

function catalogEditorPrepareAttestationInput(
	requestHash: Uint8Array,
	responseHash: Uint8Array,
) {
	if (requestHash.byteLength !== SHA256_BYTES || responseHash.byteLength !== SHA256_BYTES) {
		throw new TypeError("Editor prepare attestation requires SHA-256 digests");
	}
	const domain = encoder.encode(CATALOG_EDITOR_PREPARE_ATTESTATION_DOMAIN);
	const input = new Uint8Array(domain.byteLength + requestHash.byteLength + responseHash.byteLength);
	input.set(domain);
	input.set(requestHash, domain.byteLength);
	input.set(responseHash, domain.byteLength + requestHash.byteLength);
	return input;
}

/**
 * Independently mirrors Gallery Worker commit 4f8b6aed's exact v1 byte
 * contract. Web Crypto verification performs the MAC comparison without a
 * data-dependent JavaScript string comparison.
 */
export async function verifyCatalogEditorPrepareAttestation(
	attestation: string | null,
	controlSecret: string,
	requestBodyBytes: Uint8Array,
	responseBodyBytes: Uint8Array,
) {
	const prefix = `${CATALOG_EDITOR_PREPARE_ATTESTATION_VERSION}.`;
	if (!attestation?.startsWith(prefix)) return false;
	const signature = decodeLowercaseHex(attestation.slice(prefix.length));
	if (!signature) return false;
	const [requestHash, responseHash, key] = await Promise.all([
		sha256Bytes(requestBodyBytes),
		sha256Bytes(responseBodyBytes),
		crypto.subtle.importKey(
			"raw",
			encoder.encode(controlSecret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["verify"],
		),
	]);
	return await crypto.subtle.verify(
		"HMAC",
		key,
		signature,
		catalogEditorPrepareAttestationInput(requestHash, responseHash),
	);
}

export async function sha256Hex(value: string) {
	return lowercaseHex(await sha256Bytes(encoder.encode(value)));
}

export async function catalogEditorUploadHandleHash(siteUrl: string, uploadHandle: string) {
	if (!UUID_V4_PATTERN.test(uploadHandle)) throw catalogEditorJournalError("validation");
	return await sha256Hex(`catalog-private-editor-upload-handle:v1\0${siteUrl}\0${uploadHandle}`);
}

export async function catalogEditorDeclarationHash(canonical: string) {
	return await sha256Hex(`catalog-private-editor-declaration:v1\0${canonical}`);
}

export function isCatalogEditorCapabilityValue(value: string) {
	return TOKEN_PATTERN.test(value);
}

export async function catalogEditorCapabilityDigest(
	purpose: "upload" | "storage" | "inspection",
	value: string,
) {
	return await sha256Hex(`catalog-private-editor-capability:v1\0${purpose}\0${value}`);
}

/** Stable raw-value identity, deliberately independent of purpose and operation. */
export async function catalogEditorRawCapabilityFingerprint(value: string) {
	return await sha256Hex(`catalog-private-editor-capability-raw:v1\0${value}`);
}

export async function catalogEditorLeaseDigest(
	purpose: "storage" | "inspection_dispatch",
	value: string,
) {
	return await sha256Hex(`catalog-private-editor-lease:v1\0${purpose}\0${value}`);
}

function canonicalIso(value: unknown) {
	if (typeof value !== "string" || value.length > 32) return null;
	const parsed = new Date(value);
	return Number.isSafeInteger(parsed.valueOf()) && parsed.toISOString() === value
		? parsed.valueOf()
		: null;
}

export function parseCatalogEditorWorkerPrepareResponse(
	value: Record<string, unknown>,
	now: number,
	binding: CatalogEditorPrepareExchangeBinding,
): CatalogEditorWorkerPrepareResponse | null {
	if (
		binding.siteUrl !== CATALOG_EDITOR_SUPPORTED_SITE
		|| !OPERATION_ID_PATTERN.test(binding.operationId)
		|| !SHA256_PATTERN.test(binding.declarationHash)
		|| !exactKeys(value, ["status", "uploadPath", "uploadToken", "uploadExpiresAt", "serverOnly"])
	) {
		return null;
	}
	if (
		value.status !== "upload_required"
		|| value.uploadPath !== CATALOG_EDITOR_WORKER_UPLOAD_PATH
		|| typeof value.uploadToken !== "string"
		|| !TOKEN_PATTERN.test(value.uploadToken)
		|| !value.serverOnly
		|| typeof value.serverOnly !== "object"
		|| Array.isArray(value.serverOnly)
	) return null;
	const serverOnly = value.serverOnly as Record<string, unknown>;
	if (!exactKeys(serverOnly, [
		"custody",
		"purpose",
		"storageContinuation",
		"storageExpiresAt",
		"inspectionContinuation",
		"inspectionExpiresAt",
	])) return null;
	if (
		serverOnly.custody !== "server_only"
		|| serverOnly.purpose !== "future_storage_completion"
		|| typeof serverOnly.storageContinuation !== "string"
		|| !TOKEN_PATTERN.test(serverOnly.storageContinuation)
		|| typeof serverOnly.inspectionContinuation !== "string"
		|| !TOKEN_PATTERN.test(serverOnly.inspectionContinuation)
		|| new Set([
			value.uploadToken,
			serverOnly.storageContinuation,
			serverOnly.inspectionContinuation,
		]).size !== 3
	) return null;
	const uploadExpiresAt = canonicalIso(value.uploadExpiresAt);
	const storageExpiresAt = canonicalIso(serverOnly.storageExpiresAt);
	const inspectionExpiresAt = canonicalIso(serverOnly.inspectionExpiresAt);
	if (
		uploadExpiresAt === null
		|| storageExpiresAt === null
		|| inspectionExpiresAt === null
		|| storageExpiresAt !== inspectionExpiresAt
		|| storageExpiresAt - uploadExpiresAt
			!== CATALOG_EDITOR_CONTINUATION_TTL_MS - CATALOG_EDITOR_UPLOAD_TOKEN_TTL_MS
	) return null;
	const issuedAt = uploadExpiresAt - CATALOG_EDITOR_UPLOAD_TOKEN_TTL_MS;
	if (
		!Number.isSafeInteger(now)
		|| issuedAt > now + 60_000
		|| issuedAt < now - 5 * 60_000
		|| uploadExpiresAt <= now
	) return null;
	return {
		binding,
		uploadToken: value.uploadToken,
		uploadExpiresAt,
		storageContinuation: serverOnly.storageContinuation,
		storageExpiresAt,
		inspectionContinuation: serverOnly.inspectionContinuation,
		inspectionExpiresAt,
		issuedAt,
	};
}

export function catalogEditorRetryDelayMs(attempts: number) {
	return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000);
}
