import { describe, expect, test } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
	CATALOG_PRODUCT_GRAPH_V2_LIMITS,
	type CatalogProductGraphV2Draft,
	validateCatalogProductGraphV2Draft,
} from "./catalogProductGraphValidators";

type PrintDraft = Extract<CatalogProductGraphV2Draft, { productKind: "print" }>;
type PrintSetDraft = Extract<CatalogProductGraphV2Draft, { productKind: "print_set" }>;
type FixedKind = "postcard" | "tapestry" | "digital_download" | "merchandise";

const webAssetId = (value: string) => value as Id<"mediaAssets">;
const printSourceAssetId = (value: string) =>
	value as Id<"catalogPrintSourceAssets">;
const paidFileAssetId = (value: string) =>
	value as Id<"catalogDigitalFileAssets">;

const common = {
	schemaVersion: 2 as const,
	title: "Product",
	slug: "product",
	description: "Product description",
	seoDescription: "Search description",
	currency: "usd" as const,
	saleAvailability: "available" as const,
	shopPlacement: { featured: false, orderRank: "0|100000:" },
};

function validPrint(overrides: Partial<PrintDraft> = {}): PrintDraft {
	return {
		...common,
		productKind: "print",
		fulfillmentMode: "production_partner",
		variants: [{
			key: "matte-8x10",
			order: 0,
			materialOptionKey: "matte",
			sizeOptionKey: "8x10",
			retailPriceCents: 4_200,
			status: "enabled",
		}],
		webMedia: [{
			key: "primary",
			order: 0,
			role: "primary",
			assetId: webAssetId("web.asset.primary"),
		}],
		printOptions: {
			borderOptionsEnabled: true,
			frameOptionsEnabled: false,
			framePriceMultiplierBasisPoints: 20_000,
		},
		printSources: [{
			key: "source",
			order: 0,
			assetId: printSourceAssetId("print.asset.primary"),
		}],
		...overrides,
	};
}

function validPrintSet(memberCount = 2): PrintSetDraft {
	const memberIndexes = Array.from({ length: memberCount }, (_, index) => index);
	return {
		...common,
		productKind: "print_set",
		fulfillmentMode: "production_partner",
		variants: [{
			key: "matte-8x10",
			order: 0,
			materialOptionKey: "matte",
			sizeOptionKey: "8x10",
			retailPriceCents: 7_500,
			status: "enabled",
		}],
		webMedia: [
			{
				key: "cover",
				order: 0,
				role: "cover",
				assetId: webAssetId("web.asset.cover"),
			},
			...memberIndexes.map((index) => ({
				key: `member-${index}`,
				order: index,
				role: "set_member" as const,
				assetId: webAssetId(`web.asset.member-${index}`),
			})),
		],
		printOptions: {
			borderOptionsEnabled: true,
			frameOptionsEnabled: true,
			framePriceMultiplierBasisPoints: 20_000,
		},
		printSources: memberIndexes.map((index) => ({
			key: `source-${index}`,
			order: index,
			assetId: printSourceAssetId(`print.asset.member-${index}`),
		})),
		setMembers: memberIndexes.map((index) => ({
			key: `member-${index}`,
			order: index,
			mediaPlacementKey: `member-${index}`,
			printSourceKey: `source-${index}`,
		})),
	};
}

function validFixed(productKind: FixedKind): CatalogProductGraphV2Draft {
	const draft = {
		...common,
		productKind,
		fulfillmentMode: productKind === "digital_download"
			? "digital_delivery"
			: "merchant_fulfilled",
		variants: [{
			key: "default",
			order: 0,
			retailPriceCents: 5_000,
			status: "enabled",
		}],
		webMedia: [{
			key: "gallery-0",
			order: 0,
			role: "gallery",
			assetId: webAssetId("web.asset.gallery-0"),
		}],
		...(productKind === "digital_download"
			? {
				paidFile: {
					key: "download",
					assetId: paidFileAssetId("paid.asset.download"),
					version: "1.0.0",
				},
			}
			: {}),
	};
	return draft as CatalogProductGraphV2Draft;
}

function expectInvalid(value: unknown, message: RegExp) {
	expect(() => validateCatalogProductGraphV2Draft(
		value as CatalogProductGraphV2Draft,
	)).toThrow(message);
}

