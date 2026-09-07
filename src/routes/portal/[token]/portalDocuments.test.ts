import { render } from "svelte/server";
import { describe, expect, it, vi } from "vitest";
import ContractDocument from "./ContractDocument.svelte";
import InvoiceDocument from "./InvoiceDocument.svelte";
import type {
	PortalContractDocument,
	PortalInvoiceDocument,
	PortalQuoteDocument,
} from "./portalPageData";
import QuoteDocument from "./QuoteDocument.svelte";

describe("portal document presentation", () => {
	it("renders quote details and both decisions while a sent token is unused", () => {
		const { body } = render(QuoteDocument, {
			props: {
				document: {
					_creationTime: 1_700_000_000_000,
					quoteNumber: "Q-42",
					status: "sent",
					packages: [{ name: "Portraits", price: 25_000 }],
				} satisfies PortalQuoteDocument,
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
				document: {
					_creationTime: 1_700_000_000_000,
					invoiceNumber: "I-42",
					status: "paid",
					items: [{ description: "Session", quantity: 2, unitPrice: 10_000 }],
				} satisfies PortalInvoiceDocument,
				client: { name: "Taylor" },
				used: false,
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
				document: {
					_creationTime: 1_700_000_000_000,
					title: "Portrait Agreement",
					body: "Agreement terms",
					status: "signed",
				} satisfies PortalContractDocument,
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

	it("renders fractional quantities with rounded lines, subtotal and tax", () => {
		const { body } = render(InvoiceDocument, {
			props: {
				document: {
					_creationTime: 1_700_000_000_000,
					invoiceNumber: "I-FRACTION",
					status: "sent",
					items: [
						{ description: "Half hour A", quantity: 0.5, unitPrice: 1999 },
						{ description: "Half hour B", quantity: 0.5, unitPrice: 1999 },
					],
					taxPercent: 6.25,
				},
				client: null,
				used: false,
				status: "sent",
				loading: false,
				onPay: vi.fn(),
			},
		});
		expect(body.match(/\$10\.00/g)).toHaveLength(2);
		expect(body).toContain("$20.00");
		expect(body).toContain("$1.25");
		expect(body).toContain("$21.25");
		expect(body).toContain("Pay Now");
	});

	it.each([
		"sent",
		"paid",
	] as const)("keeps a historical invalid %s invoice readable without offering payment", (status) => {
		const { body } = render(InvoiceDocument, {
			props: {
				document: {
					_creationTime: 1_700_000_000_000,
					invoiceNumber: "I-LEGACY",
					status,
					items: [{ description: "Invalid legacy line", quantity: 0, unitPrice: 100 }],
				},
				client: { name: "Taylor" },
				used: false,
				status,
				loading: false,
				onPay: vi.fn(),
			},
		});
		expect(body).toContain("I-LEGACY");
		expect(body).toContain("Taylor");
		expect(body).toContain("corrected invoice");
		expect(body).not.toContain("Pay Now");
		if (status === "paid") expect(body).toContain("has been paid");
	});
});
