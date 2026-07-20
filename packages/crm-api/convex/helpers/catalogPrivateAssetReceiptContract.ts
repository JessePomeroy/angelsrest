import type { Infer } from "convex/values";
import { v } from "convex/values";
import {
	paidDigitalFileMimeTypeValidator,
	privateCatalogAssetProvenanceValidator,
	privatePrintSourceMimeTypeValidator,
} from "./catalogPrivateAssetValidators";

export const CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION = 1 as const;

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

export const catalogPrivateStorageReceiptSetValidator = v.object({
	schemaVersion: v.literal(CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION),
	receiptSetId: v.string(),
	siteUrl: v.string(),
	receipts: v.array(v.union(printStorageReceiptValidator, paidStorageReceiptValidator)),
});

const printInspectionReceiptValidator = v.object({
	facts: privatePrintSourceFactsValidator,
	inspection: v.object({
		method: v.literal("decoded_image_v1"),
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

export const catalogPrivateInspectionReceiptSetValidator = v.object({
	schemaVersion: v.literal(CATALOG_PRIVATE_ASSET_RECEIPT_SET_VERSION),
	receiptSetId: v.string(),
	siteUrl: v.string(),
	receipts: v.array(v.union(printInspectionReceiptValidator, paidInspectionReceiptValidator)),
});

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
		storageReceiptSet: catalogPrivateStorageReceiptSetValidator,
	}),
	v.object({
		...coordinationIdentityFields,
		status: v.literal("pending_storage"),
		inspectionReceiptChecksum: v.string(),
		inspectionReceivedAt: v.number(),
		inspectionReceiptSet: catalogPrivateInspectionReceiptSetValidator,
	}),
	v.object({
		...coordinationIdentityFields,
		status: v.literal("verified"),
		storageReceiptChecksum: v.string(),
		inspectionReceiptChecksum: v.string(),
		storageReceivedAt: v.number(),
		inspectionReceivedAt: v.number(),
		verifiedAt: v.number(),
		storageReceiptSet: catalogPrivateStorageReceiptSetValidator,
		inspectionReceiptSet: catalogPrivateInspectionReceiptSetValidator,
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
