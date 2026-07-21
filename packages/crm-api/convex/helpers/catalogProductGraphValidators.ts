import type { Infer } from "convex/values";
import { v } from "convex/values";
import { PRIVATE_CATALOG_ASSET_LIMITS } from "./catalogPrivateAssetValidators";
import { CATALOG_PRODUCT_LIMITS } from "./catalogProductValidators";

const catalogGraphV2VariantValidator = v.object({
	key: v.string(),
	order: v.number(),
	materialOptionKey: v.optional(v.string()),
	sizeOptionKey: v.optional(v.string()),
	retailPriceCents: v.optional(v.number()),
	status: v.union(v.literal("enabled"), v.literal("disabled")),
});

export const catalogGraphV2WebMediaRoleValidator = v.union(
	v.literal("primary"),
	v.literal("cover"),
	v.literal("gallery"),
	v.literal("set_member"),
	v.literal("social_share"),
);

const catalogGraphV2WebMediaPlacementValidator = v.object({
	key: v.string(),
	order: v.number(),
	role: catalogGraphV2WebMediaRoleValidator,
	assetId: v.id("mediaAssets"),
	altText: v.optional(v.string()),
});

const catalogGraphV2ShopPlacementValidator = v.object({
	featured: v.boolean(),
	orderRank: v.optional(v.string()),
});

export const catalogGraphV2PrintOptionsValidator = v.object({
	borderOptionsEnabled: v.boolean(),
	frameOptionsEnabled: v.boolean(),
	framePriceMultiplierBasisPoints: v.number(),
});

const catalogGraphV2PrintSourceValidator = v.object({
	key: v.string(),
	order: v.number(),
	assetId: v.id("catalogPrintSourceAssets"),
});

const catalogGraphV2PrintSetMemberValidator = v.object({
	key: v.string(),
	order: v.number(),
	mediaPlacementKey: v.string(),
	printSourceKey: v.string(),
});

const catalogGraphV2PaidFileValidator = v.object({
	key: v.string(),
	assetId: v.id("catalogDigitalFileAssets"),
	version: v.optional(v.string()),
});

export const catalogGraphV2PrivateAssetReplacementValidator = v.union(
	v.object({
		kind: v.literal("print_source"),
		relationKey: v.string(),
		assetId: v.id("catalogPrintSourceAssets"),
	}),
	v.object({
		kind: v.literal("paid_digital_file"),
		relationKey: v.string(),
		assetId: v.id("catalogDigitalFileAssets"),
	}),
);

const commonGraphFields = {
	schemaVersion: v.literal(2),
	title: v.optional(v.string()),
	slug: v.optional(v.string()),
	description: v.optional(v.string()),
	seoDescription: v.optional(v.string()),
	currency: v.literal("usd"),
	saleAvailability: v.union(v.literal("available"), v.literal("unavailable")),
	shopPlacement: catalogGraphV2ShopPlacementValidator,
	variants: v.array(catalogGraphV2VariantValidator),
	webMedia: v.array(catalogGraphV2WebMediaPlacementValidator),
};

const printFamilyFields = {
	...commonGraphFields,
	fulfillmentMode: v.union(
		v.literal("production_partner"),
		v.literal("merchant_fulfilled"),
	),
	printOptions: catalogGraphV2PrintOptionsValidator,
	printSources: v.array(catalogGraphV2PrintSourceValidator),
};

const fixedPricePhysicalFields = {
	...commonGraphFields,
	fulfillmentMode: v.literal("merchant_fulfilled"),
};

export const catalogProductGraphV2DraftValidator = v.union(
	v.object({
		...printFamilyFields,
		productKind: v.literal("print"),
	}),
	v.object({
		...printFamilyFields,
		productKind: v.literal("print_set"),
		setMembers: v.array(catalogGraphV2PrintSetMemberValidator),
	}),
	v.object({
		...fixedPricePhysicalFields,
		productKind: v.literal("postcard"),
	}),
	v.object({
		...fixedPricePhysicalFields,
		productKind: v.literal("tapestry"),
	}),
	v.object({
		...commonGraphFields,
		productKind: v.literal("digital_download"),
		fulfillmentMode: v.literal("digital_delivery"),
		paidFile: v.optional(catalogGraphV2PaidFileValidator),
	}),
	v.object({
		...fixedPricePhysicalFields,
		productKind: v.literal("merchandise"),
	}),
);

