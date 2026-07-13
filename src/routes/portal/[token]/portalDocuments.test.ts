import { render } from "svelte/server";
import { describe, expect, it, vi } from "vitest";
import type { Doc } from "$convex/dataModel";
import ContractDocument from "./ContractDocument.svelte";
import InvoiceDocument from "./InvoiceDocument.svelte";
import QuoteDocument from "./QuoteDocument.svelte";

function document<T extends "quotes" | "invoices" | "contracts">(value: Partial<Doc<T>>): Doc<T> {
	return value as Doc<T>;
}

describe("portal document presentation", () => {
	it("renders quote details and both decisions while a sent token is unused", () => {
		const { body } = render(QuoteDocument, {
			props: {
				document: document<"quotes">({
					_creationTime: 1_700_000_000_000,
					quoteNumber: "Q-42",
					status: "sent",
					packages: [{ name: "Portraits", price: 25_000 }],
				}),
				client: { name: "Taylor" },
				used: false,
				status: "sent",
				loading: false,
				onAccept: vi.fn(),
				onDecline: vi.fn(),
			},
		});

		expect(body).toContain("Q-42");
		expect(body).toContain("$250.00");
		expect(body).toContain("Accept Quote");
		expect(body).toContain("Decline Quote");
	});

	it("renders invoice totals and the paid state without a payment action", () => {
		const { body } = render(InvoiceDocument, {
			props: {
				document: document<"invoices">({
					_creationTime: 1_700_000_000_000,
					invoiceNumber: "I-42",
					status: "paid",
					items: [{ description: "Session", quantity: 2, unitPrice: 10_000 }],
				}),
				client: { name: "Taylor" },
				status: "paid",
				loading: false,
				onPay: vi.fn(),
			},
		});

		expect(body).toContain("I-42");
		expect(body).toContain("$200.00");
		expect(body).toContain("has been paid");
		expect(body).not.toContain("Pay Now");
	});

	it("renders a signed contract and hides the signing form", () => {
		const { body } = render(ContractDocument, {
			props: {
				document: document<"contracts">({
					_creationTime: 1_700_000_000_000,
					title: "Portrait Agreement",
					body: "Agreement terms",
					status: "signed",
				}),
				client: { name: "Taylor" },
				used: true,
				status: "signed",
				signedAt: 1_700_000_000_000,
				loading: false,
				onSign: vi.fn(),
			},
		});

		expect(body).toContain("Portrait Agreement");
		expect(body).toContain("Agreement terms");
		expect(body).toContain("This contract was signed");
		expect(body).not.toContain("Sign Contract");
	});
});
