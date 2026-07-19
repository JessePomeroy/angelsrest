import type { Infer } from "convex/values";
import { v } from "convex/values";

export const catalogProductKindValidator = v.union(
	v.literal("print"),
	v.literal("print_set"),
	v.literal("postcard"),
	v.literal("tapestry"),
	v.literal("digital_download"),
	v.literal("merchandise"),
);

export type CatalogProductKind = Infer<typeof catalogProductKindValidator>;

export const catalogFulfillmentModeValidator = v.union(
	v.literal("production_partner"),
	v.literal("merchant_fulfilled"),
	v.literal("digital_delivery"),
);

export type CatalogFulfillmentMode = Infer<typeof catalogFulfillmentModeValidator>;

export const catalogSaleAvailabilityValidator = v.union(
	v.literal("available"),
	v.literal("unavailable"),
);

export const catalogVariantStatusValidator = v.union(
	v.literal("enabled"),
	v.literal("disabled"),
);

export const catalogRevisionSourceValidator = v.union(
	v.literal("admin"),
	v.literal("sanityImport"),
	v.literal("restore"),
);

export const catalogProductVariantDraftValidator = v.object({
	key: v.string(),
	materialOptionKey: v.optional(v.string()),
	sizeOptionKey: v.optional(v.string()),
	retailPriceCents: v.optional(v.number()),
	status: catalogVariantStatusValidator,
});

export const catalogProductDraftValidator = v.object({
	title: v.optional(v.string()),
	slug: v.optional(v.string()),
	description: v.optional(v.string()),
	fulfillmentMode: catalogFulfillmentModeValidator,
	saleAvailability: catalogSaleAvailabilityValidator,
	borderOptionsEnabled: v.boolean(),
	frameOptionsEnabled: v.boolean(),
	framePriceMultiplierBasisPoints: v.number(),
	variants: v.array(catalogProductVariantDraftValidator),
});

export type CatalogProductDraft = Infer<typeof catalogProductDraftValidator>;
export type CatalogProductVariantDraft = Infer<
	typeof catalogProductVariantDraftValidator
>;

export const CATALOG_PRODUCT_LIMITS = {
	productsPerKind: 500,
	variantsPerRevision: 100,
	productKey: 120,
	title: 160,
	slug: 96,
	description: 5_000,
	variantKey: 120,
	optionKey: 120,
	retailPriceCents: 100_000_000,
	framePriceMultiplierBasisPoints: 1_000_000,
} as const;

const IDENTITY_KEY_PATTERN = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/;
const OPTION_KEY_PATTERN = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertMaximum(value: string | undefined, maximum: number, field: string) {
	if (value !== undefined && value.length > maximum) {
		throw new Error(`${field} must be ${maximum} characters or fewer`);
	}
}

function assertOptionalOptionKey(value: string | undefined, field: string) {
	assertMaximum(value, CATALOG_PRODUCT_LIMITS.optionKey, field);
	if (value !== undefined && !OPTION_KEY_PATTERN.test(value)) {
		throw new Error(`${field} must be a stable lowercase option key`);
	}
}

export function validateCatalogProductKey(productKey: string) {
	if (
		!productKey
		|| productKey.length > CATALOG_PRODUCT_LIMITS.productKey
		|| !IDENTITY_KEY_PATTERN.test(productKey)
	) {
		throw new Error("Product key must contain only stable letters, numbers, dots, colons, underscores, or hyphens");
	}
}

export function canonicalCatalogSlug(slug: string | undefined) {
	return slug || undefined;
}

export function validateCatalogProductDraft(draft: CatalogProductDraft) {
	assertMaximum(draft.title, CATALOG_PRODUCT_LIMITS.title, "Product title");
	assertMaximum(draft.description, CATALOG_PRODUCT_LIMITS.description, "Product description");
	assertMaximum(draft.slug, CATALOG_PRODUCT_LIMITS.slug, "Product slug");
	if (draft.slug !== undefined && !SLUG_PATTERN.test(draft.slug)) {
		throw new Error("Product slug must contain only lowercase letters, numbers, and single hyphens");
	}
	if (draft.fulfillmentMode === "digital_delivery") {
		throw new Error("A print cannot use digital delivery fulfillment");
	}
	if (
		!Number.isSafeInteger(draft.framePriceMultiplierBasisPoints)
		|| draft.framePriceMultiplierBasisPoints < 0
		|| draft.framePriceMultiplierBasisPoints
			> CATALOG_PRODUCT_LIMITS.framePriceMultiplierBasisPoints
	) {
		throw new Error("Frame price multiplier basis points must be a bounded non-negative integer");
	}
	if (draft.variants.length > CATALOG_PRODUCT_LIMITS.variantsPerRevision) {
		throw new Error(
			`A print revision cannot exceed ${CATALOG_PRODUCT_LIMITS.variantsPerRevision} variants`,
		);
	}

	const variantKeys = new Set<string>();
	const optionCombinations = new Set<string>();
	for (const [index, variant] of draft.variants.entries()) {
		if (
			!variant.key
			|| variant.key.length > CATALOG_PRODUCT_LIMITS.variantKey
			|| !IDENTITY_KEY_PATTERN.test(variant.key)
			|| variantKeys.has(variant.key)
		) {
			throw new Error("Print variant keys must be unique stable identifiers");
		}
		variantKeys.add(variant.key);
		assertOptionalOptionKey(variant.materialOptionKey, `Variant ${index + 1} material option`);
		assertOptionalOptionKey(variant.sizeOptionKey, `Variant ${index + 1} size option`);

		if (variant.materialOptionKey !== undefined && variant.sizeOptionKey !== undefined) {
			const combination = `${variant.materialOptionKey}\u0000${variant.sizeOptionKey}`;
			if (optionCombinations.has(combination)) {
				throw new Error("A material and size combination can appear only once per revision");
			}
			optionCombinations.add(combination);
		}

		if (
			variant.retailPriceCents !== undefined
			&& (
				!Number.isSafeInteger(variant.retailPriceCents)
				|| variant.retailPriceCents < 0
				|| variant.retailPriceCents > CATALOG_PRODUCT_LIMITS.retailPriceCents
			)
		) {
			throw new Error("Retail price cents must be a bounded non-negative safe integer");
		}
	}
}

export function serializeCatalogProductDraft(draft: CatalogProductDraft) {
	return `catalog-print:v1:${JSON.stringify({
		productKind: "print",
		currency: "usd",
		title: draft.title ?? null,
		slug: draft.slug ?? null,
		description: draft.description ?? null,
		fulfillmentMode: draft.fulfillmentMode,
		saleAvailability: draft.saleAvailability,
		borderOptionsEnabled: draft.borderOptionsEnabled,
		frameOptionsEnabled: draft.frameOptionsEnabled,
		framePriceMultiplierBasisPoints: draft.framePriceMultiplierBasisPoints,
		variants: draft.variants.map((variant) => ({
			key: variant.key,
			materialOptionKey: variant.materialOptionKey ?? null,
			sizeOptionKey: variant.sizeOptionKey ?? null,
			retailPriceCents: variant.retailPriceCents ?? null,
			status: variant.status,
		})),
	})}`;
}