export type CatalogProductGraphV2Draft = Infer<typeof catalogProductGraphV2DraftValidator>;
export type CatalogGraphV2Variant = Infer<typeof catalogGraphV2VariantValidator>;
export type CatalogGraphV2PrivateAssetReplacement = Infer<
	typeof catalogGraphV2PrivateAssetReplacementValidator
>;

export const CATALOG_PRODUCT_GRAPH_V2_LIMITS = {
	...CATALOG_PRODUCT_LIMITS,
	seoDescription: 320,
	orderRank: 120,
	relationKey: 120,
	assetId: 120,
	altText: 1_000,
	paidFileVersion: PRIVATE_CATALOG_ASSET_LIMITS.digitalFileVersion,
	webMediaPlacements: 50,
	printSources: 20,
	printSetMembers: 20,
	totalChildRows: 200,
} as const;

const STABLE_KEY_PATTERN = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/;
const OPTION_KEY_PATTERN = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertOnlyKeys(value: object, allowed: readonly string[], label: string) {
	const extras = Object.keys(value).filter((key) => !allowed.includes(key));
	if (extras.length > 0) {
		throw new Error(`${label} contains unsupported or private fields: ${extras.join(", ")}`);
	}
}

function assertOptionalText(
	value: string | undefined,
	maximum: number,
	label: string,
) {
	if (value === undefined) return;
	if (
		typeof value !== "string"
		|| !value
		|| value !== value.trim()
		|| value.length > maximum
	) {
		throw new Error(`${label} must be non-empty, trimmed, and ${maximum} characters or fewer`);
	}
}

function assertStableKey(value: string, maximum: number, label: string) {
	if (
		typeof value !== "string"
		|| !value
		|| value.length > maximum
		|| !STABLE_KEY_PATTERN.test(value)
	) {
		throw new Error(`${label} must be an opaque stable relation key`);
	}
}

function assertOptionKey(value: string | undefined, label: string) {
	if (value === undefined) return;
	if (
		typeof value !== "string"
		|| !value
		|| value.length > CATALOG_PRODUCT_GRAPH_V2_LIMITS.optionKey
		|| !OPTION_KEY_PATTERN.test(value)
	) throw new Error(`${label} must be a stable lowercase option key`);
}

function assertContiguous<T extends { order: number }>(values: T[], label: string) {
	for (const [index, value] of values.entries()) {
		if (!Number.isSafeInteger(value.order) || value.order !== index) {
			throw new Error(`${label} order must be contiguous and match array order`);
		}
	}
}

