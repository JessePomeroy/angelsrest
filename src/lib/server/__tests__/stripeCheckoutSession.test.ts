import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "$env/dynamic/private";
import {
	buildCheckoutLineItem,
	createPaymentCheckoutSession,
} from "$lib/server/stripeCheckoutSession";

const runtimeEnv = env as Record<string, string | undefined>;

afterEach(() => {
	runtimeEnv.ORDER_PRODUCERS_STATE = "open";
});

function makeStripe() {
	const create = vi.fn().mockResolvedValue({ id: "cs_test_123", url: "https://stripe.test/pay" });
	const stripe = {
		checkout: {
			sessions: { create },
		},
	} as unknown as Stripe;
	return { stripe, create };
}

describe("buildCheckoutLineItem", () => {
	it("builds Stripe line items with optional image, description, and quantity", () => {
		expect(
			buildCheckoutLineItem({
				name: "Archival print",
				description: "8x10 glossy",
				imageUrl: "https://cdn.example/print.jpg",
				unitAmountCents: 4200,
				quantity: 2,
			}),
		).toEqual({
			price_data: {
				currency: "usd",
				product_data: {
					name: "Archival print",
					description: "8x10 glossy",
					images: ["https://cdn.example/print.jpg"],
				},
				unit_amount: 4200,
			},
			quantity: 2,
		});
	});
});

describe("createPaymentCheckoutSession", () => {
	it.each([
		["missing", undefined],
		["explicit closed", "closed"],
		["invalid", "true"],
		["malformed", " open "],
		["unknown", "paused"],
	] as const)("rejects %s order-producer state before Stripe", async (_label, state) => {
		runtimeEnv.ORDER_PRODUCERS_STATE = state;
		const { stripe, create } = makeStripe();

		await expect(
			createPaymentCheckoutSession({
				stripe,
				lineItems: [],
				successUrl: "https://example.test/success",
				cancelUrl: "https://example.test/cancel",
				metadata: {},
			}),
		).rejects.toThrow("Order producers are closed");
		expect(create).not.toHaveBeenCalled();
	});

	it("fails closed on metadata outside Stripe programming limits", async () => {
		const { stripe, create } = makeStripe();
		await expect(
			createPaymentCheckoutSession({
				stripe,
				lineItems: [],
				successUrl: "https://example.test/success",
				cancelUrl: "https://example.test/cancel",
				metadata: { invalid: "x".repeat(501) },
			}),
		).rejects.toThrow("Invalid Stripe metadata");
		expect(create).not.toHaveBeenCalled();
	});

	it("creates a payment checkout session only for the explicit open state", async () => {
		runtimeEnv.ORDER_PRODUCERS_STATE = "open";
		const { stripe, create } = makeStripe();

		const result = await createPaymentCheckoutSession({
			stripe,
			shippingAllowedCountries: ["US", "CA"],
			lineItems: [
				buildCheckoutLineItem({
					name: "Archival print",
					unitAmountCents: 4200,
				}),
			],
			successUrl: "https://example.com/success?session_id={CHECKOUT_SESSION_ID}",
			cancelUrl: "https://example.com/cancel",
			metadata: { productSlug: "archival-print" },
			idempotencyKey: "checkout:archival-print:123",
			tenantCheckout: {
				session: {
					payment_intent_data: {
						application_fee_amount: 210,
						metadata: { commerceTenantSiteUrl: "zippymiggy.com" },
					},
				},
				metadata: { commerceTenantSiteUrl: "zippymiggy.com" },
				requestOptions: { stripeAccount: "acct_123" },
				platformFeeAmount: 210,
			},
		});

		expect(result).toEqual({ sessionId: "cs_test_123", url: "https://stripe.test/pay" });
		expect(create).toHaveBeenCalledWith(
			{
				payment_method_types: ["card"],
				shipping_address_collection: { allowed_countries: ["US", "CA"] },
				line_items: [
					{
						price_data: {
							currency: "usd",
							product_data: {
								name: "Archival print",
								images: [],
							},
							unit_amount: 4200,
						},
						quantity: 1,
					},
				],
				mode: "payment",
				success_url: "https://example.com/success?session_id={CHECKOUT_SESSION_ID}",
				cancel_url: "https://example.com/cancel",
				metadata: {
					productSlug: "archival-print",
					commerceTenantSiteUrl: "zippymiggy.com",
				},
				payment_intent_data: {
					application_fee_amount: 210,
					metadata: { commerceTenantSiteUrl: "zippymiggy.com" },
				},
			},
			{
				stripeAccount: "acct_123",
				idempotencyKey: "checkout:archival-print:123",
			},
		);
	});
});
