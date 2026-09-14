import { describe, expect, it } from "vitest";
import {
	type ResolvePrintConfigurationInput,
	resolvePrintConfiguration,
} from "../shop/printConfigurator";
import { printConfigurationCartFields } from "../shop/printPurchase";

function resolve(overrides: Partial<ResolvePrintConfigurationInput> = {}) {
	const configuration = resolvePrintConfiguration({
		variants: [{ paper: "glossy", size: "8x10", retailPrice: 45 }],
		paperSlug: "glossy",
		sizeSlug: "8x10",
		borderWidthValue: "none",
		frameValue: "none",
		framedEnabled: true,
		...overrides,
	});
	if (!configuration) throw new Error("Expected a valid fixture configuration");
	return configuration;
}

const paperFields = {
	paperName: "Glossy",
	paperSubcategoryId: 103007,
	paperWidth: 8,
	paperHeight: 10,
	paperSlug: "glossy",
	sizeSlug: "8x10",
	borderWidthValue: "none",
	frameValue: "none",
	quantity: 1,
	unitPriceCents: 4500,
};

describe("print configuration cart snapshot", () => {
	it("projects only paper selection and price, omitting inactive finishes and page identity", () => {
		const configuration = resolve();
		const before = structuredClone(configuration);
		expect(printConfigurationCartFields(configuration)).toEqual(paperFields);
		expect(configuration).toEqual(before);
	});

	it("retains an unframed border without adding frame fields", () => {
		expect(printConfigurationCartFields(resolve({ borderWidthValue: "0.5" }))).toEqual({
			...paperFields,
			borderWidthValue: "0.5",
			borderWidth: 0.5,
		});
	});

	it("snapshots the normalized quarter-inch framed finish and complete frame price", () => {
		expect(
			printConfigurationCartFields(
				resolve({ borderWidthValue: "1", frameValue: "0.875-black", frameMarkupMultiplier: 2 }),
			),
		).toEqual({
			...paperFields,
			borderWidthValue: "0.25",
			borderWidth: 0.25,
			frameValue: "0.875-black",
			frameSubcategoryId: 105001,
			unitPriceCents: 8516,
		});
	});

	it("retains canvas fulfillment and wrap identity without paper finishes", () => {
		expect(
			printConfigurationCartFields(
				resolve({
					variants: [{ paper: "canvas-white-1.25", size: "16x20", retailPrice: 90 }],
					paperSlug: "canvas-white-1.25",
					sizeSlug: "16x20",
					borderWidthValue: "1",
					frameValue: "0.875-black",
				}),
			),
		).toEqual({
			paperName: 'Canvas White — 1.25" stretch',
			paperSubcategoryId: 101002,
			paperWidth: 16,
			paperHeight: 20,
			paperSlug: "canvas-white-1.25",
			sizeSlug: "16x20",
			borderWidthValue: "none",
			frameValue: "none",
			canvasSubcategoryId: 101002,
			canvasWrapHex: "#FFFFFF",
			quantity: 1,
			unitPriceCents: 9000,
		});
	});

	it("converts resolved dollar prices to cents with the existing rounding rule", () => {
		expect(
			printConfigurationCartFields(
				resolve({ variants: [{ paper: "glossy", size: "8x10", retailPrice: 42.335 }] }),
			).unitPriceCents,
		).toBe(4234);
	});
});
