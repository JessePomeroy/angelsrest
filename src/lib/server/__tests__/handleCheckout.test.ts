import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import type { CheckoutSnapshotItem } from "$lib/server/checkoutCatalog";
import {
	type CreateHandleCheckoutOptions,
	createHandleCheckoutSession,
	validateCheckoutAttempt,
	validateCheckoutAttemptRequest,
} from "$lib/server/handleCheckout";
import { buildCheckoutLineItem } from "$lib/server/stripeCheckoutSession";
import { buildTenantCheckoutOptions } from "$lib/server/stripeConnect";

const NOW = Date.parse("2026-01-01T00:00:00Z");
const ATTEMPT = "123e4567-e89b-42d3-a456-426614174000";
const HANDLE = "223e4567-e89b-42d3-a456-426614174000";
const ITEM: CheckoutSnapshotItem = {
	productKey: "published-product",
	revisionId: "published-revision",
	productKind: "print",
	variantKey: "variant-key",
	materialOptionKey: "archival-matte",
	sizeOptionKey: "8x10",
	borderOptionKey: "none",
	frameOptionKey: "none",
};

function harness(overrides: Record<string, unknown> = {}) {
	const events: string[] = [];
	const create = vi.fn(
		async (_params: Stripe.Checkout.SessionCreateParams, _options?: Stripe.RequestOptions) => {
			events.push("stripe");
			return { id: "cs_test_1234567890abcdefghijklmnop", url: "https://stripe.test/pay" };
		},
	);
	const reserve = vi.fn(async () => {
		events.push("reserve");
		return { handle: HANDLE };
	});
	const bind = vi.fn(async () => {
		events.push("bind");
	});
	const bindSession = vi.fn(() => events.push("cookie"));
	const options = {
		attempt: ATTEMPT,
		attemptStartedAt: NOW,
		site: "angelsrest.test",
		account: null,
		snapshotItems: [ITEM],
		stripe: { checkout: { sessions: { create } } } as unknown as Stripe,
		lineItems: [
			buildCheckoutLineItem({
				name: "Trusted title",
				imageUrl: "https://cdn.example/trusted.jpg",
				unitAmountCents: 4200,
			}),
		],
		successUrl: "https://angelsrest.test/checkout/success?session_id={CHECKOUT_SESSION_ID}",
		cancelUrl: "https://angelsrest.test/checkout/cancel",
		shippingAllowedCountries: ["US"],
		tenantCheckout: buildTenantCheckoutOptions({
			tenant: { siteUrl: "angelsrest.test" },
			kind: "print",
			subtotalCents: 4200,
		}),
		bindSession,
		abuseGate: () => {
			events.push("gate");
		},
		reservationClient: { reserve, bind },
		now: NOW,
		...overrides,
	} as CreateHandleCheckoutOptions;
	return { options, create, reserve, bind, bindSession, events };
}

