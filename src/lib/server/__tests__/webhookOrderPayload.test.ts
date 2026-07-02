import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { buildConvexOrderCreatePayload } from "$lib/server/webhookOrderPayload";

function makeSession(overrides?: Partial<Stripe.Checkout.Session>): Stripe.Checkout.Session {
	return {
		id: "cs_test_123",
		amount_total: 5000,
		amount_subtotal: 4500,
		payment_intent: "pi_test_123",
		customer_details: {
			name: "Jane Doe",
			email: "jane@example.com",
		},
		metadata: {
			paperName: "Archival Matte",
			paperSubcategoryId: "103001",
		},
		...overrides,
	} as unknown as Stripe.Checkout.Session;
}

function makeLineItem(overrides?: Partial<Stripe.LineItem>): Stripe.LineItem {
	return {
		id: "li_test_123",
		object: "item",
		amount_discount: 0,
		amount_subtotal: 2500,
		amount_tax: 0,
		amount_total: 2500,
		currency: "usd",
		description: "8x10 print",
		price: {
			id: "price_test_123",
			object: "price",
			unit_amount: 2500,
		},
		quantity: 2,
		...overrides,
	} as unknown as Stripe.LineItem;
}

describe("buildConvexOrderCreatePayload", () => {
	it("maps Stripe checkout sessions into Convex order create args", () => {
		const payload = buildConvexOrderCreatePayload({
			session: makeSession(),
			shippingDetails: {
				name: "Jane Ship",
				address: {
					line1: "123 Main St",
					line2: null,
					city: "Portland",
					state: "OR",
					postal_code: "97201",
					country: "US",
				},
			},
			lineItems: [makeLineItem()],
			siteUrl: "angelsrest.online",
			webhookSecret: "secret",
		});

		expect(payload).toEqual({
			webhookSecret: "secret",
			siteUrl: "angelsrest.online",
			stripeSessionId: "cs_test_123",
			customerEmail: "jane@example.com",
			customerName: "Jane Doe",
			stripePaymentIntentId: "pi_test_123",
			shippingAddress: {
				line1: "123 Main St",
				line2: undefined,
				city: "Portland",
				state: "OR",
				postalCode: "97201",
				country: "US",
			},
			items: [
				{
					productName: "8x10 print",
					quantity: 2,
					price: 2500,
				},
			],
			total: 5000,
			subtotal: 4500,
			fulfillmentType: "self",
			paperName: "Archival Matte",
			paperSubcategoryId: "103001",
		});
	});

	it("handles expanded payment intents and digital orders", () => {
		const payload = buildConvexOrderCreatePayload({
			session: makeSession({
				payment_intent: { id: "pi_expanded_123" } as Stripe.PaymentIntent,
				metadata: { isDigital: "true" },
			}),
			shippingDetails: null,
			lineItems: [],
			siteUrl: "angelsrest.online",
			webhookSecret: "secret",
		});

		expect(payload.stripePaymentIntentId).toBe("pi_expanded_123");
		expect(payload.fulfillmentType).toBe("digital");
		expect(payload.shippingAddress).toBeUndefined();
	});

	it("falls back for missing customer, line item, and amount details", () => {
		const payload = buildConvexOrderCreatePayload({
			session: makeSession({
				amount_total: null,
				amount_subtotal: 0,
				customer_details: {
					email: null,
					name: null,
				} as Stripe.Checkout.Session.CustomerDetails,
				metadata: {},
				payment_intent: null,
			}),
			shippingDetails: {
				name: "Fallback Name",
				address: null as unknown as Stripe.Address,
			},
			lineItems: [
				makeLineItem({
					amount_total: null as unknown as number,
					description: null as unknown as string,
					price: { unit_amount: 1800 } as Stripe.Price,
					quantity: null as unknown as number,
				}),
			],
			siteUrl: "angelsrest.online",
			webhookSecret: "secret",
		});

		expect(payload).toMatchObject({
			customerEmail: "",
			customerName: "Fallback Name",
			stripePaymentIntentId: undefined,
			shippingAddress: undefined,
			items: [
				{
					productName: "Unknown Product",
					quantity: 1,
					price: 1800,
				},
			],
			total: 0,
			subtotal: undefined,
		});
	});
});