describe("catalog product graph V2 accepted shapes", () => {
	test("accepts all six closed product families", () => {
		const drafts = [
			validPrint(),
			validPrintSet(),
			validFixed("postcard"),
			validFixed("tapestry"),
			validFixed("digital_download"),
			validFixed("merchandise"),
		];
		for (const draft of drafts) {
			expect(validateCatalogProductGraphV2Draft(draft)).toBe(draft);
		}
	});

	test("allows merchant-fulfilled prints and unpublished legacy media without alt text", () => {
		const draft = validPrint({ fulfillmentMode: "merchant_fulfilled" });
		expect(draft.webMedia[0]?.altText).toBeUndefined();
		expect(() => validateCatalogProductGraphV2Draft(draft)).not.toThrow();
	});

	test("allows incomplete private source relations while a draft is still being authored", () => {
		expect(() => validateCatalogProductGraphV2Draft(validPrint({ printSources: [] })))
			.not.toThrow();
		expect(() => validateCatalogProductGraphV2Draft({
			...validFixed("digital_download"),
			paidFile: undefined,
		} as CatalogProductGraphV2Draft)).not.toThrow();
	});

	test("accepts the exact 20-member print-set boundary", () => {
		expect(() => validateCatalogProductGraphV2Draft(validPrintSet(20))).not.toThrow();
	});
});

describe("catalog product graph V2 discriminants and prices", () => {
	test("rejects wrong schema, currency, availability, and fulfillment combinations", () => {
		for (const [field, value] of [
			["schemaVersion", 1],
			["currency", "cad"],
			["saleAvailability", "hidden"],
			["fulfillmentMode", "digital_delivery"],
		] as const) {
			expectInvalid({ ...validPrint(), [field]: value }, /schema|currency|availability|fulfillment/i);
		}
		expectInvalid(
			{ ...validFixed("tapestry"), fulfillmentMode: "production_partner" },
			/fulfillment/i,
		);
		expectInvalid(
			{ ...validFixed("digital_download"), fulfillmentMode: "merchant_fulfilled" },
			/fulfillment/i,
		);
		expectInvalid({ ...validPrint(), productKind: "subscription" }, /product kind/i);
	});

	test("requires fixed-price families to contain one priced default variant", () => {
		for (const variants of [
			[],
			[{ key: "custom", order: 0, retailPriceCents: 100, status: "enabled" }],
			[{ key: "default", order: 0, status: "enabled" }],
			[
				{ key: "default", order: 0, retailPriceCents: 100, status: "enabled" },
				{ key: "second", order: 1, retailPriceCents: 200, status: "enabled" },
			],
		]) expectInvalid({ ...validFixed("tapestry"), variants }, /variant|fixed-price/i);
	});

	test("enforces exact positive integer cents and bounded frame basis points", () => {
		for (const retailPriceCents of [0, -1, 1.5, 100_000_001]) {
			expectInvalid(validPrint({
				variants: [{
					...validPrint().variants[0]!,
					retailPriceCents,
				}],
			}), /retail price cents/i);
		}
		for (const framePriceMultiplierBasisPoints of [-1, 1.5, 1_000_001]) {
			expectInvalid(validPrint({
				printOptions: {
					...validPrint().printOptions,
					framePriceMultiplierBasisPoints,
				},
			}), /frame price multiplier/i);
		}
	});
});

describe("catalog product graph V2 ordering and identity", () => {
	test("rejects non-contiguous array and role-relative ordering", () => {
		expectInvalid(validPrint({
			variants: [{ ...validPrint().variants[0]!, order: 1 }],
		}), /variant order/i);
		expectInvalid(validPrint({
			webMedia: [{ ...validPrint().webMedia[0]!, order: 1 }],
		}), /primary placement order/i);
		expectInvalid(validPrint({
			printSources: [{ ...validPrint().printSources[0]!, order: 1 }],
		}), /print source order/i);
		expectInvalid({
			...validPrintSet(),
			setMembers: validPrintSet().setMembers.map((member, index) => ({
				...member,
				order: index + 1,
			})),
		}, /print-set member order/i);
	});

	test("rejects duplicate variant, option-combination, media, and relation keys", () => {
		const variant = validPrint().variants[0]!;
		expectInvalid(validPrint({
			variants: [variant, { ...variant, order: 1 }],
		}), /variant keys/i);
		expectInvalid(validPrint({
			variants: [variant, { ...variant, key: "second", order: 1 }],
		}), /material and size/i);
		expectInvalid(validPrint({
			webMedia: [
				validPrint().webMedia[0]!,
				{ ...validPrint().webMedia[0]!, role: "gallery", order: 0 },
			],
		}), /web-media placement keys/i);
		const set = validPrintSet();
		expectInvalid({
			...set,
			setMembers: set.setMembers.map((member) => ({
				...member,
				mediaPlacementKey: "member-0",
			})),
		}, /media relations/i);
	});

	test("rejects malformed, URL-shaped, and oversized opaque relation identities", () => {
		for (const assetId of [
			"https://media.example.test/file.webp",
			"sites/angelsrest.online/private/master.jpg",
			"a".repeat(CATALOG_PRODUCT_GRAPH_V2_LIMITS.assetId + 1),
		]) {
			expectInvalid(validPrint({
				webMedia: [{
					...validPrint().webMedia[0]!,
					assetId: webAssetId(assetId),
				}],
			}), /opaque stable relation key/i);
		}
	});
});

