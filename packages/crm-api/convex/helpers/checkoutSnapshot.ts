import { v } from "convex/values";
import { catalogProductKindValidator } from "./catalogProductValidators";

const nullableKey = v.union(v.string(), v.null());

/** Immutable provider-neutral routing identity captured when checkout resolves. */
export const checkoutSnapshotValidator = v.object({
	schemaVersion: v.literal(1),
	catalogProvider: v.union(v.literal("sanity"), v.literal("convex")),
	items: v.array(
		v.object({
			productKey: v.string(),
			revisionId: v.string(),
			productKind: catalogProductKindValidator,
			variantKey: nullableKey,
			materialOptionKey: v.optional(nullableKey),
			sizeOptionKey: v.optional(nullableKey),
			borderOptionKey: v.optional(nullableKey),
			frameOptionKey: v.optional(nullableKey),
		}),
	),
});
