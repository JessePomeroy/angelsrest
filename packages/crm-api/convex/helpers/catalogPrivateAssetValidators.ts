import type { Infer } from "convex/values";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { catalogPrivateAssetValidationError } from "./catalogPrivateAssetEditorErrors";

export const privateCatalogAssetStatusValidator = v.literal("verified");

export const privateCatalogAssetProvenanceValidator = v.union(
	v.object({
		provider: v.literal("sanity"),
		sourceId: v.string(),
		sourceRevision: v.string(),
	}),
	v.object({
		provider: v.literal("editor_upload"),
		sourceId: v.string(),
	}),
);

export const privatePrintSourceMimeTypeValidator = v.union(
	v.literal("image/jpeg"),
	v.literal("image/png"),
);

/**
 * Paid-file types are intentionally closed. Supporting another format requires
 * an explicit contract change and download-path security review.
 */
export const paidDigitalFileMimeTypeValidator = v.literal("application/zip");

export const privatePrintSourceAssetValidator = v.object({
	siteUrl: v.string(),
	assetKey: v.string(),
	privateObjectKey: v.string(),
	status: privateCatalogAssetStatusValidator,
	originalFilename: v.string(),
	mimeType: privatePrintSourceMimeTypeValidator,
	sizeBytes: v.number(),
	widthPixels: v.number(),
	heightPixels: v.number(),
	sha256: v.string(),
	provenance: privateCatalogAssetProvenanceValidator,
	createdAt: v.number(),
	createdBy: v.string(),
	verifiedAt: v.number(),
	verifiedBy: v.string(),
});

export const paidDigitalFileAssetValidator = v.object({
	siteUrl: v.string(),
	assetKey: v.string(),
	privateObjectKey: v.string(),
	status: privateCatalogAssetStatusValidator,
	originalFilename: v.string(),
	mimeType: paidDigitalFileMimeTypeValidator,
	sizeBytes: v.number(),
	sha256: v.string(),
	version: v.optional(v.string()),
	provenance: privateCatalogAssetProvenanceValidator,
	createdAt: v.number(),
	createdBy: v.string(),
	verifiedAt: v.number(),
	verifiedBy: v.string(),
});

export type PrivateCatalogAssetProvenance = Infer<typeof privateCatalogAssetProvenanceValidator>;
export type PrivatePrintSourceAsset = Infer<typeof privatePrintSourceAssetValidator>;
export type PaidDigitalFileAsset = Infer<typeof paidDigitalFileAssetValidator>;

export const PRIVATE_CATALOG_ASSET_LIMITS = {
	siteUrl: 253,
	assetKey: 160,
	privateObjectKey: 1_024,
	originalFilename: 255,
	sourceId: 512,
	sourceRevision: 256,
	actorIdentity: 320,
	digitalFileVersion: 64,
	printSourceSizeBytes: 2_000_000_000,
	paidDigitalFileSizeBytes: 10_000_000_000,
	imageDimensionPixels: 100_000,
} as const;

const SITE_URL_PATTERN =
	/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ASSET_KEY_PATTERN = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

const COMMON_KEYS = new Set([
	"siteUrl",
	"assetKey",
	"privateObjectKey",
	"status",
	"originalFilename",
	"mimeType",
	"sizeBytes",
	"sha256",
	"provenance",
	"createdAt",
	"createdBy",
	"verifiedAt",
	"verifiedBy",
]);

const PRINT_SOURCE_KEYS = new Set([...COMMON_KEYS, "widthPixels", "heightPixels"]);

const PAID_DIGITAL_FILE_KEYS = new Set([...COMMON_KEYS, "version"]);

const SANITY_PROVENANCE_KEYS = new Set(["provider", "sourceId", "sourceRevision"]);

const EDITOR_UPLOAD_PROVENANCE_KEYS = new Set(["provider", "sourceId"]);

function assertOnlyKeys(value: object, allowed: ReadonlySet<string>, field: string) {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			throw catalogPrivateAssetValidationError(`${field} contains unsupported field ${key}`);
		}
	}
}

function requireBoundedText(value: string, maximum: number, field: string) {
	if (
		value.length === 0 ||
		value.length > maximum ||
		value !== value.trim() ||
		CONTROL_CHARACTER_PATTERN.test(value)
	) {
		throw catalogPrivateAssetValidationError(`${field} must be non-empty, trimmed, bounded text`);
	}
}

function requirePositiveSafeInteger(value: number, maximum: number, field: string) {
	if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
		throw catalogPrivateAssetValidationError(`${field} must be a bounded positive safe integer`);
	}
}

function requireTimestamp(value: number, field: string) {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw catalogPrivateAssetValidationError(
			`${field} must be a non-negative safe-integer timestamp`,
		);
	}
}

