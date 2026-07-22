import type { Infer } from "convex/values";
import { v } from "convex/values";
import {
	paidDigitalFileMimeTypeValidator,
	privateCatalogAssetProvenanceValidator,
	privatePrintSourceMimeTypeValidator,
} from "./catalogPrivateAssetValidators";

export const CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION = 1 as const;
export const CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION = 2 as const;
export type CatalogPrivateAssetReceiptSetVersion =
	| typeof CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION
	| typeof CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION;

const privatePrintSourceFactsValidator = v.object({
	kind: v.literal("print_source"),
	assetKey: v.string(),
	privateObjectKey: v.string(),
	originalFilename: v.string(),
	mimeType: privatePrintSourceMimeTypeValidator,
	sizeBytes: v.number(),
	widthPixels: v.number(),
	heightPixels: v.number(),
	sha256: v.string(),
	provenance: privateCatalogAssetProvenanceValidator,
});

const paidDigitalFileFactsValidator = v.object({
	kind: v.literal("paid_digital_file"),
	assetKey: v.string(),
	privateObjectKey: v.string(),
	originalFilename: v.string(),
	mimeType: paidDigitalFileMimeTypeValidator,
	sizeBytes: v.number(),
	sha256: v.string(),
	version: v.optional(v.string()),
	provenance: privateCatalogAssetProvenanceValidator,
});

export const catalogPrivateAssetFactsValidator = v.union(
	privatePrintSourceFactsValidator,
	paidDigitalFileFactsValidator,
);

const printStorageReceiptValidator = v.object({
	facts: privatePrintSourceFactsValidator,
	uploadedAt: v.string(),
	etag: v.string(),
});

const paidStorageReceiptValidator = v.object({
	facts: paidDigitalFileFactsValidator,
	uploadedAt: v.string(),
	etag: v.string(),
});

const storageReceiptSetFields = {
	receiptSetId: v.string(),
	siteUrl: v.string(),
	receipts: v.array(v.union(printStorageReceiptValidator, paidStorageReceiptValidator)),
};

const catalogPrivateStorageReceiptSetV1Validator = v.object({
	schemaVersion: v.literal(CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION),
	...storageReceiptSetFields,
});

const catalogPrivateStorageReceiptSetV2Validator = v.object({
	schemaVersion: v.literal(CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION),
	...storageReceiptSetFields,
});

export const catalogPrivateStorageReceiptSetValidator = v.union(
	catalogPrivateStorageReceiptSetV1Validator,
	catalogPrivateStorageReceiptSetV2Validator,
);

const printInspectionReceiptV1Validator = v.object({
	facts: privatePrintSourceFactsValidator,
	inspection: v.object({ method: v.literal("decoded_image_v1") }),
});

const printInspectionReceiptV2Validator = v.object({
	facts: privatePrintSourceFactsValidator,
	inspection: v.object({
		method: v.literal("sharp_libvips_full_raster_v1"),
		decodedFormat: v.union(v.literal("jpeg"), v.literal("png")),
		decodedWidthPixels: v.number(),
		decodedHeightPixels: v.number(),
		decodedChannels: v.union(v.literal(1), v.literal(2), v.literal(3), v.literal(4)),
		decodedPageCount: v.literal(1),
		decodedDepth: v.literal("uchar"),
		decodedPixelCount: v.number(),
		decodedByteCount: v.number(),
		rasterSha256: v.string(),
		sharpVersion: v.string(),
		libvipsVersion: v.string(),
	}),
});

const paidInspectionReceiptValidator = v.object({
	facts: paidDigitalFileFactsValidator,
	inspection: v.object({
		method: v.literal("safe_zip_v1"),
		entryCount: v.number(),
		totalUncompressedBytes: v.number(),
		maximumEntryCompressionRatio: v.number(),
		encryptedEntryCount: v.number(),
		unsafePathCount: v.number(),
		duplicatePathCount: v.number(),
	}),
});

const inspectionReceiptSetIdentityFields = {
	receiptSetId: v.string(),
	siteUrl: v.string(),
};

