import {
	type PaidDigitalFileAsset,
	PRIVATE_CATALOG_ASSET_LIMITS,
	type PrivatePrintSourceAsset,
	validatePaidDigitalFileAsset,
	validatePrivatePrintSourceAsset,
} from "./catalogPrivateAssetValidators";
import type {
	CatalogPrivateAssetFacts,
	CatalogPrivateAssetReceiptSetVersion,
	CatalogPrivateInspectionReceiptSet,
	CatalogPrivateStorageReceiptSet,
} from "./catalogPrivateAssetReceiptContract";
import {
	CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION,
	CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION,
} from "./catalogPrivateAssetReceiptContract";
import {
	catalogPrivateAssetValidationError,
	catalogPrivateEditorReceiptError,
} from "./catalogPrivateAssetEditorErrors";

const RECEIPT_SET_MAX_ASSETS = 32;
const RECEIPT_SET_ID_MAX_LENGTH = 160;
const RECEIPT_SET_ID_PATTERN = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/;
export const CATALOG_PRIVATE_ASSET_RECEIPT_SET_ID_PREFIX = "catalog-private-assets-v1";
export const CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_ID_PREFIX = "catalog-private-assets-v2";
const ETAG_MAX_LENGTH = 256;
const DECODER_VERSION_MAX_LENGTH = 64;
const DECODER_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FULL_RASTER_PIXEL_MAX = 100_000_000;
const ZIP_ENTRY_MAX = 10_000;
const ZIP_COMPRESSION_RATIO_MAX = 1_000;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
export const CATALOG_PRIVATE_EDITOR_OPERATION_ID_PATTERN = /^[a-f0-9]{40}$/;
const CATALOG_PRIVATE_EDITOR_SOURCE_PREFIX = "editor-upload:";
const CATALOG_PRIVATE_EDITOR_ASSET_KEY_PREFIX = "editor-upload-";

/** Portable direct-upload and independently inspected source ceiling. */
export const CATALOG_PRIVATE_EDITOR_UPLOAD_MAX_SIZE_BYTES = 100_000_000;
export const CATALOG_PRIVATE_EDITOR_UPLOAD_SHARP_VERSION = "0.35.3";
export const CATALOG_PRIVATE_EDITOR_UPLOAD_LIBVIPS_VERSION = "8.18.3";
export const CATALOG_PRIVATE_EDITOR_ZIP_MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
export const CATALOG_PRIVATE_EDITOR_ZIP_MAX_COMPRESSION_RATIO = 100;

type RegistrationAudit = {
	createdAt: number;
	createdBy: string;
	verifiedAt: number;
	verifiedBy: string;
};

export type CatalogPrivateAssetRegistrationTarget =
	| { kind: "print_source"; asset: PrivatePrintSourceAsset }
	| { kind: "paid_digital_file"; asset: PaidDigitalFileAsset };

function compareOrdinal(left: string, right: string) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function compareFacts(left: CatalogPrivateAssetFacts, right: CatalogPrivateAssetFacts) {
	const kindOrder = { print_source: 0, paid_digital_file: 1 } as const;
	return kindOrder[left.kind] - kindOrder[right.kind]
		|| compareOrdinal(left.assetKey, right.assetKey);
}

function canonicalProvenance(provenance: CatalogPrivateAssetFacts["provenance"]) {
	return provenance.provider === "sanity"
		? {
				provider: provenance.provider,
				sourceId: provenance.sourceId,
				sourceRevision: provenance.sourceRevision,
			}
		: { provider: provenance.provider, sourceId: provenance.sourceId };
}

function canonicalFacts(facts: CatalogPrivateAssetFacts) {
	return {
		kind: facts.kind,
		assetKey: facts.assetKey,
		privateObjectKey: facts.privateObjectKey,
		originalFilename: facts.originalFilename,
		mimeType: facts.mimeType,
		sizeBytes: facts.sizeBytes,
		...(facts.kind === "print_source"
			? { widthPixels: facts.widthPixels, heightPixels: facts.heightPixels }
			: { version: facts.version ?? null }),
		sha256: facts.sha256,
		provenance: canonicalProvenance(facts.provenance),
	};
}

