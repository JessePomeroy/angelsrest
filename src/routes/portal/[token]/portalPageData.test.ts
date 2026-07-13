import { describe, expect, it } from "vitest";
import type { Doc } from "$convex/dataModel";
import { getInvoiceSubtotal, getInvoiceTotal, getQuoteTotal } from "./portalPageData";
import { createPortalPageData } from "./portalPageData.server";

const commonToken = { used: false, siteUrl: "example.test" };
const client = { name: "Client", email: "client@example.test" };

function document<T extends "quotes" | "invoices" | "contracts" | "galleries">(
	value: Partial<Doc<T>>,
): Doc<T> {
	return value as Doc<T>;
}

describe("createPortalPageData", () => {
	it.each([
		["quote", document<"quotes">({ quoteNumber: "Q-1", packages: [] })],
		["invoice", document<"invoices">({ invoiceNumber: "I-1", items: [] })],
		["contract", document<"contracts">({ title: "Agreement", body: "Terms" })],
	] as const)("correlates a %s token with its document", (type, portalDocument) => {
		const result = createPortalPageData("shared-token", "Example Studio", {
			token: { ...commonToken, type },
			document: portalDocument,
			client,
		});

		expect(result).toMatchObject({
			token: "shared-token",
			type,
			document: portalDocument,
			client,
			businessName: "Example Studio",
			siteUrl: "example.test",
			used: false,
		});
	});

	it("rejects a token/document mismatch instead of casting it", () => {
		expect(() =>
			createPortalPageData("shared-token", "Example Studio", {
				token: { ...commonToken, type: "quote" },
				document: document<"invoices">({ invoiceNumber: "I-1", items: [] }),
				client,
			}),
		).toThrow("Portal quote token returned a non-quote document");
	});

	it("rejects gallery tokens owned by the delivery route", () => {
		expect(() =>
			createPortalPageData("shared-token", "Example Studio", {
				token: { ...commonToken, type: "gallery" },
				document: document<"galleries">({ name: "Gallery" }),
				client,
			}),
		).toThrow("Gallery tokens are not supported by the document portal");
	});
});

describe("portal totals", () => {
	it("sums quote package prices", () => {
		expect(getQuoteTotal([{ price: 12_500 }, { price: 7_500 }])).toBe(20_000);
	});

	it("sums invoice quantities and unit prices", () => {
		const items = [
			{ quantity: 2, unitPrice: 5_000 },
			{ quantity: 1, unitPrice: 2_500 },
		];
		expect(getInvoiceSubtotal(items)).toBe(12_500);
		expect(getInvoiceTotal(items)).toBe(12_500);
	});

	it("applies the existing percentage tax calculation", () => {
		expect(getInvoiceTotal([{ quantity: 1, unitPrice: 10_000 }], 6)).toBe(10_600);
	});
});
