import { describe, expect, it } from "vitest";
import {
	getAvailablePrintPapers,
	getAvailablePrintSizes,
	normalizePrintFinishSelection,
	resolvePrintConfiguration,
} from "./configurator";

const variants = [
	{ paper: "archival-matte", size: "8x10", retailPrice: 42 },
	{ paper: "archival-matte", size: "11x14", retailPrice: 54 },
	{ paper: "glossy", size: "8x10", retailPrice: 45 },
	{ paper: "glossy", size: "8x10", retailPrice: 999, enabled: false },
];

describe("print configurator", () => {
	it("derives ordered, unique material and size options from enabled variants", () => {
		expect(getAvailablePrintPapers(variants)).toEqual([
			{ slug: "archival-matte", name: "Archival Matte" },
			{ slug: "glossy", name: "Glossy" },
		]);
		expect(getAvailablePrintSizes(variants, "archival-matte")).toEqual([
			{ slug: "8x10", label: "8×10" },
			{ slug: "11x14", label: "11×14" },
		]);
	});

	it("normalizes canvas and framed finish invariants", () => {
		expect(
			normalizePrintFinishSelection({
				paperSlug: "canvas-black-1.25",
				borderWidthValue: "1",
				frameValue: "0.875-black",
			}),
		).toEqual({
			paperSlug: "canvas-black-1.25",
			borderWidthValue: "none",
			frameValue: "none",
		});
		expect(
			normalizePrintFinishSelection({
				paperSlug: "glossy",
				borderWidthValue: "none",
				frameValue: "0.875-black",
			}),
		).toEqual({
			paperSlug: "glossy",
			borderWidthValue: "0.25",
			frameValue: "0.875-black",
		});
	});

	it("resolves the server-equivalent framed display price and fulfillment metadata", () => {
		const configuration = resolvePrintConfiguration({
			variants,
			paperSlug: "glossy",
			sizeSlug: "8x10",
			borderWidthValue: "none",
			frameValue: "0.875-black",
			bordersEnabled: true,
			framedEnabled: true,
			frameMarkupMultiplier: 2,
		});

		expect(configuration).toMatchObject({
			displayPrice: 85.16,
			paperSubcategoryId: 103007,
			borderWidthValue: "0.25",
			borderWidth: 0.25,
			frameSubcategoryId: 105001,
		});
	});

	it("uses the canvas fulfillment category and rejects unavailable selections", () => {
		const canvas = resolvePrintConfiguration({
			variants: [
				{ paper: "canvas-white-1.25", size: "16x20", retailPrice: 90 },
			],
			paperSlug: "canvas-white-1.25",
			sizeSlug: "16x20",
			borderWidthValue: "1",
			frameValue: "1.25-white",
			framedEnabled: true,
		});

		expect(canvas).toMatchObject({
			displayPrice: 90,
			paperSubcategoryId: 101002,
			borderWidthValue: "none",
			frameValue: "none",
			canvas: { subcategoryId: 101002, wrapHex: "#FFFFFF" },
		});
		expect(
			resolvePrintConfiguration({
				variants,
				paperSlug: "glossy",
				sizeSlug: "24x36",
				borderWidthValue: "none",
				frameValue: "none",
			}),
		).toBeNull();
	});
});
