import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
	CheckoutBridgeError,
	createTenantPrintCheckoutSession,
	signCheckoutBridgeBody,
} from "../checkoutBridge";

const SECRET = "checkout-bridge-secret";
const NOW = 1_800_000_000_000;

function makeBody(overrides: Record<string, unknown> = {}) {
	return JSON.stringify({
		siteUrl: "zippymiggy.com",
		amountCents: 10_000,
		productName: "Digital Headshot Print",
		productDescription: "Archival Matte print, 8x10 inches",
		imageUrl: "https://cdn.example/print.jpg",
		successUrl: "https://zippymiggy.com/shop/success?session_id={CHECKOUT_SESSION_ID}",
		cancelUrl: "https://zippymiggy.com/shop/cancelled",
		metadata: {
			imageUrl: "https://cdn.example/print.jpg",
			imageTitle: "Digital Headshot",
			paperSubcategoryId: "103001",
			paperWidth: "8",
			paperHeight: "10",
			paperName: "Archival Matte",
			paperSizeLabel: "8x10",
			productSlug: "digital-headshot",
		},
		...overrides,
	});
}

function makeHeaders(bodyText: string, timestamp = NOW) {
	return new Headers({
		"x-checkout-bridge-timestamp": String(timestamp),
		"x-checkout-bridge-signature": signCheckoutBridgeBody({
			bodyText,
			secret: SECRET,
			timestamp,
		}),
	});
}

function makeStripe() {
	const create = vi.fn().mockResolvedValue({ id: "cs_test_123", url: "https://stripe.test/pay" });
	const stripe = {
		checkout: {
			sessions: { create },
		},
	} as unknown as Stripe;
	return { stripe, create };
}