function validateSiteUrl(siteUrl: string) {
	if (!SITE_URL_PATTERN.test(siteUrl)) {
		throw catalogPrivateAssetValidationError(
			"Site URL must be a canonical lowercase hostname without a scheme or path",
		);
	}
}

function validateAssetKey(assetKey: string) {
	if (
		assetKey.length > PRIVATE_CATALOG_ASSET_LIMITS.assetKey ||
		!ASSET_KEY_PATTERN.test(assetKey)
	) {
		throw catalogPrivateAssetValidationError(
			"Private catalog asset key must be an opaque stable identifier",
		);
	}
}

function validateOriginalFilename(originalFilename: string) {
	requireBoundedText(
		originalFilename,
		PRIVATE_CATALOG_ASSET_LIMITS.originalFilename,
		"Original filename",
	);
	if (originalFilename.includes("/") || originalFilename.includes("\\")) {
		throw catalogPrivateAssetValidationError("Original filename cannot contain a path");
	}
}

function validateProvenance(provenance: PrivateCatalogAssetProvenance) {
	if (provenance.provider !== "sanity" && provenance.provider !== "editor_upload") {
		throw catalogPrivateAssetValidationError(
			"Private catalog asset provenance provider is unsupported",
		);
	}
	assertOnlyKeys(
		provenance,
		provenance.provider === "sanity" ? SANITY_PROVENANCE_KEYS : EDITOR_UPLOAD_PROVENANCE_KEYS,
		"Private catalog asset provenance",
	);
	requireBoundedText(provenance.sourceId, PRIVATE_CATALOG_ASSET_LIMITS.sourceId, "Source asset ID");
	if (provenance.provider === "sanity") {
		requireBoundedText(
			provenance.sourceRevision,
			PRIVATE_CATALOG_ASSET_LIMITS.sourceRevision,
			"Sanity source revision",
		);
	}
}

function expectedPrivateObjectKey(
	boundary: "print-sources" | "paid-digital-files",
	siteUrl: string,
	assetKey: string,
) {
	return `sites/${siteUrl}/catalog/${boundary}/${assetKey}/original`;
}

type CommonPrivateCatalogAsset = {
	siteUrl: string;
	assetKey: string;
	privateObjectKey: string;
	status: "verified";
	originalFilename: string;
	sizeBytes: number;
	sha256: string;
	provenance: PrivateCatalogAssetProvenance;
	createdAt: number;
	createdBy: string;
	verifiedAt: number;
	verifiedBy: string;
};

function validateCommonPrivateCatalogAsset(
	asset: CommonPrivateCatalogAsset,
	boundary: "print-sources" | "paid-digital-files",
	maximumSizeBytes: number,
) {
	validateSiteUrl(asset.siteUrl);
	validateAssetKey(asset.assetKey);
	if (
		asset.privateObjectKey.length > PRIVATE_CATALOG_ASSET_LIMITS.privateObjectKey ||
		asset.privateObjectKey !== expectedPrivateObjectKey(boundary, asset.siteUrl, asset.assetKey)
	) {
		throw catalogPrivateAssetValidationError(
			`Private object key must remain inside the tenant ${boundary} boundary`,
		);
	}
	if (asset.status !== "verified") {
		throw catalogPrivateAssetValidationError("Private catalog asset status must be verified");
	}
	validateOriginalFilename(asset.originalFilename);
	requirePositiveSafeInteger(asset.sizeBytes, maximumSizeBytes, "Asset byte size");
	if (!SHA_256_PATTERN.test(asset.sha256)) {
		throw catalogPrivateAssetValidationError(
			"Asset SHA-256 must be a canonical lowercase hexadecimal digest",
		);
	}
	validateProvenance(asset.provenance);
	requireTimestamp(asset.createdAt, "Asset created timestamp");
	requireBoundedText(
		asset.createdBy,
		PRIVATE_CATALOG_ASSET_LIMITS.actorIdentity,
		"Asset creator identity",
	);
	requireTimestamp(asset.verifiedAt, "Asset verification timestamp");
	requireBoundedText(
		asset.verifiedBy,
		PRIVATE_CATALOG_ASSET_LIMITS.actorIdentity,
		"Asset verifier identity",
	);
	if (asset.verifiedAt < asset.createdAt) {
		throw catalogPrivateAssetValidationError("Asset verification cannot predate asset creation");
	}
}