function canonicalAssetSetIdentity(
	receiptSet: Pick<CatalogPrivateStorageReceiptSet, "schemaVersion" | "siteUrl">,
	facts: readonly CatalogPrivateAssetFacts[],
) {
	return {
		schemaVersion: receiptSet.schemaVersion,
		siteUrl: receiptSet.siteUrl,
		assets: [...facts].sort(compareFacts).map(canonicalFacts),
	};
}

function canonicalReceiptSetIdentity(
	receiptSet: Pick<CatalogPrivateStorageReceiptSet, "schemaVersion" | "receiptSetId" | "siteUrl">,
	facts: readonly CatalogPrivateAssetFacts[],
) {
	return {
		...canonicalAssetSetIdentity(receiptSet, facts),
		receiptSetId: receiptSet.receiptSetId,
	};
}

function canonicalStorageReceiptSet(receiptSet: CatalogPrivateStorageReceiptSet) {
	return {
		...canonicalReceiptSetIdentity(
			receiptSet,
			receiptSet.receipts.map((receipt) => receipt.facts),
		),
		receipts: receiptSet.receipts.map((receipt) => ({
			facts: canonicalFacts(receipt.facts),
			uploadedAt: receipt.uploadedAt,
			etag: receipt.etag,
		})),
	};
}

function canonicalInspectionReceiptSet(receiptSet: CatalogPrivateInspectionReceiptSet) {
	return {
		...canonicalReceiptSetIdentity(
			receiptSet,
			receiptSet.receipts.map((receipt) => receipt.facts),
		),
		receipts: receiptSet.receipts.map((receipt) => ({
			facts: canonicalFacts(receipt.facts),
			inspection: receipt.inspection.method === "decoded_image_v1"
				? { method: receipt.inspection.method }
				: receipt.inspection.method === "sharp_libvips_full_raster_v1"
					? {
							method: receipt.inspection.method,
							decodedFormat: receipt.inspection.decodedFormat,
							decodedWidthPixels: receipt.inspection.decodedWidthPixels,
							decodedHeightPixels: receipt.inspection.decodedHeightPixels,
							decodedChannels: receipt.inspection.decodedChannels,
							decodedPageCount: receipt.inspection.decodedPageCount,
							decodedDepth: receipt.inspection.decodedDepth,
							decodedPixelCount: receipt.inspection.decodedPixelCount,
							decodedByteCount: receipt.inspection.decodedByteCount,
							rasterSha256: receipt.inspection.rasterSha256,
							sharpVersion: receipt.inspection.sharpVersion,
							libvipsVersion: receipt.inspection.libvipsVersion,
						}
					: {
							method: receipt.inspection.method,
							entryCount: receipt.inspection.entryCount,
							totalUncompressedBytes: receipt.inspection.totalUncompressedBytes,
							maximumEntryCompressionRatio:
								receipt.inspection.maximumEntryCompressionRatio,
							encryptedEntryCount: receipt.inspection.encryptedEntryCount,
							unsafePathCount: receipt.inspection.unsafePathCount,
							duplicatePathCount: receipt.inspection.duplicatePathCount,
						},
		})),
	};
}

