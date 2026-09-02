import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedCheckoutItem } from "$lib/server/checkoutCatalog";
import { createDirectCheckoutSession } from "$lib/server/directCheckout";

const ATTEMPT = "123e4567-e89b-42d3-a456-426614174000";
const ATTEMPT_STARTED_AT = Date.parse("2026-01-01T00:00:00Z");
const SNAPSHOT_HANDLE = "223e4567-e89b-42d3-a456-426614174000";

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

function reservationOptions() {
	return {
		reservationClient: {
			reserve: vi.fn().mockResolvedValue({ handle: SNAPSHOT_HANDLE }),
			bind: vi.fn(),
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
	])("creates a Convex snapshot checkout with %s no-coupon input", async (_label, coupon) => {
		const { stripe, create } = makeStripe();
		const bindSession = vi.fn();
		const item = makeItem();
		const resolveCommerce = vi.fn().mockResolvedValue({ provider: "convex", items: [item] });
		const reservation = reservationOptions();
		const admission = admissionOptions();
		const body = {
			productId: "print-one",
			paperSlug: "archival-matte",
			sizeSlug: "8x10",
			...coupon,
		};

		const result = await createDirectCheckoutSession({
			body,
			stripe,
			siteUrl: "https://angelsrest.test",
			bindSession,
			resolveCommerce,
			log: vi.fn(),
			...reservation,
			...admission,
			now: ATTEMPT_STARTED_AT,
		});

		expect(result).toEqual({
			sessionId: "cs_test_123",
			url: "https://stripe.test/pay",
			expiresAt: Math.floor(ATTEMPT_STARTED_AT / 1000) + 86_100,
		});
		expect(resolveCommerce).toHaveBeenCalledWith([body]);
		expect(reservation.reservationClient.reserve).toHaveBeenCalledWith({
			site: "angelsrest.test",
			attempt: ATTEMPT,
			account: null,
			catalogProvider: "convex",
			items: [item.snapshot],
		});
		expect(admission.admissionClient.bind).toHaveBeenCalledBefore(bindSession);

		const params = create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		const requestOptions = create.mock.calls[0]?.[1] as Stripe.RequestOptions | undefined;
		expect(params.shipping_address_collection).toEqual({ allowed_countries: ["US"] });
		expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(4200);
		expect(params.payment_intent_data).toEqual({
			metadata: { commerceTenantSiteUrl: "angelsrest.test" },
		});
		expect(requestOptions?.idempotencyKey).toBe(`checkout-admission-v1:${"d".repeat(64)}`);
		expect(params.metadata).toEqual({
			checkoutSnapshotVersion: "2",
			checkoutSnapshotHandle: SNAPSHOT_HANDLE,
			checkoutAdmissionVersion: "1",
			checkoutAdmissionHandleHash: "a".repeat(64),
			commerceTenantSiteUrl: "angelsrest.test",
		});
	});

	it("fails catalog authority before reservation, admission, or Stripe", async () => {
		const { stripe, create } = makeStripe();
		const bindSession = vi.fn();
		const reservation = reservationOptions();
		const admission = admissionOptions();

		await expect(
			createDirectCheckoutSession({
				body: { productId: "print-one" },
				stripe,
				siteUrl: "https://angelsrest.test",
				bindSession,
				resolveCommerce: vi.fn().mockRejectedValue(new Error("catalog closed")),
				log: vi.fn(),
				...reservation,
				...admission,
			}),
		).rejects.toThrow("catalog closed");
		expect(reservation.reservationClient.reserve).not.toHaveBeenCalled();
		expect(admission.admissionClient.begin).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
		expect(bindSession).not.toHaveBeenCalled();
	});

	it("requires one authoritative item with snapshot identity before effects", async () => {
		for (const items of [[], [makeItem({ snapshot: null })]]) {
			const { stripe, create } = makeStripe();
			const reservation = reservationOptions();
			const admission = admissionOptions();
			await expect(
				createDirectCheckoutSession({
					body: { productId: "print-one" },
					stripe,
					siteUrl: "https://angelsrest.test",
					bindSession: vi.fn(),
					resolveCommerce: vi.fn().mockResolvedValue({ provider: "convex", items }),
					log: vi.fn(),
					...reservation,
					...admission,
				}),
			).rejects.toThrow();
			expect(reservation.reservationClient.reserve).not.toHaveBeenCalled();
			expect(admission.admissionClient.begin).not.toHaveBeenCalled();
			expect(create).not.toHaveBeenCalled();
		}
	});

	it("rejects every coupon shape before effects", async () => {
		for (const coupon of ["SUMMER", " ", {}, 42, [], ["SUMMER"], true]) {
			const { stripe, create } = makeStripe();
			const resolveCommerce = vi.fn();
			const reservation = reservationOptions();
			const bindSession = vi.fn();
			const log = vi.fn();
			const admission = admissionOptions();

			await expect(
				createDirectCheckoutSession({
					body: { productId: "print-one", coupon },
					stripe,
					siteUrl: "https://angelsrest.test",
					bindSession,
					resolveCommerce,
					log,
					...reservation,
					...admission,
				}),
			).rejects.toMatchObject({
				status: 400,
				body: { code: "INVALID_COUPON", message: "Coupons are not accepted" },
			});
			expect(resolveCommerce).not.toHaveBeenCalled();
			expect(reservation.reservationClient.reserve).not.toHaveBeenCalled();
			expect(create).not.toHaveBeenCalled();
			expect(bindSession).not.toHaveBeenCalled();
			expect(log).not.toHaveBeenCalled();
		}
	});

	it("rejects requests without a product id before catalog or Stripe", async () => {
		const { stripe, create } = makeStripe();
		const resolveCommerce = vi.fn();
		const admission = admissionOptions();

		await expect(
			createDirectCheckoutSession({
				body: {},
				stripe,
				siteUrl: "https://angelsrest.test",
				bindSession: vi.fn(),
				resolveCommerce,
				log: vi.fn(),
				...admission,
			}),
		).rejects.toMatchObject({ status: 400 });

		expect(resolveCommerce).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
	});
});