const catalogPrivateInspectionReceiptSetV1Validator = v.object({
	schemaVersion: v.literal(CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION),
	...inspectionReceiptSetIdentityFields,
	receipts: v.array(v.union(
		printInspectionReceiptV1Validator,
		paidInspectionReceiptValidator,
	)),
});

const catalogPrivateInspectionReceiptSetV2Validator = v.object({
	schemaVersion: v.literal(CATALOG_PRIVATE_ASSET_RECEIPT_SET_V2_VERSION),
	...inspectionReceiptSetIdentityFields,
	receipts: v.array(v.union(
		printInspectionReceiptV2Validator,
		paidInspectionReceiptValidator,
	)),
});

export const catalogPrivateInspectionReceiptSetValidator = v.union(
	catalogPrivateInspectionReceiptSetV1Validator,
	catalogPrivateInspectionReceiptSetV2Validator,
);

export const catalogPrivateAssetTargetMappingValidator = v.union(
	v.object({
		kind: v.literal("print_source"),
		assetKey: v.string(),
		assetId: v.id("catalogPrintSourceAssets"),
	}),
	v.object({
		kind: v.literal("paid_digital_file"),
		assetKey: v.string(),
		assetId: v.id("catalogDigitalFileAssets"),
	}),
);

const coordinationIdentityFields = {
	siteUrl: v.string(),
	receiptSetId: v.string(),
	assetSetChecksum: v.string(),
	createdAt: v.number(),
	updatedAt: v.number(),
};

export const catalogPrivateAssetReceiptCoordinationValidator = v.union(
	v.object({
		...coordinationIdentityFields,
		status: v.literal("pending_inspection"),
		storageReceiptChecksum: v.string(),
		storageReceivedAt: v.number(),
		storageReceiptSet: catalogPrivateStorageReceiptSetV1Validator,
	}),
	v.object({
		...coordinationIdentityFields,
		status: v.literal("pending_inspection"),
		storageReceiptChecksum: v.string(),
		storageReceivedAt: v.number(),
		storageReceiptSet: catalogPrivateStorageReceiptSetV2Validator,
	}),
	v.object({
		...coordinationIdentityFields,
		status: v.literal("pending_storage"),
		inspectionReceiptChecksum: v.string(),
		inspectionReceivedAt: v.number(),
		inspectionReceiptSet: catalogPrivateInspectionReceiptSetV1Validator,
	}),
	v.object({
		...coordinationIdentityFields,
		status: v.literal("pending_storage"),
		inspectionReceiptChecksum: v.string(),
		inspectionReceivedAt: v.number(),
		inspectionReceiptSet: catalogPrivateInspectionReceiptSetV2Validator,
	}),
	v.object({
		...coordinationIdentityFields,
		status: v.literal("verified"),
		storageReceiptChecksum: v.string(),
		inspectionReceiptChecksum: v.string(),
		storageReceivedAt: v.number(),
		inspectionReceivedAt: v.number(),
		verifiedAt: v.number(),
		storageReceiptSet: catalogPrivateStorageReceiptSetV1Validator,
		inspectionReceiptSet: catalogPrivateInspectionReceiptSetV1Validator,
		targets: v.array(catalogPrivateAssetTargetMappingValidator),
	}),
	v.object({
		...coordinationIdentityFields,
		status: v.literal("verified"),
		storageReceiptChecksum: v.string(),
		inspectionReceiptChecksum: v.string(),
		storageReceivedAt: v.number(),
		inspectionReceivedAt: v.number(),
		verifiedAt: v.number(),
		storageReceiptSet: catalogPrivateStorageReceiptSetV2Validator,
		inspectionReceiptSet: catalogPrivateInspectionReceiptSetV2Validator,
		targets: v.array(catalogPrivateAssetTargetMappingValidator),
	}),
);

export type CatalogPrivateAssetFacts = Infer<typeof catalogPrivateAssetFactsValidator>;
export type CatalogPrivateStorageReceiptSet = Infer<
	typeof catalogPrivateStorageReceiptSetValidator
>;
export type CatalogPrivateInspectionReceiptSet = Infer<
	typeof catalogPrivateInspectionReceiptSetValidator
>;
export type CatalogPrivateAssetTargetMapping = Infer<
	typeof catalogPrivateAssetTargetMappingValidator
>;
