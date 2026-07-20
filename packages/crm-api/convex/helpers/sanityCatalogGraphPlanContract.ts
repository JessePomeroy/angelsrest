import type { Infer } from "convex/values";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { catalogProductGraphV2DraftValidator } from "./catalogProductGraphValidators";

export const sanityCatalogWebMediaTargetMappingValidator = v.object({
	sourceAssetRef: v.string(),
	mediaAssetId: v.id("mediaAssets"),
});

export const sanityCatalogPrintSourceTargetMappingValidator = v.object({
	sourceAssetRef: v.string(),
	printSourceAssetId: v.id("catalogPrintSourceAssets"),
});

export const sanityCatalogPaidFileTargetMappingValidator = v.object({
	sourceFileRef: v.string(),
	digitalFileAssetId: v.id("catalogDigitalFileAssets"),
});

const sourceTypeValidator = v.union(
	v.literal("lumaProductV2"),
	v.literal("lumaPrintSetV2"),
	v.literal("product"),
);

const sourceRelationsValidator = v.object({
	webMedia: v.array(v.object({
		key: v.string(),
		sourceAssetRef: v.string(),
	})),
	printSources: v.array(v.object({
		key: v.string(),
		sourceAssetRef: v.string(),
	})),
	paidFile: v.optional(v.object({ sourceFileRef: v.string() })),
});

const plannedProductValidator = v.object({
	sourceId: v.string(),
	sourceRevision: v.string(),
	sourceCreatedAt: v.string(),
	sourceUpdatedAt: v.string(),
	sourceType: sourceTypeValidator,
	productKey: v.string(),
	sourceRelations: sourceRelationsValidator,
	draft: catalogProductGraphV2DraftValidator,
	graphChecksum: v.string(),
});

export const sanityCatalogV2GraphPlanPayloadValidator = v.object({
	version: v.literal(1),
	graphVersion: v.literal(2),
	sourceManifestVersion: v.literal(1),
	assetMappings: v.object({
		webMedia: v.array(sanityCatalogWebMediaTargetMappingValidator),
		printSources: v.array(sanityCatalogPrintSourceTargetMappingValidator),
		paidFiles: v.array(sanityCatalogPaidFileTargetMappingValidator),
	}),
	products: v.array(plannedProductValidator),
});

export const sanityCatalogV2GraphPlanValidator = v.object({
	...sanityCatalogV2GraphPlanPayloadValidator.fields,
	graphPlanChecksum: v.string(),
});

export type SanityCatalogV2GraphPlan = Infer<
	typeof sanityCatalogV2GraphPlanValidator
>;
export type SanityCatalogV2GraphPlanPayload = Infer<
	typeof sanityCatalogV2GraphPlanPayloadValidator
>;

export type SanityCatalogV2TargetIdMaps = {
	webMedia: ReadonlyArray<{
		sourceAssetRef: string;
		mediaAssetId: Id<"mediaAssets">;
	}>;
	printSources: ReadonlyArray<{
		sourceAssetRef: string;
		printSourceAssetId: Id<"catalogPrintSourceAssets">;
	}>;
	paidFiles: ReadonlyArray<{
		sourceFileRef: string;
		digitalFileAssetId: Id<"catalogDigitalFileAssets">;
	}>;
};

export const SANITY_CATALOG_SOURCE_TYPE_BY_KIND = {
	print: "lumaProductV2",
	print_set: "lumaPrintSetV2",
	postcard: "product",
	tapestry: "product",
	digital_download: "product",
	merchandise: "product",
} as const;