function assertUnique(values: readonly string[], label: string) {
	if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`);
}

function validateVariants(draft: CatalogProductGraphV2Draft) {
	if (
		draft.variants.length < 1
		|| draft.variants.length > CATALOG_PRODUCT_GRAPH_V2_LIMITS.variantsPerRevision
	) throw new Error("Catalog V2 drafts need a bounded non-empty variant list");
	assertContiguous(draft.variants, "Variant");
	assertUnique(draft.variants.map(({ key }) => key), "Variant keys");
	const optionCombinations: string[] = [];
	for (const [index, variant] of draft.variants.entries()) {
		assertOnlyKeys(variant, [
			"key",
			"order",
			"materialOptionKey",
			"sizeOptionKey",
			"retailPriceCents",
			"status",
		], `Variant ${index + 1}`);
		assertStableKey(variant.key, CATALOG_PRODUCT_GRAPH_V2_LIMITS.variantKey, "Variant key");
		assertOptionKey(variant.materialOptionKey, `Variant ${index + 1} material option`);
		assertOptionKey(variant.sizeOptionKey, `Variant ${index + 1} size option`);
		if (variant.status !== "enabled" && variant.status !== "disabled") {
			throw new Error("Variant status must be enabled or disabled");
		}
		if (variant.materialOptionKey !== undefined && variant.sizeOptionKey !== undefined) {
			optionCombinations.push(`${variant.materialOptionKey}\u0000${variant.sizeOptionKey}`);
		}
		if (
			variant.retailPriceCents !== undefined
			&& (!Number.isSafeInteger(variant.retailPriceCents)
				|| variant.retailPriceCents <= 0
				|| variant.retailPriceCents > CATALOG_PRODUCT_GRAPH_V2_LIMITS.retailPriceCents)
		) throw new Error("Retail price cents must be a bounded positive safe integer");
	}
	assertUnique(optionCombinations, "Material and size combinations");
}

function validateFixedPriceVariant(draft: CatalogProductGraphV2Draft) {
	const [variant] = draft.variants;
	if (
		draft.variants.length !== 1
		|| variant?.key !== "default"
		|| variant.order !== 0
		|| variant.materialOptionKey !== undefined
		|| variant.sizeOptionKey !== undefined
		|| variant.retailPriceCents === undefined
	) throw new Error("Fixed-price products require exactly one priced default variant");
}

function validateWebMedia(draft: CatalogProductGraphV2Draft) {
	if (draft.webMedia.length > CATALOG_PRODUCT_GRAPH_V2_LIMITS.webMediaPlacements) {
		throw new Error("Catalog V2 web-media placement limit exceeded");
	}
	assertUnique(draft.webMedia.map(({ key }) => key), "Web-media placement keys");
	const allowedRoles = draft.productKind === "print"
		? new Set(["primary", "gallery", "social_share"])
		: draft.productKind === "print_set"
		? new Set(["cover", "set_member", "social_share"])
		: new Set(["gallery", "social_share"]);
	const byRole = new Map<string, typeof draft.webMedia>();
	for (const [index, placement] of draft.webMedia.entries()) {
		assertOnlyKeys(
			placement,
			["key", "order", "role", "assetId", "altText"],
			`Web-media placement ${index + 1}`,
		);
		assertStableKey(
			placement.key,
			CATALOG_PRODUCT_GRAPH_V2_LIMITS.relationKey,
			"Web-media placement key",
		);
		assertStableKey(
			placement.assetId,
			CATALOG_PRODUCT_GRAPH_V2_LIMITS.assetId,
			"Web-media asset ID",
		);
		assertOptionalText(
			placement.altText,
			CATALOG_PRODUCT_GRAPH_V2_LIMITS.altText,
			"Web-media alt text",
		);
		if (!allowedRoles.has(placement.role)) {
			throw new Error(`${placement.role} is not a valid ${draft.productKind} web-media role`);
		}
		const rolePlacements = byRole.get(placement.role) ?? [];
		rolePlacements.push(placement);
		byRole.set(placement.role, rolePlacements);
	}
	for (const [role, placements] of byRole) assertContiguous(placements, `${role} placement`);
	for (const singleton of ["primary", "cover", "social_share"]) {
		if ((byRole.get(singleton)?.length ?? 0) > 1) {
			throw new Error(`Catalog V2 permits at most one ${singleton} placement`);
		}
	}
}

function validatePrintOptions(draft: Extract<
	CatalogProductGraphV2Draft,
	{ productKind: "print" | "print_set" }
>) {
	assertOnlyKeys(draft.printOptions, [
		"borderOptionsEnabled",
		"frameOptionsEnabled",
		"framePriceMultiplierBasisPoints",
	], "Print options");
	if (
		typeof draft.printOptions.borderOptionsEnabled !== "boolean"
		|| typeof draft.printOptions.frameOptionsEnabled !== "boolean"
	) throw new Error("Print option toggles must be boolean");
	if (
		!Number.isSafeInteger(draft.printOptions.framePriceMultiplierBasisPoints)
		|| draft.printOptions.framePriceMultiplierBasisPoints < 0
		|| draft.printOptions.framePriceMultiplierBasisPoints
			> CATALOG_PRODUCT_GRAPH_V2_LIMITS.framePriceMultiplierBasisPoints
	) throw new Error("Frame price multiplier basis points are outside the bounded contract");
	if (draft.printSources.length > CATALOG_PRODUCT_GRAPH_V2_LIMITS.printSources) {
		throw new Error("Catalog V2 print-source limit exceeded");
	}
	if (draft.productKind === "print" && draft.printSources.length > 1) {
		throw new Error("A single print may reference at most one private print source");
	}
	assertContiguous(draft.printSources, "Print source");
	assertUnique(draft.printSources.map(({ key }) => key), "Print-source keys");
	for (const [index, source] of draft.printSources.entries()) {
		assertOnlyKeys(source, ["key", "order", "assetId"], `Print source ${index + 1}`);
		assertStableKey(source.key, CATALOG_PRODUCT_GRAPH_V2_LIMITS.relationKey, "Print-source key");
		assertStableKey(source.assetId, CATALOG_PRODUCT_GRAPH_V2_LIMITS.assetId, "Print-source asset ID");
	}
}

function validateSetMembers(
	draft: Extract<CatalogProductGraphV2Draft, { productKind: "print_set" }>,
) {
	if (draft.setMembers.length > CATALOG_PRODUCT_GRAPH_V2_LIMITS.printSetMembers) {
		throw new Error("A print set cannot exceed 20 members");
	}
	assertContiguous(draft.setMembers, "Print-set member");
	assertUnique(draft.setMembers.map(({ key }) => key), "Print-set member keys");
	assertUnique(
		draft.setMembers.map(({ mediaPlacementKey }) => mediaPlacementKey),
		"Print-set member media relations",
	);
	assertUnique(
		draft.setMembers.map(({ printSourceKey }) => printSourceKey),
		"Print-set member print-source relations",
	);
	const memberMedia = draft.webMedia.filter(({ role }) => role === "set_member");
	if (
		draft.setMembers.length !== memberMedia.length
		|| draft.setMembers.length !== draft.printSources.length
	) throw new Error("Print-set members, member media, and print sources must form one exact graph");
	for (const [index, member] of draft.setMembers.entries()) {
		assertOnlyKeys(
			member,
			["key", "order", "mediaPlacementKey", "printSourceKey"],
			`Print-set member ${index + 1}`,
		);
		assertStableKey(member.key, CATALOG_PRODUCT_GRAPH_V2_LIMITS.relationKey, "Print-set member key");
		const media = memberMedia.find(({ key }) => key === member.mediaPlacementKey);
		const source = draft.printSources.find(({ key }) => key === member.printSourceKey);
		if (!media || !source || media.order !== member.order || source.order !== member.order) {
			throw new Error("Print-set member relation keys and orders must resolve exactly");
		}
	}
}

function validatePaidFile(
	draft: Extract<CatalogProductGraphV2Draft, { productKind: "digital_download" }>,
) {
	if (!draft.paidFile) return;
	assertOnlyKeys(draft.paidFile, ["key", "assetId", "version"], "Paid-file relation");
	assertStableKey(draft.paidFile.key, CATALOG_PRODUCT_GRAPH_V2_LIMITS.relationKey, "Paid-file key");
	assertStableKey(draft.paidFile.assetId, CATALOG_PRODUCT_GRAPH_V2_LIMITS.assetId, "Paid-file asset ID");
	assertOptionalText(
		draft.paidFile.version,
		CATALOG_PRODUCT_GRAPH_V2_LIMITS.paidFileVersion,
		"Paid-file version",
	);
}

const COMMON_KEYS = [
	"schemaVersion",
	"productKind",
	"title",
	"slug",
	"description",
	"seoDescription",
	"currency",
	"fulfillmentMode",
	"saleAvailability",
	"shopPlacement",
	"variants",
	"webMedia",
] as const;

/** Validates one complete Editor-safe, provider-neutral private catalog graph. */
export function validateCatalogProductGraphV2Draft(draft: CatalogProductGraphV2Draft) {
	if (![
		"print",
		"print_set",
		"postcard",
		"tapestry",
		"digital_download",
		"merchandise",
	].includes(draft.productKind)) throw new Error("Catalog product kind is invalid");
	const kindKeys = draft.productKind === "print"
		? ["printOptions", "printSources"]
		: draft.productKind === "print_set"
		? ["printOptions", "printSources", "setMembers"]
		: draft.productKind === "digital_download"
		? ["paidFile"]
		: [];
	assertOnlyKeys(draft, [...COMMON_KEYS, ...kindKeys], "Catalog V2 draft");
	if (draft.schemaVersion !== 2) throw new Error("Catalog graph schema version must be 2");
	if (draft.currency !== "usd") throw new Error("Catalog graph currency must be USD");
	if (draft.saleAvailability !== "available" && draft.saleAvailability !== "unavailable") {
		throw new Error("Catalog sale availability is invalid");
	}
	if (typeof draft.shopPlacement.featured !== "boolean") {
		throw new Error("Shop featured placement must be boolean");
	}
	const fulfillmentIsValid = draft.productKind === "print" || draft.productKind === "print_set"
		? draft.fulfillmentMode === "production_partner"
			|| draft.fulfillmentMode === "merchant_fulfilled"
		: draft.productKind === "digital_download"
		? draft.fulfillmentMode === "digital_delivery"
		: draft.fulfillmentMode === "merchant_fulfilled";
	if (!fulfillmentIsValid) {
		throw new Error(`Fulfillment mode is invalid for ${draft.productKind}`);
	}
	assertOptionalText(draft.title, CATALOG_PRODUCT_GRAPH_V2_LIMITS.title, "Product title");
	assertOptionalText(
		draft.description,
		CATALOG_PRODUCT_GRAPH_V2_LIMITS.description,
		"Product description",
	);
	assertOptionalText(
		draft.seoDescription,
		CATALOG_PRODUCT_GRAPH_V2_LIMITS.seoDescription,
		"SEO description",
	);
	if (
		draft.slug !== undefined
		&& (draft.slug.length > CATALOG_PRODUCT_GRAPH_V2_LIMITS.slug
			|| !SLUG_PATTERN.test(draft.slug))
	) throw new Error("Product slug must be a bounded lowercase URL key");
	assertOnlyKeys(draft.shopPlacement, ["featured", "orderRank"], "Shop placement");
	assertOptionalText(
		draft.shopPlacement.orderRank,
		CATALOG_PRODUCT_GRAPH_V2_LIMITS.orderRank,
		"Shop order rank",
	);

	validateVariants(draft);
	validateWebMedia(draft);
	if (
		draft.productKind === "postcard"
		|| draft.productKind === "tapestry"
		|| draft.productKind === "merchandise"
		|| draft.productKind === "digital_download"
	) validateFixedPriceVariant(draft);
	if (draft.productKind === "print" || draft.productKind === "print_set") {
		validatePrintOptions(draft);
	}
	if (draft.productKind === "print_set") validateSetMembers(draft);
	if (draft.productKind === "digital_download") validatePaidFile(draft);
	const totalChildRows = draft.variants.length
		+ draft.webMedia.length
		+ (draft.productKind === "print" || draft.productKind === "print_set"
			? draft.printSources.length
			: 0)
		+ (draft.productKind === "print_set" ? draft.setMembers.length : 0)
		+ (draft.productKind === "digital_download" && draft.paidFile ? 1 : 0)
		+ 1;
	if (totalChildRows > CATALOG_PRODUCT_GRAPH_V2_LIMITS.totalChildRows) {
		throw new Error("Catalog V2 graph exceeds the bounded child-row budget");
	}
	return draft;
}
