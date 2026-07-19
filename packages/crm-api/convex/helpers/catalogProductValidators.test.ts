import { describe, expect, test } from "vitest";
import {
	CATALOG_PRODUCT_LIMITS,
	type CatalogProductDraft,
	validateCatalogProductDraft,
	validateCatalogProductKey,
} from "./catalogProductValidators";

function validDraft(overrides: Partial<CatalogProductDraft> = {}): CatalogProductDraft {
	return {
		title: "Print",
		slug: "print",
		description: "Description",
		fulfillmentMode: "production_partner",
		saleAvailability: "available",
		borderOptionsEnabled: false,
		frameOptionsEnabled: false,
		framePriceMultiplierBasisPoints: 20_000,
		variants: [{
			key: "matte-8x10",
			materialOptionKey: "matte",
			sizeOptionKey: "8x10",
			retailPriceCents: 4_200,
			status: "enabled",
		}],
		...overrides,
	};
}

describe("catalog product draft validation boundaries", () => {
	test("accepts the product-key ceiling and rejects empty, malformed, or oversized keys", () => {
		expect(() => validateCatalogProductKey("a".repeat(CATALOG_PRODUCT_LIMITS.productKey)))
			.not.toThrow();
		for (const value of [
			"",
			"contains space",
			"contains/slash",
			"a".repeat(CATALOG_PRODUCT_LIMITS.productKey + 1),
		]) {
			expect(() => validateCatalogProductKey(value)).toThrow(/product key/i);
		}
	});

	test("rejects empty, malformed, and oversized slug or option identities", () => {
		for (const slug of ["", "Uppercase", "double--hyphen", "a".repeat(97)]) {
			expect(() => validateCatalogProductDraft(validDraft({ slug }))).toThrow(/product slug/i);
		}
		for (const materialOptionKey of ["", "Uppercase", "contains space", "a".repeat(121)]) {
			expect(() => validateCatalogProductDraft(validDraft({
				variants: [{ key: "variant", materialOptionKey, status: "disabled" }],
			}))).toThrow(/material option/i);
		}
	});

	test("accepts exact monetary ceilings and rejects values beyond either integer bound", () => {
		expect(() => validateCatalogProductDraft(validDraft({
			framePriceMultiplierBasisPoints: CATALOG_PRODUCT_LIMITS.framePriceMultiplierBasisPoints,
			variants: [{
				key: "ceiling",
				retailPriceCents: CATALOG_PRODUCT_LIMITS.retailPriceCents,
				status: "enabled",
			}],
		}))).not.toThrow();

		for (const framePriceMultiplierBasisPoints of [-1, 1.5, 1_000_001]) {
			expect(() => validateCatalogProductDraft(validDraft({
				framePriceMultiplierBasisPoints,
			}))).toThrow(/frame price multiplier basis points/i);
		}
		for (const retailPriceCents of [-1, 1.5, 100_000_001]) {
			expect(() => validateCatalogProductDraft(validDraft({
				variants: [{ key: "price", retailPriceCents, status: "enabled" }],
			}))).toThrow(/retail price cents/i);
		}
	});
});