async function sha256(value: string) {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(bytes)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

async function assetSetIdentity(
	receiptSet: Pick<CatalogPrivateStorageReceiptSet, "schemaVersion" | "siteUrl">,
	facts: readonly CatalogPrivateAssetFacts[],
) {
	const version = receiptSet.schemaVersion;
	const canonical = JSON.stringify(canonicalAssetSetIdentity(receiptSet, facts));
	const checksum = await sha256(`catalog-private-asset-set:v${version}:${canonical}`);
	const prefix = version === CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION
		? CATALOG_PRIVATE_ASSET_RECEIPT_SET_ID_PREFIX
		: CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_ID_PREFIX;
	return {
		canonical,
		checksum,
		receiptSetId: `${prefix}:${checksum}`,
	};
}

export async function createCatalogPrivateAssetReceiptSetId(
	siteUrl: string,
	facts: readonly CatalogPrivateAssetFacts[],
	schemaVersion: CatalogPrivateAssetReceiptSetVersion =
		CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION,
) {
	// Content addressing prevents a partial or drifted batch from claiming a reviewed set's ID.
	return (await assetSetIdentity({ schemaVersion, siteUrl }, facts)).receiptSetId;
}

function requireReceiptSetIdentity(
	receiptSet: Pick<
		CatalogPrivateStorageReceiptSet,
		"schemaVersion" | "receiptSetId" | "siteUrl"
	>,
) {
	if (
		(receiptSet.schemaVersion !== CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION
			&& receiptSet.schemaVersion !== CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION)
		|| receiptSet.receiptSetId.length > RECEIPT_SET_ID_MAX_LENGTH
		|| !RECEIPT_SET_ID_PATTERN.test(receiptSet.receiptSetId)
	) throw catalogPrivateAssetValidationError("Private catalog receipt-set identity is invalid");
}

function requireCanonicalIsoTimestamp(value: string) {
	if (value.length > 32) {
		throw catalogPrivateAssetValidationError("Private catalog upload timestamp is invalid");
	}
	const parsed = new Date(value);
	if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
		throw catalogPrivateAssetValidationError("Private catalog upload timestamp is invalid");
	}
}

function requireBoundedEtag(value: string) {
	if (
		value.length === 0
		|| value.length > ETAG_MAX_LENGTH
		|| value !== value.trim()
		|| CONTROL_CHARACTER_PATTERN.test(value)
	) throw catalogPrivateAssetValidationError("Private catalog storage ETag is invalid");
}

function requireReceiptFacts(
	siteUrl: string,
	receipts: readonly { facts: CatalogPrivateAssetFacts }[],
) {
	if (receipts.length === 0 || receipts.length > RECEIPT_SET_MAX_ASSETS) {
		throw catalogPrivateAssetValidationError(
			`Private catalog receipt sets require 1-${RECEIPT_SET_MAX_ASSETS} assets`,
		);
	}
	const facts = receipts.map((receipt) => receipt.facts);
	const assetKeys = new Set<string>();
	for (let index = 0; index < facts.length; index += 1) {
		const current = facts[index];
		if (!current) {
			throw catalogPrivateAssetValidationError("Private catalog receipt set is incomplete");
		}
		if (assetKeys.has(current.assetKey)) {
			throw catalogPrivateAssetValidationError(
				"Private catalog receipt-set asset keys must be unique across kinds",
			);
		}
		assetKeys.add(current.assetKey);
		privateCatalogRegistrationTarget(siteUrl, current, {
			createdAt: 0,
			createdBy: "catalog-receipt-contract:v1",
			verifiedAt: 0,
			verifiedBy: "catalog-receipt-contract:v1",
		});
		const previous = facts[index - 1];
		if (previous && compareFacts(previous, current) >= 0) {
			throw catalogPrivateAssetValidationError(
				"Private catalog receipts must be unique and canonically ordered",
			);
		}
	}
	return facts;
}

function requirePositiveSafeInteger(value: number, maximum: number, field: string) {
	if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
		throw catalogPrivateAssetValidationError(`${field} must be a bounded positive safe integer`);
	}
}

