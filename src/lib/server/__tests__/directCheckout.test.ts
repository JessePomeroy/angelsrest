import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedCheckoutItem } from "$lib/server/checkoutCatalog";
import { createDirectCheckoutSession } from "$lib/server/directCheckout";

const fetcher = vi.fn();

function makeStripe() {
	const create = vi.fn().mockResolvedValue({ id: "cs_test_123", url: "https://stripe.test/pay" });
	const stripe = {
		checkout: {
			sessions: { create },
		},
	} as unknown as Stripe;
	return { stripe, create };
}

function makeItem(overrides: Partial<ResolvedCheckoutItem> = {}): ResolvedCheckoutItem {
	return {
		productId: "print-one",
		title: "Print One",
		price: 42,
		productCategory: "prints",
		isDigital: false,
		isPrintSet: false,
		image: "https://cdn.example/print.jpg",
		images: [],
		paper: {
			name: "Archival Matte",
			subcategoryId: 103001,
			width: 8,
			height: 10,
			borderWidth: 0.25,
			frameSubcategoryId: 105001,
		},
		...overrides,
	};
}

describe("createDirectCheckoutSession", () => {
	it("creates a physical checkout session with server-resolved metadata", async () => {
		const { stripe, create } = makeStripe();
		const bindSession = vi.fn();
		const resolveItem = vi.fn().mockResolvedValue(makeItem());

		const result = await createDirectCheckoutSession({
			body: { productId: "print-one", paperSlug: "archival-matte", sizeSlug: "8x10" },
			stripe,
			siteUrl: "https://angelsrest.test",
			fetcher,
			bindSession,
			resolveItem,
			log: vi.fn(),
		});

		expect(result).toEqual({ sessionId: "cs_test_123", url: "https://stripe.test/pay" });
		expect(bindSession).toHaveBeenCalledWith("cs_test_123");
		expect(resolveItem).toHaveBeenCalledWith({
			productId: "print-one",
			paperSlug: "archival-matte",
			sizeSlug: "8x10",
		});

		const params = create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		const requestOptions = create.mock.calls[0]?.[1] as Stripe.RequestOptions | undefined;
		expect(params.shipping_address_collection).toEqual({ allowed_countries: ["US"] });
		expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(4200);
		expect(params.payment_intent_data).toEqual({
			metadata: { commerceTenantSiteUrl: "angelsrest.test" },
		});
		expect(requestOptions).toBeUndefined();
		expect(params.success_url).toBe(
			"https://angelsrest.test/checkout/success?session_id={CHECKOUT_SESSION_ID}",
		);
		expect(params.metadata).toMatchObject({
			commerceTenantSiteUrl: "angelsrest.test",
			productId: "print-one",
			productSlug: "print-one",
			isDigital: "false",
			paperName: "Archival Matte",
			paperSubcategoryId: "103001",
			borderWidth: "0.25",
			frameSubcategoryId: "105001",
			originalPrice: "42",
			discountAmount: "0",
		});
	});

	it("adds connected-account routing and print platform fee when tenant account is present", async () => {
		const { stripe, create } = makeStripe();

		await createDirectCheckoutSession({
			body: { productId: "print-one" },
			stripe,
			siteUrl: "https://zippymiggy.test",
			tenant: {
				siteUrl: "zippymiggy.com",
				stripeConnectedAccountId: "acct_123",
			},
			fetcher,
			bindSession: vi.fn(),
			resolveItem: vi.fn().mockResolvedValue(makeItem({ price: 100 })),
			log: vi.fn(),
		});

		const params = create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		const requestOptions = create.mock.calls[0]?.[1] as Stripe.RequestOptions | undefined;
		expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(10_000);
		expect(params.payment_intent_data).toEqual({
			application_fee_amount: 500,
			metadata: { commerceTenantSiteUrl: "zippymiggy.com" },
		});
		expect(params.metadata).toMatchObject({
			commerceTenantSiteUrl: "zippymiggy.com",
		});
		expect(requestOptions).toEqual({ stripeAccount: "acct_123" });
	});

	it("preserves V2 print-set fulfillment metadata", async () => {
		const { stripe, create } = makeStripe();
		const images = ["https://cdn.example/set-a.jpg", "https://cdn.example/set-b.jpg"];

		await createDirectCheckoutSession({
			body: { productId: "current-set", isPrintSet: true },
			stripe,
			siteUrl: "https://angelsrest.test",
			fetcher,
			bindSession: vi.fn(),
			resolveItem: vi.fn().mockResolvedValue(
				makeItem({
					productId: "current-set",
					productCategory: "print-set",
					isPrintSet: true,
					image: "https://cdn.example/set-preview.jpg",
					images,
				}),
			),
			log: vi.fn(),
		});

		const params = create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		expect(params.metadata).toMatchObject({
			isPrintSet: "true",
			imageUrls: JSON.stringify(images),
			imageUrl: "",
		});
	});

	it("does not add a platform fee for connected-account digital checkout", async () => {
		const { stripe, create } = makeStripe();

		await createDirectCheckoutSession({
			body: { productId: "digital-one" },
			stripe,
			siteUrl: "https://zippymiggy.test",
			tenant: {
				siteUrl: "zippymiggy.com",
				stripeConnectedAccountId: "acct_123",
			},
			fetcher,
			bindSession: vi.fn(),
			resolveItem: vi.fn().mockResolvedValue(
				makeItem({
					productId: "digital-one",
					isDigital: true,
					paper: null,
				}),
			),
			log: vi.fn(),
		});

		const params = create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		const requestOptions = create.mock.calls[0]?.[1] as Stripe.RequestOptions | undefined;
		expect(params.payment_intent_data).toEqual({
			metadata: { commerceTenantSiteUrl: "zippymiggy.com" },
		});
		expect(requestOptions).toEqual({ stripeAccount: "acct_123" });
	});

	it("applies coupons before creating Stripe line item amounts", async () => {
		const { stripe, create } = makeStripe();
		const validateCoupon = vi
			.fn()
			.mockResolvedValue({ discountAmount: 7.5, appliedCoupon: "SUMMER" });

		await createDirectCheckoutSession({
			body: { productId: "print-one", coupon: "summer" },
			stripe,
			siteUrl: "https://angelsrest.test",
			fetcher,
			bindSession: vi.fn(),
			resolveItem: vi.fn().mockResolvedValue(makeItem()),
			validateCoupon,
			log: vi.fn(),
		});

		expect(validateCoupon).toHaveBeenCalledWith("summer", "print-one", "prints", 42);
		const params = create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(3450);
		expect(params.metadata).toMatchObject({
			couponCode: "SUMMER",
			originalPrice: "42",
			discountAmount: "7.5",
		});
	});

	it("does not collect shipping for digital products", async () => {
		const { stripe, create } = makeStripe();

		await createDirectCheckoutSession({
			body: { productId: "digital-one" },
			stripe,
			siteUrl: "https://angelsrest.test",
			fetcher,
			bindSession: vi.fn(),
			resolveItem: vi.fn().mockResolvedValue(
				makeItem({
					productId: "digital-one",
					isDigital: true,
					paper: null,
				}),
			),
			log: vi.fn(),
		});

		const params = create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		expect(params.shipping_address_collection).toBeUndefined();
		expect(params.metadata).toMatchObject({
			productId: "digital-one",
			isDigital: "true",
			paperSubcategoryId: "",
		});
	});

	it("rejects requests without a product id before resolving or creating Stripe sessions", async () => {
		const { stripe, create } = makeStripe();
		const resolveItem = vi.fn();

		await expect(
			createDirectCheckoutSession({
				body: {},
				stripe,
				siteUrl: "https://angelsrest.test",
				fetcher,
				bindSession: vi.fn(),
				resolveItem,
				log: vi.fn(),
			}),
		).rejects.toMatchObject({ status: 400 });

		expect(resolveItem).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
	});
});
