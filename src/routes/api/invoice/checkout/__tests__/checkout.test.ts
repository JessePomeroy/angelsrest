import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	convexQuery: vi.fn(),
	stripeSessionCreate: vi.fn(),
}));

vi.mock("$lib/server/convexClient", () => ({
	getConvex: () => ({ query: mocks.convexQuery }),
}));

vi.mock("$lib/server/stripeClient", () => ({
	getStripe: () => ({
		checkout: { sessions: { create: mocks.stripeSessionCreate } },
	}),
}));

vi.mock("$convex/api", () => ({
	api: {
		invoices: { get: "invoices.get" },
	},
}));

vi.mock("$env/static/public", () => ({
	PUBLIC_SITE_URL: "https://angelsrest.test",
}));

vi.mock("$lib/config/site", () => ({
	SITE_DOMAIN: "angelsrest.online",
}));

import { POST } from "../+server";

function makeRequest(body: unknown) {
	return {
		request: new Request("https://angelsrest.test/api/invoice/checkout", {
			method: "POST",
			body: JSON.stringify(body),
		}),
	};
}

describe("invoice checkout route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.stripeSessionCreate.mockResolvedValue({
			id: "cs_invoice_123",
			url: "https://stripe.test/invoice",
		});
		mocks.convexQuery.mockResolvedValue({
			_id: "invoice-123",
			status: "sent",
			taxPercent: 10,
			items: [
				{ description: "Design work", quantity: 2, unitPrice: 12.5 },
				{ description: "Print credit", quantity: 1, unitPrice: 4.255 },
			],
		});
	});

	it("creates a payment-mode checkout session from invoice lines and tax", async () => {
		const response = await POST(makeRequest({ invoiceId: "invoice-123" }) as any);

		await expect(response.json()).resolves.toEqual({ url: "https://stripe.test/invoice" });
		expect(mocks.convexQuery).toHaveBeenCalledWith("invoices.get", {
			invoiceId: "invoice-123",
		});

		const params = mocks.stripeSessionCreate.mock
			.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		const requestOptions = mocks.stripeSessionCreate.mock.calls[0]?.[1] as
			| Stripe.RequestOptions
			| undefined;

		expect(requestOptions).toBeUndefined();
		expect(params.mode).toBe("payment");
		expect(params.payment_method_types).toEqual(["card"]);
		expect(params.shipping_address_collection).toBeUndefined();
		expect(params.success_url).toBe(
			"https://angelsrest.test/invoice/payment-success?session_id={CHECKOUT_SESSION_ID}",
		);
		expect(params.cancel_url).toBe("https://angelsrest.test/invoice/payment-canceled");
		expect(params.metadata).toEqual({
			type: "invoice_payment",
			invoiceId: "invoice-123",
			siteUrl: "angelsrest.online",
		});
		expect(params.line_items).toEqual([
			expect.objectContaining({
				quantity: 2,
				price_data: expect.objectContaining({
					unit_amount: 1250,
					product_data: expect.objectContaining({ name: "Design work" }),
				}),
			}),
			expect.objectContaining({
				quantity: 1,
				price_data: expect.objectContaining({
					unit_amount: 426,
					product_data: expect.objectContaining({ name: "Print credit" }),
				}),
			}),
			expect.objectContaining({
				quantity: 1,
				price_data: expect.objectContaining({
					unit_amount: 293,
					product_data: expect.objectContaining({ name: "Tax (10%)" }),
				}),
			}),
		]);
	});

	it("rejects paid invoices before creating a Stripe session", async () => {
		mocks.convexQuery.mockResolvedValueOnce({
			status: "paid",
			items: [],
		});

		await expect(POST(makeRequest({ invoiceId: "invoice-123" }) as any)).rejects.toMatchObject({
			status: 400,
		});
		expect(mocks.stripeSessionCreate).not.toHaveBeenCalled();
	});

	it("omits the tax line when invoice tax is zero", async () => {
		mocks.convexQuery.mockResolvedValueOnce({
			_id: "invoice-123",
			status: "sent",
			taxPercent: 0,
			items: [{ description: "Design work", quantity: 1, unitPrice: 12.5 }],
		});

		await POST(makeRequest({ invoiceId: "invoice-123" }) as any);

		const params = mocks.stripeSessionCreate.mock
			.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		expect(params.line_items).toHaveLength(1);
		expect(params.line_items?.[0]).toEqual(
			expect.objectContaining({
				quantity: 1,
				price_data: expect.objectContaining({
					unit_amount: 1250,
					product_data: expect.objectContaining({ name: "Design work" }),
				}),
			}),
		);
	});

	it("rejects requests missing an invoice id before querying Convex", async () => {
		await expect(POST(makeRequest({}) as any)).rejects.toMatchObject({ status: 400 });

		expect(mocks.convexQuery).not.toHaveBeenCalled();
		expect(mocks.stripeSessionCreate).not.toHaveBeenCalled();
	});

	it("rejects unknown invoices before creating a Stripe session", async () => {
		mocks.convexQuery.mockResolvedValueOnce(null);

		await expect(POST(makeRequest({ invoiceId: "missing-invoice" }) as any)).rejects.toMatchObject({
			status: 404,
		});
		expect(mocks.stripeSessionCreate).not.toHaveBeenCalled();
	});

	it("rejects invalid invoice tax before creating a Stripe session", async () => {
		mocks.convexQuery.mockResolvedValueOnce({
			status: "sent",
			taxPercent: 101,
			items: [{ description: "Design work", quantity: 1, unitPrice: 10 }],
		});

		await expect(POST(makeRequest({ invoiceId: "invoice-123" }) as any)).rejects.toMatchObject({
			status: 400,
		});
		expect(mocks.stripeSessionCreate).not.toHaveBeenCalled();
	});
});