function requireSafeZipInspection(
	inspection: Extract<
		CatalogPrivateInspectionReceiptSet["receipts"][number],
		{ facts: { kind: "paid_digital_file" } }
	>["inspection"],
) {
	requirePositiveSafeInteger(inspection.entryCount, ZIP_ENTRY_MAX, "ZIP entry count");
	requirePositiveSafeInteger(
		inspection.totalUncompressedBytes,
		PRIVATE_CATALOG_ASSET_LIMITS.paidDigitalFileSizeBytes,
		"ZIP uncompressed byte count",
	);
	if (
		!Number.isFinite(inspection.maximumEntryCompressionRatio)
		|| inspection.maximumEntryCompressionRatio < 1
		|| inspection.maximumEntryCompressionRatio > ZIP_COMPRESSION_RATIO_MAX
	) {
		throw catalogPrivateAssetValidationError(
			"ZIP compression ratio is outside the safe inspection policy",
		);
	}
	for (const count of [
		inspection.encryptedEntryCount,
		inspection.unsafePathCount,
		inspection.duplicatePathCount,
	]) {
		if (count !== 0) {
			throw catalogPrivateAssetValidationError("ZIP inspection contains an unsafe entry");
		}
	}
}

export function privateCatalogRegistrationTarget(
	siteUrl: string,
	facts: CatalogPrivateAssetFacts,
	audit: RegistrationAudit,
): CatalogPrivateAssetRegistrationTarget {
	const common = {
		siteUrl,
		assetKey: facts.assetKey,
		privateObjectKey: facts.privateObjectKey,
		status: "verified" as const,
		originalFilename: facts.originalFilename,
		mimeType: facts.mimeType,
		sizeBytes: facts.sizeBytes,
		sha256: facts.sha256,
		provenance: facts.provenance,
		...audit,
	};
	if (facts.kind === "print_source") {
		const asset: PrivatePrintSourceAsset = {
			...common,
			mimeType: facts.mimeType,
			widthPixels: facts.widthPixels,
			heightPixels: facts.heightPixels,
		};
		validatePrivatePrintSourceAsset(asset);
		if (
			(asset.mimeType === "image/jpeg" && !/\.jpe?g$/i.test(asset.originalFilename))
			|| (asset.mimeType === "image/png" && !/\.png$/i.test(asset.originalFilename))
		) {
			throw catalogPrivateAssetValidationError(
				"Private print-source filename does not match its MIME type",
			);
		}
		return { kind: facts.kind, asset };
	}
	const asset: PaidDigitalFileAsset = {
		...common,
		mimeType: facts.mimeType,
		...(facts.version === undefined ? {} : { version: facts.version }),
	};
	validatePaidDigitalFileAsset(asset);
	return { kind: facts.kind, asset };
}

export async function validateCatalogPrivateStorageReceiptSet(
	receiptSet: CatalogPrivateStorageReceiptSet,
) {
	requireReceiptSetIdentity(receiptSet);
	const facts = requireReceiptFacts(receiptSet.siteUrl, receiptSet.receipts);
	for (const receipt of receiptSet.receipts) {
		requireCanonicalIsoTimestamp(receipt.uploadedAt);
		requireBoundedEtag(receipt.etag);
	}
	const assetSet = await assetSetIdentity(receiptSet, facts);
	if (receiptSet.receiptSetId !== assetSet.receiptSetId) {
		throw catalogPrivateAssetValidationError(
			"Private catalog receipt-set identity does not match its asset set",
		);
	}
	const roleCanonical = canonicalStorageReceiptSet(receiptSet);
	return {
		facts,
		assetSetChecksum: assetSet.checksum,
		roleChecksum: await sha256(
			`catalog-private-storage-receipt:v${receiptSet.schemaVersion}:${JSON.stringify(roleCanonical)}`,
		),
		assetCanonical: assetSet.canonical,
		canonical: JSON.stringify(roleCanonical),
	};
}

