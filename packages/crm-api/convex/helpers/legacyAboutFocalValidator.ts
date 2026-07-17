import { v } from "convex/values";
import { mediaFocalPointValidator } from "./mediaValidators";

const legacyAboutPortraitPlacementValidator = v.object({
	key: v.string(),
	assetId: v.id("mediaAssets"),
	altText: v.optional(v.string()),
	decorative: v.boolean(),
	focalPoint: v.optional(mediaFocalPointValidator),
});

/**
 * Temporary storage-only compatibility for historical About revisions.
 * Public mutations continue to use the strict focal-free validator.
 */
export const legacyAboutPageDraftPayloadValidator = v.object({
	heading: v.optional(v.string()),
	displayName: v.optional(v.string()),
	role: v.optional(v.string()),
	introduction: v.optional(v.string()),
	biography: v.optional(v.string()),
	portraits: v.optional(v.array(legacyAboutPortraitPlacementValidator)),
	sections: v.optional(
		v.array(
			v.object({
				key: v.string(),
				title: v.optional(v.string()),
				items: v.array(v.string()),
			}),
		),
	),
	highlights: v.optional(
		v.array(
			v.object({
				key: v.string(),
				label: v.optional(v.string()),
				value: v.optional(v.string()),
			}),
		),
	),
	seoDescription: v.optional(v.string()),
	seoImageAssetId: v.optional(v.id("mediaAssets")),
});
