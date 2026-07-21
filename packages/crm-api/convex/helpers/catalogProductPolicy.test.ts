import { describe, expect, test } from "vitest";
import {
	CATALOG_PRODUCT_KIND_ORDER,
	normalizeCatalogProductKinds,
} from "./catalogProductPolicy";
import type { CatalogProductKind } from "./catalogProductValidators";

describe("catalog product capability policy", () => {
	test("accepts deny-all and returns the canonical supported order", () => {
		expect(normalizeCatalogProductKinds([])).toEqual([]);
		expect(normalizeCatalogProductKinds([
			"merchandise",
			"print_set",
			"digital_download",
			"print",
			"tapestry",
			"postcard",
		])).toEqual(CATALOG_PRODUCT_KIND_ORDER);
	});

	test("rejects duplicate and unsupported product kinds", () => {
		expect(() => normalizeCatalogProductKinds(["print", "print"]))
			.toThrow(/duplicate catalog product kind/i);
		expect(() => normalizeCatalogProductKinds(
			["subscription"] as unknown as CatalogProductKind[],
		)).toThrow(/unsupported catalog product kind/i);
	});
});