export async function validateCatalogPrivateInspectionReceiptSet(
	receiptSet: CatalogPrivateInspectionReceiptSet,
) {
	requireReceiptSetIdentity(receiptSet);
	const facts = requireReceiptFacts(receiptSet.siteUrl, receiptSet.receipts);
	for (const receipt of receiptSet.receipts) {
		if (receipt.facts.kind === "paid_digital_file") {
			if (receipt.inspection.method !== "safe_zip_v1") {
				throw catalogPrivateAssetValidationError(
					"Paid digital files require the safe ZIP inspection policy",
				);
			}
			requireSafeZipInspection(receipt.inspection);
			continue;
		}
		if (receiptSet.schemaVersion === CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION) {
			if (receipt.inspection.method !== "decoded_image_v1") {
				throw catalogPrivateAssetValidationError(
					"V1 private print sources require decoded image inspection",
				);
			}
			continue;
		}
		if (receipt.inspection.method !== "sharp_libvips_full_raster_v1") {
			throw catalogPrivateAssetValidationError(
				"V2 print sources require Sharp/libvips full-raster inspection",
			);
		}
		const expectedFormat = receipt.facts.mimeType === "image/jpeg" ? "jpeg" : "png";
		const expectedPixels = receipt.facts.widthPixels * receipt.facts.heightPixels;
		requirePositiveSafeInteger(expectedPixels, FULL_RASTER_PIXEL_MAX, "Declared pixel count");
		const expectedBytes = expectedPixels * receipt.inspection.decodedChannels;
		if (
			receipt.inspection.decodedFormat !== expectedFormat
			|| receipt.inspection.decodedWidthPixels !== receipt.facts.widthPixels
			|| receipt.inspection.decodedHeightPixels !== receipt.facts.heightPixels
		) {
			throw catalogPrivateAssetValidationError(
				"Full-raster decode metadata does not match the declared image",
			);
		}
		requirePositiveSafeInteger(
			receipt.inspection.decodedPixelCount,
			FULL_RASTER_PIXEL_MAX,
			"Decoded pixel count",
		);
		requirePositiveSafeInteger(
			receipt.inspection.decodedByteCount,
			FULL_RASTER_PIXEL_MAX * 4,
			"Decoded byte count",
		);
		if (
			receipt.inspection.decodedPixelCount !== expectedPixels
			|| receipt.inspection.decodedByteCount !== expectedBytes
		) {
			throw catalogPrivateAssetValidationError(
				"Full-raster inspection did not decode every declared pixel byte",
			);
		}
		if (!SHA256_PATTERN.test(receipt.inspection.rasterSha256)) {
			throw catalogPrivateAssetValidationError("Full-raster checksum is invalid");
		}
		for (const version of [
			receipt.inspection.sharpVersion,
			receipt.inspection.libvipsVersion,
		]) {
			if (
				version.length > DECODER_VERSION_MAX_LENGTH
				|| version !== version.trim()
				|| !DECODER_VERSION_PATTERN.test(version)
			) throw catalogPrivateAssetValidationError("Full-raster decoder version is invalid");
		}
	}
	const assetSet = await assetSetIdentity(receiptSet, facts);
	if (receiptSet.receiptSetId !== assetSet.receiptSetId) {
		throw catalogPrivateAssetValidationError(
			"Private catalog receipt-set identity does not match its asset set",
		);
	}
	const roleCanonical = canonicalInspectionReceiptSet(receiptSet);
	return {
		facts,
		assetSetChecksum: assetSet.checksum,
		roleChecksum: await sha256(
			`catalog-private-inspection-receipt:v${receiptSet.schemaVersion}:${JSON.stringify(roleCanonical)}`,
		),
		assetCanonical: assetSet.canonical,
		canonical: JSON.stringify(roleCanonical),
	};
}

const EDITOR_RECEIPT_SET_KEYS = new Set(["schemaVersion", "receiptSetId", "siteUrl", "receipts"]);
const EDITOR_STORAGE_RECEIPT_KEYS = new Set(["facts", "uploadedAt", "etag"]);
const EDITOR_INSPECTION_RECEIPT_KEYS = new Set(["facts", "inspection"]);
const EDITOR_COMMON_FACT_KEYS = [
	"kind",
	"assetKey",
	"privateObjectKey",
	"originalFilename",
	"mimeType",
	"sizeBytes",
	"sha256",
	"provenance",
] as const;
const EDITOR_PRINT_FACT_KEYS = new Set([...EDITOR_COMMON_FACT_KEYS, "widthPixels", "heightPixels"]);
const EDITOR_PAID_FACT_KEYS = new Set([...EDITOR_COMMON_FACT_KEYS, "version"]);
const EDITOR_PRINT_INSPECTION_KEYS = new Set([
	"method",
	"decodedFormat",
	"decodedWidthPixels",
	"decodedHeightPixels",
	"decodedChannels",
	"decodedPageCount",
	"decodedDepth",
	"decodedPixelCount",
	"decodedByteCount",
	"rasterSha256",
	"sharpVersion",
	"libvipsVersion",
]);
const EDITOR_PAID_INSPECTION_KEYS = new Set([
	"method",
	"entryCount",
	"totalUncompressedBytes",
	"maximumEntryCompressionRatio",
	"encryptedEntryCount",
	"unsafePathCount",
	"duplicatePathCount",
]);
const EDITOR_PROVENANCE_KEYS = new Set(["provider", "sourceId"]);