describe("handle checkout orchestration", () => {
	it("reserves, creates trusted Stripe state, binds, then exposes cookie and URL", async () => {
		const first = harness();
		const result = await createHandleCheckoutSession(first.options);
		expect(first.events).toEqual(["gate", "reserve", "stripe", "bind", "cookie"]);
		expect(result).toEqual({
			sessionId: "cs_test_1234567890abcdefghijklmnop",
			url: "https://stripe.test/pay",
			expiresAt: Math.floor(NOW / 1000) + 86_100,
		});
		const params = first.create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		expect(params.metadata).toEqual({
			checkoutSnapshotVersion: "2",
			checkoutSnapshotHandle: HANDLE,
			commerceTenantSiteUrl: "angelsrest.test",
		});
		expect(params.expires_at).toBe(result.expiresAt);
		expect(params.line_items?.[0]?.price_data).toMatchObject({
			unit_amount: 4200,
			product_data: { name: "Trusted title", images: ["https://cdn.example/trusted.jpg"] },
		});
	});

	it("does not call Stripe after reserve failure", async () => {
		const test = harness({
			reservationClient: {
				reserve: vi.fn().mockRejectedValue(new Error("unavailable")),
				bind: vi.fn(),
			},
		});
		await expect(createHandleCheckoutSession(test.options)).rejects.toThrow("unavailable");
		expect(test.create).not.toHaveBeenCalled();
		expect(test.bindSession).not.toHaveBeenCalled();
	});

	it("reuses exact expiry and Stripe idempotency for one attempt", async () => {
		const test = harness();
		await createHandleCheckoutSession(test.options);
		await createHandleCheckoutSession(test.options);
		const calls = test.create.mock.calls as unknown as Array<[unknown, Stripe.RequestOptions]>;
		expect(calls[0]?.[1].idempotencyKey).toBe(calls[1]?.[1].idempotencyKey);
		expect(calls[0]?.[0]).toEqual(calls[1]?.[0]);
	});

	it("uses independent idempotency for a changed attempt handle", async () => {
		const test = harness();
		test.reserve
			.mockResolvedValueOnce({ handle: HANDLE })
			.mockResolvedValueOnce({ handle: "323e4567-e89b-42d3-a456-426614174000" });
		await createHandleCheckoutSession(test.options);
		await createHandleCheckoutSession({
			...test.options,
			attempt: "423e4567-e89b-42d3-a456-426614174000",
		});
		const calls = test.create.mock.calls as unknown as Array<[unknown, Stripe.RequestOptions]>;
		expect(calls[0]?.[1].idempotencyKey).not.toBe(calls[1]?.[1].idempotencyKey);
	});

	it("withholds browser binding and success when reservation binding fails", async () => {
		const test = harness({
			reservationClient: {
				reserve: vi.fn().mockResolvedValue({ handle: HANDLE }),
				bind: vi.fn().mockRejectedValue(new Error("unavailable")),
			},
		});
		await expect(createHandleCheckoutSession(test.options)).rejects.toThrow("unavailable");
		expect(test.bindSession).not.toHaveBeenCalled();
	});

	it("returns a fresh bounded pre-effect challenge and rejects stale attempts", () => {
		expect(() =>
			validateCheckoutAttemptRequest(undefined, undefined, NOW, () => ATTEMPT),
		).toThrowError(
			expect.objectContaining({
				status: 428,
				body: {
					code: "CHECKOUT_ATTEMPT_REQUIRED",
					message: "Checkout attempt required",
					details: { attempt: ATTEMPT, attemptStartedAt: NOW },
				},
			}),
		);
		expect(() => validateCheckoutAttemptRequest(ATTEMPT, NOW - 86_100_000, NOW)).toThrowError(
			expect.objectContaining({
				status: 409,
				body: expect.objectContaining({ code: "CHECKOUT_ATTEMPT_REJECTED" }),
			}),
		);
	});

	it("fails malformed attempts and redirects before reservation", async () => {
		const test = harness({ attempt: "not-an-attempt" });
		await expect(createHandleCheckoutSession(test.options)).rejects.toThrow("Invalid checkout");
		expect(test.reserve).not.toHaveBeenCalled();
		expect(() => validateCheckoutAttempt(ATTEMPT, NOW + 301_000, NOW)).toThrow();
		const redirected = harness({ cancelUrl: "https://attacker.test/cancel" });
		await expect(createHandleCheckoutSession(redirected.options)).rejects.toThrow();
		expect(redirected.reserve).not.toHaveBeenCalled();
	});

	it("keeps 40-line and near-limit set snapshots out of Stripe metadata", async () => {
		const items = Array.from({ length: 40 }, (_, index) => ({
			...ITEM,
			productKey: `published-product-${index}`,
		}));
		const lines = items.map((_, index) =>
			buildCheckoutLineItem({ name: `Trusted ${index}`, unitAmountCents: 100 + index }),
		);
		const test = harness({ snapshotItems: items, lineItems: lines });
		await createHandleCheckoutSession(test.options);
		const params = test.create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		expect(params.line_items).toHaveLength(40);
		expect(Object.keys(params.metadata ?? {})).toHaveLength(3);
		expect(JSON.stringify(params.metadata)).not.toContain("published-product");
	});
});
