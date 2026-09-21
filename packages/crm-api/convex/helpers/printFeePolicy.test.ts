import { describe, expect, it } from "vitest";
import {
	calculatePrintFeeAmount,
	calculatePrintSubtotalCents,
	type PrintFeeLine,
} from "./printFeePolicy";

describe("print fee policy", () => {
	it("includes print sets once per purchased set and excludes every other catalog kind", () => {
		const lines: PrintFeeLine[] = [
			{ productKind: "print", unitPriceCents: 10_019, quantity: 3 },
			{ productKind: "print_set", unitPriceCents: 12_019, quantity: 2 },
			{ productKind: "digital_download", unitPriceCents: 5000, quantity: 2 },
			{ productKind: "postcard", unitPriceCents: 1200, quantity: 4 },
			{ productKind: "tapestry", unitPriceCents: 7000, quantity: 2 },
			{ productKind: "merchandise", unitPriceCents: 6000, quantity: 2 },
		];
		const subtotal = calculatePrintSubtotalCents(lines);
		expect(subtotal).toBe(54_095);
		expect(calculatePrintFeeAmount(subtotal)).toBe(2704);
	});

	it.each([[0, 0], [19, 0], [20, 1], [39, 1], [40, 2], [10_099, 504]])(
		"rounds 5%% of %i cents down to %i cents",
		(subtotal, fee) => expect(calculatePrintFeeAmount(subtotal)).toBe(fee),
	);

	it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
		"rejects invalid money %s before calculating a fee",
		(amount) => {
			expect(() => calculatePrintFeeAmount(amount)).toThrow("integer cents");
			expect(() => calculatePrintSubtotalCents([
				{ productKind: "merchandise", unitPriceCents: amount, quantity: 1 },
			])).toThrow("integer cents");
		},
	);

	it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
		"rejects invalid quantity %s",
		(quantity) => expect(() => calculatePrintSubtotalCents([
			{ productKind: "print", unitPriceCents: 100, quantity },
		])).toThrow("quantity"),
	);

	it("rejects multiplication and subtotal overflow", () => {
		expect(() => calculatePrintSubtotalCents([
			{ productKind: "print", unitPriceCents: Number.MAX_SAFE_INTEGER, quantity: 2 },
		])).toThrow("integer cents");
		expect(() => calculatePrintSubtotalCents([
			{ productKind: "print", unitPriceCents: Number.MAX_SAFE_INTEGER, quantity: 1 },
			{ productKind: "print_set", unitPriceCents: 1, quantity: 1 },
		])).toThrow("integer cents");
	});
});