type EditorStorageReceiptSet = Extract<
	CatalogPrivateStorageReceiptSet,
	{ schemaVersion: typeof CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION }
>;
type EditorInspectionReceiptSet = Extract<
	CatalogPrivateInspectionReceiptSet,
	{ schemaVersion: typeof CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION }
>;

/**
 * Detects the reserved schema-2 editor namespace without reclassifying retained
 * V1, Sanity, or noncanonical historical editor provenance.
 */
export function claimsCatalogPrivateEditorOperation(
	receiptSet: CatalogPrivateStorageReceiptSet | CatalogPrivateInspectionReceiptSet,
) {
	return (
		receiptSet.schemaVersion === CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION &&
		receiptSet.receipts.some(
			({ facts }) =>
				facts.provenance.provider === "editor_upload" &&
				(facts.provenance.sourceId.startsWith(CATALOG_PRIVATE_EDITOR_SOURCE_PREFIX) ||
					facts.assetKey.startsWith(CATALOG_PRIVATE_EDITOR_ASSET_KEY_PREFIX)),
		)
	);
}

function editorShapeError(): never {
	throw catalogPrivateEditorReceiptError("validation");
}

function requireEditorObject(
	value: unknown,
	allowed: ReadonlySet<string>,
): asserts value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) editorShapeError();
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) editorShapeError();
	}
}

function requireEditorString(value: unknown): asserts value is string {
	if (typeof value !== "string") editorShapeError();
}

function requireEditorNumber(value: unknown): asserts value is number {
	if (typeof value !== "number") editorShapeError();
}

function requireEditorFactsShape(value: unknown): asserts value is CatalogPrivateAssetFacts {
	requireEditorObject(
		value,
		value !== null &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			"kind" in value &&
			value.kind === "print_source"
			? EDITOR_PRINT_FACT_KEYS
			: EDITOR_PAID_FACT_KEYS,
	);
	if (value.kind !== "print_source" && value.kind !== "paid_digital_file") editorShapeError();
	for (const field of ["assetKey", "privateObjectKey", "originalFilename", "sha256"] as const)
		requireEditorString(value[field]);
	requireEditorNumber(value.sizeBytes);
	requireEditorObject(value.provenance, EDITOR_PROVENANCE_KEYS);
	if (value.provenance.provider !== "editor_upload") editorShapeError();
	requireEditorString(value.provenance.sourceId);
	if (value.kind === "print_source") {
		if (value.mimeType !== "image/jpeg" && value.mimeType !== "image/png") editorShapeError();
		requireEditorNumber(value.widthPixels);
		requireEditorNumber(value.heightPixels);
		return;
	}
	if (value.mimeType !== "application/zip") editorShapeError();
	if ("version" in value) requireEditorString(value.version);
}

function requireEditorReceiptSetShape(value: unknown): asserts value is Record<string, unknown> & {
	schemaVersion: 2;
	receiptSetId: string;
	siteUrl: string;
	receipts: unknown[];
} {
	requireEditorObject(value, EDITOR_RECEIPT_SET_KEYS);
	if (value.schemaVersion !== CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION) editorShapeError();
	requireEditorString(value.receiptSetId);
	requireEditorString(value.siteUrl);
	if (!Array.isArray(value.receipts) || value.receipts.length !== 1) editorShapeError();
}

