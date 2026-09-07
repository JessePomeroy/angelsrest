import { describe, expect, it } from "vitest";
import { calculateInvoiceAmounts } from "../src/invoiceAmounts";

describe("invoice cent amounts", () => {
	it("rounds each fractional line before subtotal and tax", () => {
		expect(calculateInvoiceAmounts([
			{ quantity: 0.5, unitPrice: 1999 },
			{ quantity: 0.5, unitPrice: 1999 },
		], 6.25)).toEqual({
			lineAmountsCents: [1000, 1000], subtotalCents: 2000, taxCents: 125, totalCents: 2125,
		});
	});

	it("rounds tax once and supports sub-cent and zero-price lines", () => {
		expect(calculateInvoiceAmounts([
			{ quantity: 0.001, unitPrice: 100 },
			{ quantity: 1.25, unitPrice: 0 },
			{ quantity: 1, unitPrice: 1999 },
		], 6.25)).toEqual({
			lineAmountsCents: [0, 0, 1999], subtotalCents: 1999, taxCents: 125, totalCents: 2124,
		});
		expect(calculateInvoiceAmounts([]).totalCents).toBe(0);
	});

	it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])("rejects quantity %s", (quantity) => {
		expect(() => calculateInvoiceAmounts([{ quantity, unitPrice: 100 }])).toThrow("quantity");
	});

	it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("rejects unit cents %s", (unitPrice) => {
		expect(() => calculateInvoiceAmounts([{ quantity: 0.5, unitPrice }])).toThrow("price");
	});

	it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])("rejects tax %s", (tax) => {
		expect(() => calculateInvoiceAmounts([{ quantity: 0.5, unitPrice: 1999 }], tax)).toThrow("tax");
	});

	it("rejects line, subtotal and total overflow", () => {
		const max = { quantity: 1, unitPrice: Number.MAX_SAFE_INTEGER };
		expect(() => calculateInvoiceAmounts([{ ...max, quantity: 2 }])).toThrow("precision");
		expect(() => calculateInvoiceAmounts([max, max])).toThrow("precision");
		expect(() => calculateInvoiceAmounts([max], 100)).toThrow("precision");
	});
});
