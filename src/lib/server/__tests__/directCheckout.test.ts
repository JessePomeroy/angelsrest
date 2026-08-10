import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedCheckoutItem } from "$lib/server/checkoutCatalog";
import { createDirectCheckoutSession } from "$lib/server/directCheckout";

const fetcher = vi.fn();
const ATTEMPT = "123e4567-e89b-42d3-a456-426614174000";
const ATTEMPT_STARTED_AT = Date.parse("2026-01-01T00:00:00Z");

function admissionOptions() {
	const bind = vi.fn();
	return {
		attemptIdentity: {
			attempt: ATTEMPT,
			attemptStartedAt: ATTEMPT_STARTED_AT,
			proofClass: "same_origin_host_proof" as const,
		},
		hostGeneration: 1,
		admissionClient: {
			begin: vi.fn().mockResolvedValue({
				site: "angelsrest.test",
				account: null,
				admissionId: "admission_123",
				handleHash: "a".repeat(64),
				requestFingerprint: "b".repeat(64),
				activeLeaseTokenHash: "c".repeat(64),
				stripeIdempotencyDigest: "d".repeat(64),
				stripeIdempotencyKey: `checkout-admission-v1:${"d".repeat(64)}`,
				hostGeneration: 1,
				admissionGeneration: 1,
				state: "active_prestripe",
			}),
			markCreating: vi.fn().mockResolvedValue(Math.floor(ATTEMPT_STARTED_AT / 1000) + 86_100),
			markUncertain: vi.fn(),
			bind,
			release: vi.fn(),
		},
	};
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

function makeItem(overrides: Partial<ResolvedCheckoutItem> = {}): ResolvedCheckoutItem {
	return {
		productId: "print-one",
		title: "Print One",
		unitPriceCents: 4200,
		productCategory: "prints",
		publicImage: "https://cdn.example/print.jpg",
		snapshot: {
			productKey: "published-print-one",
			revisionId: "print-one-rev",
			productKind: "print",
			variantKey: "variant-one",
			materialOptionKey: "archival-matte",
			sizeOptionKey: "8x10",
			borderOptionKey: "0.25",
			frameOptionKey: "0.875-black",
		},
		legacyFulfillment: {
			isDigital: false,
			isPrintSet: false,
			imageUrl: "https://cdn.example/print.jpg",
			imageUrls: [],
			paper: {
				name: "Archival Matte",
				subcategoryId: 103001,
				width: 8,
				height: 10,
				borderWidth: 0.25,
				frameSubcategoryId: 105001,
			},
		},
		...overrides,
	};
}

describe("createDirectCheckoutSession", () => {
	it.each([
		["absent", {}],
		["null", { coupon: null }],
		["empty", { coupon: "" }],
	])("creates a physical checkout with %s no-coupon input", async (_label, coupon) => {
		const { stripe, create } = makeStripe();
		const bindSession = vi.fn();
		const resolveItem = vi.fn().mockResolvedValue(makeItem());
		const reservationClient = { reserve: vi.fn(), bind: vi.fn() };
		const resolveCommerce = vi.fn();
		const admission = admissionOptions();

		const result = await createDirectCheckoutSession({
			body: {
				productId: "print-one",
				paperSlug: "archival-matte",
				sizeSlug: "8x10",
				...coupon,
			},
			stripe,
			siteUrl: "https://angelsrest.test",
			fetcher,
			bindSession,
			resolveItem,
			resolveCommerce,
			log: vi.fn(),
			snapshotMode: "invalid-mode",
			reservationClient,
			...admission,
		});

		expect(result).toEqual({
			sessionId: "cs_test_123",
			url: "https://stripe.test/pay",
			expiresAt: Math.floor(ATTEMPT_STARTED_AT / 1000) + 86_100,
		});
		expect(reservationClient.reserve).not.toHaveBeenCalled();
		expect(resolveCommerce).not.toHaveBeenCalled();
		expect(bindSession).toHaveBeenCalledWith("cs_test_123");
		expect(resolveItem).toHaveBeenCalledWith({
			productId: "print-one",
			paperSlug: "archival-matte",
			sizeSlug: "8x10",
			...coupon,
		});

		const params = create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		const requestOptions = create.mock.calls[0]?.[1] as Stripe.RequestOptions | undefined;
		expect(params.shipping_address_collection).toEqual({ allowed_countries: ["US"] });
		expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(4200);
		expect(params.payment_intent_data).toEqual({
			metadata: { commerceTenantSiteUrl: "angelsrest.test" },
		});
		expect(requestOptions?.idempotencyKey).toBe(`checkout-admission-v1:${"d".repeat(64)}`);
		expect(params.success_url).toBe(
			"https://angelsrest.test/checkout/success?session_id={CHECKOUT_SESSION_ID}",
		);
		expect(params.metadata).toMatchObject({
			checkoutAdmissionVersion: "1",
			checkoutAdmissionHandleHash: "a".repeat(64),
			commerceTenantSiteUrl: "angelsrest.test",
			productId: "print-one",
			productSlug: "print-one",
			isDigital: "false",
			paperName: "Archival Matte",
			paperSubcategoryId: "103001",
			borderWidth: "0.25",
			frameSubcategoryId: "105001",
			couponCode: "",
			originalPrice: "42",
			discountAmount: "0",
		});
	});

	it("preserves reservation and handle metadata for no-coupon checkout", async () => {
		const { stripe, create } = makeStripe();
		const reservationClient = {
			reserve: vi.fn().mockResolvedValue({ handle: "223e4567-e89b-42d3-a456-426614174000" }),
			bind: vi.fn(),
		};
		const bindSession = vi.fn();
		const now = Date.parse("2026-01-01T00:00:00Z");
		const resolveItem = vi.fn();
		const admission = admissionOptions();
		await createDirectCheckoutSession({
			body: {
				productId: "print-one",
				coupon: null,
				attempt: ATTEMPT,
				attemptStartedAt: now,
			},
			stripe,
			siteUrl: "https://angelsrest.test",
			fetcher,
			bindSession,
			resolveItem,
			resolveCommerce: vi.fn().mockResolvedValue({ provider: "convex", items: [makeItem()] }),
			log: vi.fn(),
			snapshotMode: "handle-v2",
			reservationClient,
			...admission,
			now,
		});
		expect(resolveItem).not.toHaveBeenCalled();
		expect(reservationClient.reserve).toHaveBeenCalledWith(
			expect.objectContaining({
				catalogProvider: "convex",
				items: [makeItem().snapshot],
			}),
		);
		expect(admission.admissionClient.bind).toHaveBeenCalledBefore(bindSession);
		const params = create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(4200);
		expect(params.metadata).toEqual({
			checkoutSnapshotVersion: "2",
			checkoutSnapshotHandle: "223e4567-e89b-42d3-a456-426614174000",
			checkoutAdmissionVersion: "1",
			checkoutAdmissionHandleHash: "a".repeat(64),
			commerceTenantSiteUrl: "angelsrest.test",
		});
	});

	it("fails catalog authority before reservation or Stripe", async () => {
		const { stripe, create } = makeStripe();
		const reservationClient = { reserve: vi.fn(), bind: vi.fn() };
		const bindSession = vi.fn();
		const admission = admissionOptions();
		await expect(
			createDirectCheckoutSession({
				body: {
					productId: "print-one",
					attempt: "123e4567-e89b-42d3-a456-426614174000",
					attemptStartedAt: Date.now(),
				},
				stripe,
				siteUrl: "https://angelsrest.test",
				fetcher,
				bindSession,
				resolveCommerce: vi.fn().mockRejectedValue(new Error("catalog closed")),
				log: vi.fn(),
				snapshotMode: "handle-v2",
				reservationClient,
				...admission,
			}),
		).rejects.toThrow("catalog closed");
		expect(reservationClient.reserve).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
		expect(bindSession).not.toHaveBeenCalled();
	});

	it.each([
		"legacy",
		"handle-v2",
	])("rejects every coupon shape before effects in %s mode", async (snapshotMode) => {
		for (const coupon of ["SUMMER", " ", {}, 42, [], ["SUMMER"], true]) {
			const { stripe, create } = makeStripe();
			const resolveItem = vi.fn();
			const sanityFetch = vi.fn();
			const reservationClient = { reserve: vi.fn(), bind: vi.fn() };
			const bindSession = vi.fn();
			const log = vi.fn();
			const admission = admissionOptions();

			await expect(
				createDirectCheckoutSession({
					body: { productId: "print-one", coupon },
					stripe,
					siteUrl: "https://angelsrest.test",
					fetcher: sanityFetch,
					bindSession,
					resolveItem,
					log,
					snapshotMode,
					reservationClient,
					...admission,
				}),
			).rejects.toMatchObject({
				status: 400,
				body: { code: "INVALID_COUPON", message: "Coupons are not accepted" },
			});
			expect(resolveItem).not.toHaveBeenCalled();
			expect(sanityFetch).not.toHaveBeenCalled();
			expect(reservationClient.reserve).not.toHaveBeenCalled();
			expect(reservationClient.bind).not.toHaveBeenCalled();
			expect(create).not.toHaveBeenCalled();
			expect(bindSession).not.toHaveBeenCalled();
			expect(log).not.toHaveBeenCalled();
		}
	});

	it("rejects requests without a product id before resolving or creating Stripe sessions", async () => {
		const { stripe, create } = makeStripe();
		const resolveItem = vi.fn();
		const admission = admissionOptions();

		await expect(
			createDirectCheckoutSession({
				body: {},
				stripe,
				siteUrl: "https://angelsrest.test",
				fetcher,
				bindSession: vi.fn(),
				resolveItem,
				log: vi.fn(),
				...admission,
			}),
		).rejects.toMatchObject({ status: 400 });

		expect(resolveItem).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
	});
});