function requireEditorStorageReceiptSetShape(
	value: unknown,
): asserts value is EditorStorageReceiptSet {
	requireEditorReceiptSetShape(value);
	const receipt = value.receipts[0];
	requireEditorObject(receipt, EDITOR_STORAGE_RECEIPT_KEYS);
	requireEditorFactsShape(receipt.facts);
	requireEditorString(receipt.uploadedAt);
	requireEditorString(receipt.etag);
}

function requireEditorInspectionReceiptSetShape(
	value: unknown,
): asserts value is EditorInspectionReceiptSet {
	requireEditorReceiptSetShape(value);
	const receipt = value.receipts[0];
	requireEditorObject(receipt, EDITOR_INSPECTION_RECEIPT_KEYS);
	requireEditorFactsShape(receipt.facts);
	if (receipt.facts.kind === "print_source") {
		requireEditorObject(receipt.inspection, EDITOR_PRINT_INSPECTION_KEYS);
		if (
			receipt.inspection.method !== "sharp_libvips_full_raster_v1" ||
			(receipt.inspection.decodedFormat !== "jpeg" && receipt.inspection.decodedFormat !== "png") ||
			(receipt.inspection.decodedChannels !== 1 &&
				receipt.inspection.decodedChannels !== 2 &&
				receipt.inspection.decodedChannels !== 3 &&
				receipt.inspection.decodedChannels !== 4) ||
			receipt.inspection.decodedPageCount !== 1 ||
			receipt.inspection.decodedDepth !== "uchar"
		)
			editorShapeError();
		for (const field of [
			"decodedWidthPixels",
			"decodedHeightPixels",
			"decodedPixelCount",
			"decodedByteCount",
		] as const)
			requireEditorNumber(receipt.inspection[field]);
		for (const field of ["rasterSha256", "sharpVersion", "libvipsVersion"] as const) {
			requireEditorString(receipt.inspection[field]);
		}
		return;
	}
	requireEditorObject(receipt.inspection, EDITOR_PAID_INSPECTION_KEYS);
	if (receipt.inspection.method !== "safe_zip_v1") editorShapeError();
	for (const field of [
		"entryCount",
		"totalUncompressedBytes",
		"maximumEntryCompressionRatio",
		"encryptedEntryCount",
		"unsafePathCount",
		"duplicatePathCount",
	] as const)
		requireEditorNumber(receipt.inspection[field]);
}

export type CatalogPrivateEditorOperationIdentity = {
	operationId: string;
	sourceId: string;
	kind: CatalogPrivateAssetFacts["kind"];
	assetKey: string;
	privateObjectKey: string;
};

function requireCatalogPrivateEditorUploadFacts(
	receiptSet: CatalogPrivateStorageReceiptSet | CatalogPrivateInspectionReceiptSet,
	facts: readonly CatalogPrivateAssetFacts[],
): CatalogPrivateEditorOperationIdentity {
	if (
		receiptSet.schemaVersion !== CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION ||
		receiptSet.receipts.length !== 1 ||
		facts.length !== 1
	) {
		throw catalogPrivateAssetValidationError(
			"Private catalog editor receipts require exactly one schema-2 asset",
		);
	}
	const factsItem = facts[0];
	if (!factsItem || factsItem.provenance.provider !== "editor_upload") {
		throw catalogPrivateAssetValidationError(
			"Private catalog editor receipts require editor-upload provenance",
		);
	}
	const operationId = factsItem.provenance.sourceId.startsWith(CATALOG_PRIVATE_EDITOR_SOURCE_PREFIX)
		? factsItem.provenance.sourceId.slice(CATALOG_PRIVATE_EDITOR_SOURCE_PREFIX.length)
		: "";
	if (!CATALOG_PRIVATE_EDITOR_OPERATION_ID_PATTERN.test(operationId)) {
		throw catalogPrivateAssetValidationError(
			"Private catalog editor source identity is not canonical",
		);
	}
	const sourceId = `${CATALOG_PRIVATE_EDITOR_SOURCE_PREFIX}${operationId}`;
	const assetKey = `${CATALOG_PRIVATE_EDITOR_ASSET_KEY_PREFIX}${operationId}`;
	if (factsItem.provenance.sourceId !== sourceId || factsItem.assetKey !== assetKey) {
		throw catalogPrivateAssetValidationError(
			"Private catalog editor operation identity has drifted",
		);
	}
	if (factsItem.sizeBytes > CATALOG_PRIVATE_EDITOR_UPLOAD_MAX_SIZE_BYTES) {
		throw catalogPrivateAssetValidationError(
			"Private catalog editor source exceeds the direct-upload limit",
		);
	}
	return {
		operationId,
		sourceId,
		kind: factsItem.kind,
		assetKey,
		privateObjectKey: factsItem.privateObjectKey,
	};
}

