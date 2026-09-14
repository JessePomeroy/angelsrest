import { describe, expect, it } from "vitest";
import {
	calculateCatalogProductMargin,
	resolveCatalogProductVariantOptions,
} from "$lib/catalogProductMargin";

const printInput = {
	productKind: "print" as const,
	materialOptionKey: "archival-matte",
	sizeOptionKey: "8x10",
	retailPriceCents: 10_000,
	setMemberCount: 0,
};

describe("catalog product margin", () => {
	it("reuses the print catalog cost and fee calculation", () => {
		expect(calculateCatalogProductMargin(printInput)).toEqual({
			summary: "Cost: $3.19 · Stripe fee: $3.20 · Take-home: $93.61 (93.6%)",
		});
	});

	it("multiplies print-set cost by its member count", () => {
		expect(
			calculateCatalogProductMargin({
				...printInput,
				productKind: "print_set",
				setMemberCount: 2,
			}),
		).toEqual({
			summary: "Cost: $6.38 ($3.19 × 2 prints) · Stripe fee: $3.20 · Take-home: $90.42 (90.4%)",
		});
		expect(
			calculateCatalogProductMargin({
				...printInput,
				productKind: "print_set",
				setMemberCount: 0,
			}).summary,
		).toContain("add prints to the set to calculate set profit");
	});

	it("adds the former framed estimate only when that option is active", () => {
		const result = calculateCatalogProductMargin({
			...printInput,
			frameMarkupMultiplier: 2,
		});
		expect(result.framedSummary).toBe(
			'Framed (0.875"): retail $140.16 · wholesale $23.27 · Stripe $4.36 · Take-home: $112.53 (80.3%)',
		);
	});

	it("returns bounded guidance for incomplete and unknown options", () => {
		expect(
			calculateCatalogProductMargin({
				...printInput,
				materialOptionKey: undefined,
			}).summary,
		).toBe("Choose a material and size to see cost and profit.");
		expect(
			calculateCatalogProductMargin({
				...printInput,
				materialOptionKey: "unknown-paper",
			}).summary,
		).toBe("Cost is not available for this material and size.");
	});

	it("supplies labelled materials and only compatible sizes", () => {
		const paper = resolveCatalogProductVariantOptions({
			productKind: "print",
			materialOptionKey: "archival-matte",
		});
		expect(paper.materials).toContainEqual({ value: "archival-matte", label: "Archival Matte" });
		expect(paper.sizes).toHaveLength(9);
		expect(paper.sizes).toContainEqual({ value: "4x6", label: "4×6" });

		const canvas = resolveCatalogProductVariantOptions({
			productKind: "print_set",
			materialOptionKey: "canvas-black-1.25",
		});
		expect(canvas.sizes.map(({ value }) => value)).toEqual([
			"8x10",
			"11x14",
			"16x20",
			"24x36",
			"30x40",
			"40x60",
		]);
		expect(
			resolveCatalogProductVariantOptions({
				productKind: "print",
				materialOptionKey: "unknown-paper",
			}).sizes,
		).toEqual([]);
	});
});
