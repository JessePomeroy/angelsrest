import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
	buildCheckoutLineItem,
	createPaymentCheckoutSession,
} from "$lib/server/stripeCheckoutSession";

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

	it("defaults quantity and omits empty optional product fields", () => {
		expect(
			buildCheckoutLineItem({
				name: "Digital file",
				unitAmountCents: 1200,
			}),
		).toEqual({
			price_data: {
				currency: "usd",
				product_data: {
					name: "Digital file",
					images: [],
				},
				unit_amount: 1200,
			},
			quantity: 1,
		});
	});
});

describe("createPaymentCheckoutSession", () => {
	it("creates a payment checkout session with shipping and tenant options", async () => {
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
					payment_intent_data: { application_fee_amount: 210 },
				},
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
				metadata: { productSlug: "archival-print" },
				payment_intent_data: { application_fee_amount: 210 },
			},
			{
				stripeAccount: "acct_123",
				idempotencyKey: "checkout:archival-print:123",
			},
		);
	});
});