/** Additive exact-one editor admission; the generic historical validator is unchanged. */
export async function validateCatalogPrivateEditorStorageReceiptSet(receiptSet: unknown) {
	requireEditorStorageReceiptSetShape(receiptSet);
	const checked = await validateCatalogPrivateStorageReceiptSet(receiptSet);
	return {
		...checked,
		receiptSet,
		operation: requireCatalogPrivateEditorUploadFacts(receiptSet, checked.facts),
	};
}

/** Additive exact-one editor admission with the production schema-2 decoder policy pinned. */
export async function validateCatalogPrivateEditorInspectionReceiptSet(receiptSet: unknown) {
	requireEditorInspectionReceiptSetShape(receiptSet);
	const checked = await validateCatalogPrivateInspectionReceiptSet(receiptSet);
	const operation = requireCatalogPrivateEditorUploadFacts(receiptSet, checked.facts);
	const facts = checked.facts[0];
	const receipt = receiptSet.receipts[0];
	if (!facts || !receipt || receipt.facts.kind !== facts.kind) {
		throw catalogPrivateAssetValidationError(
			"Private catalog editor inspection receipt is incomplete",
		);
	}
	if (
		facts.kind === "print_source" &&
		(receipt.inspection.method !== "sharp_libvips_full_raster_v1" ||
			receipt.inspection.sharpVersion !== CATALOG_PRIVATE_EDITOR_UPLOAD_SHARP_VERSION ||
			receipt.inspection.libvipsVersion !== CATALOG_PRIVATE_EDITOR_UPLOAD_LIBVIPS_VERSION)
	) {
		throw catalogPrivateAssetValidationError(
			"Private catalog editor decoder policy is unsupported",
		);
	}
	if (
		facts.kind === "paid_digital_file" &&
		receipt.inspection.method === "safe_zip_v1" &&
		(receipt.inspection.totalUncompressedBytes >
			CATALOG_PRIVATE_EDITOR_ZIP_MAX_UNCOMPRESSED_BYTES ||
			receipt.inspection.maximumEntryCompressionRatio >
				CATALOG_PRIVATE_EDITOR_ZIP_MAX_COMPRESSION_RATIO)
	) {
		throw catalogPrivateAssetValidationError(
			"Private catalog editor ZIP inspection exceeds the safe policy",
		);
	}
	return { ...checked, receiptSet, operation };
}

export function sameCatalogPrivateStorageReceiptSet(
	left: CatalogPrivateStorageReceiptSet,
	right: CatalogPrivateStorageReceiptSet,
) {
	return JSON.stringify(canonicalStorageReceiptSet(left))
		=== JSON.stringify(canonicalStorageReceiptSet(right));
}

export function sameCatalogPrivateInspectionReceiptSet(
	left: CatalogPrivateInspectionReceiptSet,
	right: CatalogPrivateInspectionReceiptSet,
) {
	return JSON.stringify(canonicalInspectionReceiptSet(left))
		=== JSON.stringify(canonicalInspectionReceiptSet(right));
}