describe("catalog product graph V2 media and private relations", () => {
	test("enforces kind-specific web-media roles and singleton roles", () => {
		expectInvalid(validPrint({
			webMedia: [{ ...validPrint().webMedia[0]!, role: "cover" }],
		}), /not a valid print web-media role/i);
		expectInvalid(validPrint({
			webMedia: [
				validPrint().webMedia[0]!,
				{ ...validPrint().webMedia[0]!, key: "primary-2", order: 1 },
			],
		}), /at most one primary/i);
		expectInvalid({
			...validFixed("postcard"),
			webMedia: [{
				...validFixed("postcard").webMedia[0]!,
				role: "set_member",
			}],
		}, /not a valid postcard web-media role/i);
	});

	test("requires print-set members to resolve one-to-one to exact media and sources", () => {
		const set = validPrintSet();
		expectInvalid({
			...set,
			setMembers: set.setMembers.map((member, index) => index === 1
				? { ...member, printSourceKey: "missing-source" }
				: member),
		}, /resolve exactly/i);
		expectInvalid({ ...set, printSources: set.printSources.slice(0, 1) }, /one exact graph/i);
		expectInvalid({ ...set, webMedia: set.webMedia.slice(0, 2) }, /one exact graph/i);
	});

	test("keeps private print-source and paid-file relations kind-scoped", () => {
		expectInvalid(validPrint({
			printSources: [
				validPrint().printSources[0]!,
				{
					key: "source-2",
					order: 1,
					assetId: printSourceAssetId("print.asset.second"),
				},
			],
		}), /at most one private print source/i);
		expectInvalid({
			...validFixed("tapestry"),
			paidFile: {
				key: "download",
				assetId: paidFileAssetId("paid.asset.download"),
			},
		}, /unsupported or private fields/i);
	});

	test("rejects storage implementation and capability fields at every graph level", () => {
		expectInvalid({
			...validPrint(),
			privateObjectKey: "sites/angelsrest.online/print/master.jpg",
		}, /unsupported or private fields/i);
		expectInvalid(validPrint({
			printSources: [{
				...validPrint().printSources[0]!,
				capability: "secret-fetch-grant",
			} as PrintDraft["printSources"][number]],
		}), /unsupported or private fields/i);
	});
});

describe("catalog product graph V2 hard limits", () => {
	test("rejects over-limit variants, web media, print sources, and set members", () => {
		const variant = validPrint().variants[0]!;
		expectInvalid(validPrint({
			variants: Array.from(
				{ length: CATALOG_PRODUCT_GRAPH_V2_LIMITS.variantsPerRevision + 1 },
				(_, index) => ({ ...variant, key: `variant-${index}`, order: index }),
			),
		}), /variant list/i);
		expectInvalid(validPrint({
			webMedia: Array.from(
				{ length: CATALOG_PRODUCT_GRAPH_V2_LIMITS.webMediaPlacements + 1 },
				(_, index) => ({
					key: `gallery-${index}`,
					order: index,
					role: "gallery",
					assetId: webAssetId(`web.asset.${index}`),
				}),
			),
		}), /web-media placement limit/i);
		const oversizedSet = validPrintSet(21);
		expectInvalid({
			...oversizedSet,
			printSources: oversizedSet.printSources.slice(0, 20),
		}, /cannot exceed 20 members/i);
	});

	test("rejects oversized common, alt, rank, and paid-file text", () => {
		expectInvalid(validPrint({
			title: "x".repeat(CATALOG_PRODUCT_GRAPH_V2_LIMITS.title + 1),
		}), /product title/i);
		expectInvalid(validPrint({
			shopPlacement: {
				featured: false,
				orderRank: "x".repeat(CATALOG_PRODUCT_GRAPH_V2_LIMITS.orderRank + 1),
			},
		}), /shop order rank/i);
		expectInvalid(validPrint({
			webMedia: [{
				...validPrint().webMedia[0]!,
				altText: "x".repeat(CATALOG_PRODUCT_GRAPH_V2_LIMITS.altText + 1),
			}],
		}), /alt text/i);
		expectInvalid({
			...validFixed("digital_download"),
			paidFile: {
				key: "download",
				assetId: paidFileAssetId("paid.asset.download"),
				version: "x".repeat(CATALOG_PRODUCT_GRAPH_V2_LIMITS.paidFileVersion + 1),
			},
		}, /paid-file version/i);
	});
});