describe("checkout bridge", () => {
	it("creates a connected-account print checkout with the platform fee", async () => {
		const bodyText = makeBody();
		const { stripe, create } = makeStripe();

		const result = await createTenantPrintCheckoutSession({
			bodyText,
			headers: makeHeaders(bodyText),
			stripe,
			tenant: {
				siteUrl: "zippymiggy.com",
				stripeConnectedAccountId: "acct_123",
			},
			secrets: [SECRET],
			allowedRedirectOrigins: ["https://zippymiggy.com"],
			now: NOW,
		});

		expect(result).toEqual({
			sessionId: "cs_test_123",
			url: "https://stripe.test/pay",
			platformFeeAmount: 500,
		});

		const params = create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		const requestOptions = create.mock.calls[0]?.[1] as Stripe.RequestOptions | undefined;
		expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(10_000);
		expect(params.success_url).toBe(
			"https://zippymiggy.com/shop/success?session_id={CHECKOUT_SESSION_ID}",
		);
		expect(params.payment_intent_data).toEqual({
			application_fee_amount: 500,
			metadata: { commerceTenantSiteUrl: "zippymiggy.com" },
		});
		expect(params.metadata).toMatchObject({
			productSlug: "digital-headshot",
			paperSubcategoryId: "103001",
			commerceTenantSiteUrl: "zippymiggy.com",
		});
		expect(requestOptions).toEqual({ stripeAccount: "acct_123" });
	});

	it("rejects a missing signature", async () => {
		const { stripe } = makeStripe();

		await expect(
			createTenantPrintCheckoutSession({
				bodyText: makeBody(),
				headers: new Headers(),
				stripe,
				tenant: { siteUrl: "zippymiggy.com" },
				secrets: [SECRET],
				allowedRedirectOrigins: ["https://zippymiggy.com"],
				now: NOW,
			}),
		).rejects.toMatchObject(new CheckoutBridgeError(401, "Missing checkout bridge signature"));
	});

	it("rejects an expired signature", async () => {
		const bodyText = makeBody();
		const { stripe } = makeStripe();
		const oldTimestamp = NOW - 301_000;

		await expect(
			createTenantPrintCheckoutSession({
				bodyText,
				headers: makeHeaders(bodyText, oldTimestamp),
				stripe,
				tenant: { siteUrl: "zippymiggy.com" },
				secrets: [SECRET],
				allowedRedirectOrigins: ["https://zippymiggy.com"],
				now: NOW,
			}),
		).rejects.toMatchObject(new CheckoutBridgeError(401, "Expired checkout bridge signature"));
	});

	it("rejects a body signed for a different payload", async () => {
		const signedBody = makeBody();
		const tamperedBody = makeBody({ amountCents: 20_000 });
		const { stripe } = makeStripe();

		await expect(
			createTenantPrintCheckoutSession({
				bodyText: tamperedBody,
				headers: makeHeaders(signedBody),
				stripe,
				tenant: { siteUrl: "zippymiggy.com" },
				secrets: [SECRET],
				allowedRedirectOrigins: ["https://zippymiggy.com"],
				now: NOW,
			}),
		).rejects.toMatchObject(new CheckoutBridgeError(401, "Invalid checkout bridge signature"));
	});

	it("rejects siteUrl mismatches after signature verification", async () => {
		const bodyText = makeBody({ siteUrl: "other-client.com" });
		const { stripe } = makeStripe();

		await expect(
			createTenantPrintCheckoutSession({
				bodyText,
				headers: makeHeaders(bodyText),
				stripe,
				tenant: { siteUrl: "zippymiggy.com" },
				secrets: [SECRET],
				allowedRedirectOrigins: ["https://zippymiggy.com"],
				now: NOW,
			}),
		).rejects.toMatchObject(new CheckoutBridgeError(400, "Tenant siteUrl mismatch"));
	});

	it("accepts either bounded tenant secret during rotation", async () => {
		const bodyText = makeBody();
		const { stripe } = makeStripe();

		await expect(
			createTenantPrintCheckoutSession({
				bodyText,
				headers: makeHeaders(bodyText),
				stripe,
				tenant: { siteUrl: "zippymiggy.com" },
				secrets: ["new-tenant-secret".repeat(2), SECRET],
				allowedRedirectOrigins: ["https://zippymiggy.com"],
				now: NOW,
			}),
		).resolves.toMatchObject({ sessionId: "cs_test_123" });
	});

	it("allows an explicit public redirect origin that differs from the tenant key", async () => {
		const publicOrigin = "https://reflecting-pool.vercel.app";
		const bodyText = makeBody({
			successUrl: `${publicOrigin}/shop/success?session_id={CHECKOUT_SESSION_ID}`,
			cancelUrl: `${publicOrigin}/shop/cancelled`,
		});
		const { stripe } = makeStripe();

		await expect(
			createTenantPrintCheckoutSession({
				bodyText,
				headers: makeHeaders(bodyText),
				stripe,
				tenant: { siteUrl: "zippymiggy.com" },
				secrets: [SECRET],
				allowedRedirectOrigins: [publicOrigin],
				now: NOW,
			}),
		).resolves.toMatchObject({ sessionId: "cs_test_123" });
	});

	it("rejects a signature that belongs to another tenant", async () => {
		const bodyText = makeBody();
		const { stripe } = makeStripe();

		await expect(
			createTenantPrintCheckoutSession({
				bodyText,
				headers: makeHeaders(bodyText),
				stripe,
				tenant: { siteUrl: "zippymiggy.com" },
				secrets: ["other-tenant-secret".repeat(2)],
				allowedRedirectOrigins: ["https://zippymiggy.com"],
				now: NOW,
			}),
		).rejects.toMatchObject(new CheckoutBridgeError(401, "Invalid checkout bridge signature"));
	});

	it.each(["successUrl", "cancelUrl"])("rejects an unlisted %s origin", async (field) => {
		const bodyText = makeBody({ [field]: "https://attacker.example/checkout" });
		const { stripe, create } = makeStripe();

		await expect(
			createTenantPrintCheckoutSession({
				bodyText,
				headers: makeHeaders(bodyText),
				stripe,
				tenant: { siteUrl: "zippymiggy.com" },
				secrets: [SECRET],
				allowedRedirectOrigins: ["https://zippymiggy.com"],
				now: NOW,
			}),
		).rejects.toMatchObject(new CheckoutBridgeError(400, `Disallowed ${field} origin`));
		expect(create).not.toHaveBeenCalled();
	});
});