export function validatePrivatePrintSourceAsset(asset: PrivatePrintSourceAsset) {
	assertOnlyKeys(asset, PRINT_SOURCE_KEYS, "Private print-source asset");
	validateCommonPrivateCatalogAsset(
		asset,
		"print-sources",
		PRIVATE_CATALOG_ASSET_LIMITS.printSourceSizeBytes,
	);
	if (asset.mimeType !== "image/jpeg" && asset.mimeType !== "image/png") {
		throw catalogPrivateAssetValidationError("Private print source must be a JPEG or PNG image");
	}
	requirePositiveSafeInteger(
		asset.widthPixels,
		PRIVATE_CATALOG_ASSET_LIMITS.imageDimensionPixels,
		"Print-source width",
	);
	requirePositiveSafeInteger(
		asset.heightPixels,
		PRIVATE_CATALOG_ASSET_LIMITS.imageDimensionPixels,
		"Print-source height",
	);
}

export function validatePaidDigitalFileAsset(asset: PaidDigitalFileAsset) {
	assertOnlyKeys(asset, PAID_DIGITAL_FILE_KEYS, "Paid digital-file asset");
	validateCommonPrivateCatalogAsset(
		asset,
		"paid-digital-files",
		PRIVATE_CATALOG_ASSET_LIMITS.paidDigitalFileSizeBytes,
	);
	if (asset.mimeType !== "application/zip") {
		throw catalogPrivateAssetValidationError(
			"Paid digital file must use an explicitly supported safe MIME type",
		);
	}
	if (!asset.originalFilename.toLowerCase().endsWith(".zip")) {
		throw catalogPrivateAssetValidationError("Paid ZIP filename must use the .zip extension");
	}
	if (asset.version !== undefined) {
		requireBoundedText(
			asset.version,
			PRIVATE_CATALOG_ASSET_LIMITS.digitalFileVersion,
			"Paid digital-file version",
		);
	}
}

export type EditorSafePrivatePrintSourceAsset = {
	kind: "print_source";
	assetId: Id<"catalogPrintSourceAssets">;
	status: "verified";
	originalFilename: string;
	mimeType: "image/jpeg" | "image/png";
	sizeBytes: number;
	widthPixels: number;
	heightPixels: number;
	createdAt: number;
};

export type EditorSafePaidDigitalFileAsset = {
	kind: "paid_digital_file";
	assetId: Id<"catalogDigitalFileAssets">;
	status: "verified";
	originalFilename: string;
	mimeType: "application/zip";
	sizeBytes: number;
	version?: string;
	createdAt: number;
};

/** Metadata only: this projection cannot locate, upload, or grant the object. */
export function toEditorSafePrivatePrintSourceAsset(
	asset: PrivatePrintSourceAsset & { _id: Id<"catalogPrintSourceAssets"> },
): EditorSafePrivatePrintSourceAsset {
	const contract: PrivatePrintSourceAsset = {
		siteUrl: asset.siteUrl,
		assetKey: asset.assetKey,
		privateObjectKey: asset.privateObjectKey,
		status: asset.status,
		originalFilename: asset.originalFilename,
		mimeType: asset.mimeType,
		sizeBytes: asset.sizeBytes,
		widthPixels: asset.widthPixels,
		heightPixels: asset.heightPixels,
		sha256: asset.sha256,
		provenance: asset.provenance,
		createdAt: asset.createdAt,
		createdBy: asset.createdBy,
		verifiedAt: asset.verifiedAt,
		verifiedBy: asset.verifiedBy,
	};
	validatePrivatePrintSourceAsset(contract);
	return {
		kind: "print_source",
		assetId: asset._id,
		status: asset.status,
		originalFilename: asset.originalFilename,
		mimeType: asset.mimeType,
		sizeBytes: asset.sizeBytes,
		widthPixels: asset.widthPixels,
		heightPixels: asset.heightPixels,
		createdAt: asset.createdAt,
	};
}

/** Metadata only: this projection cannot locate, upload, or grant the object. */
export function toEditorSafePaidDigitalFileAsset(
	asset: PaidDigitalFileAsset & { _id: Id<"catalogDigitalFileAssets"> },
): EditorSafePaidDigitalFileAsset {
	const contract: PaidDigitalFileAsset = {
		siteUrl: asset.siteUrl,
		assetKey: asset.assetKey,
		privateObjectKey: asset.privateObjectKey,
		status: asset.status,
		originalFilename: asset.originalFilename,
		mimeType: asset.mimeType,
		sizeBytes: asset.sizeBytes,
		sha256: asset.sha256,
		...(asset.version === undefined ? {} : { version: asset.version }),
		provenance: asset.provenance,
		createdAt: asset.createdAt,
		createdBy: asset.createdBy,
		verifiedAt: asset.verifiedAt,
		verifiedBy: asset.verifiedBy,
	};
	validatePaidDigitalFileAsset(contract);
	return {
		kind: "paid_digital_file",
		assetId: asset._id,
		status: asset.status,
		originalFilename: asset.originalFilename,
		mimeType: asset.mimeType,
		sizeBytes: asset.sizeBytes,
		...(asset.version === undefined ? {} : { version: asset.version }),
		createdAt: asset.createdAt,
	};
}
