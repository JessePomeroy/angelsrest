import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	convexQuery: vi.fn(),
	stripeSessionCreate: vi.fn(),
	resolveStripeTenantForSite: vi.fn(),
}));

vi.mock("$lib/server/convexClient", () => ({
	getConvex: () => ({ query: mocks.convexQuery }),
}));

vi.mock("$lib/server/stripeClient", () => ({
	getStripe: () => ({
		checkout: { sessions: { create: mocks.stripeSessionCreate } },
	}),
}));

vi.mock("$lib/server/stripeTenant", () => ({
	resolveStripeTenantForSite: mocks.resolveStripeTenantForSite,
}));

vi.mock("$convex/api", () => ({
	api: {
		portal: { getByToken: "portal.getByToken" },
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

function expectedIdempotencyKey({
	siteUrl,
	invoiceId,
	lineItemsCents,
	taxPercent,
	taxCents,
}: {
	siteUrl: string;
	invoiceId: string;
	lineItemsCents: { description: string; quantity: number; unitPriceCents: number }[];
	taxPercent: number;
	taxCents: number;
}) {
	const fingerprint = createHash("sha256")
		.update(JSON.stringify({ lineItemsCents, taxPercent, taxCents }))
		.digest("hex")
		.slice(0, 24);
	return `invoice-checkout:${siteUrl}:${invoiceId}:${fingerprint}`;
}

describe("invoice checkout route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.stripeSessionCreate.mockResolvedValue({
			id: "cs_invoice_123",
			url: "https://stripe.test/invoice",
		});
		mocks.convexQuery.mockResolvedValue({
			expired: false,
			token: {
				type: "invoice",
				documentId: "invoice-123",
				siteUrl: "angelsrest.online",
			},
			document: {
				_id: "invoice-123",
				status: "sent",
				taxPercent: 10,
				items: [
					{ description: "Design work", quantity: 2, unitPrice: 12.5 },
					{ description: "Print credit", quantity: 1, unitPrice: 4.255 },
				],
			},
		});
		mocks.resolveStripeTenantForSite.mockResolvedValue({
			siteUrl: "angelsrest.online",
		});
	});

	it("creates a payment-mode checkout session from invoice lines and tax", async () => {
		const response = await POST(makeRequest({ token: "portal-token-123" }) as any);

		await expect(response.json()).resolves.toEqual({ url: "https://stripe.test/invoice" });
		expect(mocks.convexQuery).toHaveBeenCalledWith("portal.getByToken", {
			token: "portal-token-123",
		});

		const params = mocks.stripeSessionCreate.mock
			.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		const requestOptions = mocks.stripeSessionCreate.mock.calls[0]?.[1] as
			| Stripe.RequestOptions
			| undefined;

		const idempotencyKey = requestOptions?.idempotencyKey;
		expect(idempotencyKey).toBe(
			expectedIdempotencyKey({
				siteUrl: "angelsrest.online",
				invoiceId: "invoice-123",
				lineItemsCents: [
					{ description: "Design work", quantity: 2, unitPriceCents: 1250 },
					{ description: "Print credit", quantity: 1, unitPriceCents: 426 },
				],
				taxPercent: 10,
				taxCents: 293,
			}),
		);
		expect(idempotencyKey).not.toContain("portal-token-123");
		expect(mocks.resolveStripeTenantForSite).toHaveBeenCalledWith("angelsrest.online", {
			requirePlatformClient: true,
		});
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
		expect(params.payment_intent_data).toBeUndefined();
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
			expired: false,
			token: {
				type: "invoice",
				documentId: "invoice-123",
				siteUrl: "angelsrest.online",
			},
			document: {
				status: "paid",
				items: [],
			},
		});

		await expect(POST(makeRequest({ token: "portal-token-123" }) as any)).rejects.toMatchObject({
			status: 400,
		});
		expect(mocks.stripeSessionCreate).not.toHaveBeenCalled();
	});

	it("omits the tax line when invoice tax is zero", async () => {
		mocks.convexQuery.mockResolvedValueOnce({
			expired: false,
			token: {
				type: "invoice",
				documentId: "invoice-123",
				siteUrl: "angelsrest.online",
			},
			document: {
				_id: "invoice-123",
				status: "sent",
				taxPercent: 0,
				items: [{ description: "Design work", quantity: 1, unitPrice: 12.5 }],
			},
		});

		await POST(makeRequest({ token: "portal-token-123" }) as any);

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

	it("rejects requests missing a portal token before querying Convex", async () => {
		await expect(POST(makeRequest({}) as any)).rejects.toMatchObject({ status: 400 });

		expect(mocks.convexQuery).not.toHaveBeenCalled();
		expect(mocks.stripeSessionCreate).not.toHaveBeenCalled();
	});

	it("rejects legacy raw invoice id requests before querying Convex", async () => {
		await expect(POST(makeRequest({ invoiceId: "invoice-123" }) as any)).rejects.toMatchObject({
			status: 400,
		});

		expect(mocks.convexQuery).not.toHaveBeenCalled();
		expect(mocks.stripeSessionCreate).not.toHaveBeenCalled();
	});

	it("rejects unknown portal tokens before creating a Stripe session", async () => {
		mocks.convexQuery.mockResolvedValueOnce(null);

		await expect(POST(makeRequest({ token: "missing-token" }) as any)).rejects.toMatchObject({
			status: 404,
		});
		expect(mocks.stripeSessionCreate).not.toHaveBeenCalled();
	});

	it("rejects invalid invoice tax before creating a Stripe session", async () => {
		mocks.convexQuery.mockResolvedValueOnce({
			expired: false,
			token: {
				type: "invoice",
				documentId: "invoice-123",
				siteUrl: "angelsrest.online",
			},
			document: {
				status: "sent",
				taxPercent: 101,
				items: [{ description: "Design work", quantity: 1, unitPrice: 10 }],
			},
		});

		await expect(POST(makeRequest({ token: "portal-token-123" }) as any)).rejects.toMatchObject({
			status: 400,
		});
		expect(mocks.stripeSessionCreate).not.toHaveBeenCalled();
	});

	it("rejects non-invoice portal tokens before creating a Stripe session", async () => {
		mocks.convexQuery.mockResolvedValueOnce({
			expired: false,
			token: {
				type: "quote",
				documentId: "quote-123",
				siteUrl: "angelsrest.online",
			},
			document: {
				status: "sent",
				items: [],
			},
		});

		await expect(POST(makeRequest({ token: "quote-token" }) as any)).rejects.toMatchObject({
			status: 400,
		});
		expect(mocks.stripeSessionCreate).not.toHaveBeenCalled();
	});

	it("routes tenant invoices through the token site and connected Stripe account", async () => {
		mocks.convexQuery.mockResolvedValueOnce({
			expired: false,
			token: {
				type: "invoice",
				documentId: "invoice-tenant-123",
				siteUrl: "zippymiggy.com",
			},
			document: {
				_id: "invoice-tenant-123",
				status: "sent",
				taxPercent: 0,
				items: [{ description: "Session balance", quantity: 1, unitPrice: 100 }],
			},
		});
		mocks.resolveStripeTenantForSite.mockResolvedValueOnce({
			siteUrl: "zippymiggy.com",
			stripeConnectedAccountId: "acct_123",
		});

		await POST(makeRequest({ token: "tenant-token" }) as any);

		const params = mocks.stripeSessionCreate.mock
			.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		const requestOptions = mocks.stripeSessionCreate.mock.calls[0]?.[1] as Stripe.RequestOptions;

		expect(mocks.resolveStripeTenantForSite).toHaveBeenCalledWith("zippymiggy.com", {
			requirePlatformClient: true,
		});
		expect(params.metadata).toEqual({
			type: "invoice_payment",
			invoiceId: "invoice-tenant-123",
			siteUrl: "zippymiggy.com",
		});
		expect(params.payment_intent_data).toBeUndefined();
		expect(requestOptions).toEqual({
			stripeAccount: "acct_123",
			idempotencyKey: expectedIdempotencyKey({
				siteUrl: "zippymiggy.com",
				invoiceId: "invoice-tenant-123",
				lineItemsCents: [{ description: "Session balance", quantity: 1, unitPriceCents: 10000 }],
				taxPercent: 0,
				taxCents: 0,
			}),
		});
	});

	it("uses the same idempotency key for different tokens on the same invoice contents", async () => {
		await POST(makeRequest({ token: "first-token" }) as any);
		await POST(makeRequest({ token: "second-token" }) as any);

		const firstOptions = mocks.stripeSessionCreate.mock.calls[0]?.[1] as Stripe.RequestOptions;
		const secondOptions = mocks.stripeSessionCreate.mock.calls[1]?.[1] as Stripe.RequestOptions;

		expect(firstOptions.idempotencyKey).toBe(secondOptions.idempotencyKey);
		expect(firstOptions.idempotencyKey).not.toContain("first-token");
		expect(secondOptions.idempotencyKey).not.toContain("second-token");
	});
});
