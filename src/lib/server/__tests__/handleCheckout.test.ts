import type Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "$env/dynamic/private";
import type { CheckoutSnapshotItem } from "$lib/server/checkoutCatalog";
import type { CheckoutSessionStageError } from "$lib/server/checkoutFailures";
import {
	type CreateHandleCheckoutOptions,
	createHandleCheckoutSession,
	issueSameOriginCheckoutAttempt,
	validateCheckoutAttempt,
	validateCheckoutAttemptRequest,
	validateSameOriginCheckoutAttemptRequest,
} from "$lib/server/handleCheckout";
import { buildCheckoutLineItem } from "$lib/server/stripeCheckoutSession";
import { buildTenantCheckoutOptions } from "$lib/server/stripeConnect";

const NOW = Date.parse("2026-01-01T00:00:00Z");
const ATTEMPT = "123e4567-e89b-42d3-a456-426614174000";
const HANDLE = "223e4567-e89b-42d3-a456-426614174000";
const runtimeEnv = env as Record<string, string | undefined>;
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

afterEach(() => {
	runtimeEnv.ORDER_PRODUCERS_STATE = "open";
});

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
	const admissionClient = {
		begin: vi.fn(async ({ identity }: { identity: { attempt: string } }) => {
			events.push("admission-begin");
			const changed = identity.attempt === ATTEMPT ? "a" : "b";
			return {
				site: "angelsrest.test",
				account: null,
				admissionId: "admission_123",
				handleHash: changed.repeat(64),
				requestFingerprint: "c".repeat(64),
				activeLeaseTokenHash: "d".repeat(64),
				stripeIdempotencyDigest: changed.repeat(64),
				stripeIdempotencyKey: `checkout-admission-v1:${changed.repeat(64)}`,
				hostGeneration: 1,
				admissionGeneration: 1,
				state: "active_prestripe",
			};
		}),
		markCreating: vi.fn(async () => {
			events.push("admission-creating");
			return Math.floor(NOW / 1000) + 86_100;
		}),
		markUncertain: vi.fn().mockResolvedValue(undefined),
		bind: vi.fn(async () => {
			events.push("bind");
		}),
		release: vi.fn().mockResolvedValue(undefined),
	};
	const bindSession = vi.fn(() => events.push("cookie"));
	const options = {
		attempt: ATTEMPT,
		attemptStartedAt: NOW,
		attemptProofClass: "same_origin_host_proof",
		site: "angelsrest.test",
		account: null,
		catalogProvider: "convex",
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
		admissionClient,
		hostGeneration: 1,
		now: NOW,
		...overrides,
	} as CreateHandleCheckoutOptions;
	return { options, create, reserve, bind, admissionClient, bindSession, events };
}

describe("handle checkout orchestration", () => {
	it.each([
		["missing", undefined],
		["explicit closed", "closed"],
		["invalid", "true"],
		["malformed", " open "],
		["unknown", "paused"],
	] as const)("rejects %s state before reservation or payment effects", async (_label, state) => {
		runtimeEnv.ORDER_PRODUCERS_STATE = state;
		const test = harness();

		await expect(createHandleCheckoutSession(test.options)).rejects.toThrow(
			"Order producers are closed",
		);
		expect(test.events).toEqual([]);
		expect(test.reserve).not.toHaveBeenCalled();
		expect(test.create).not.toHaveBeenCalled();
		expect(test.bind).not.toHaveBeenCalled();
		expect(test.bindSession).not.toHaveBeenCalled();
	});

	it("reserves, creates trusted Stripe state, binds, then exposes cookie and URL when open", async () => {
		runtimeEnv.ORDER_PRODUCERS_STATE = "open";
		const first = harness();
		const result = await createHandleCheckoutSession(first.options);
		expect(first.events).toEqual([
			"gate",
			"reserve",
			"admission-begin",
			"admission-creating",
			"stripe",
			"bind",
			"cookie",
		]);
		expect(result).toEqual({
			sessionId: "cs_test_1234567890abcdefghijklmnop",
			url: "https://stripe.test/pay",
			expiresAt: Math.floor(NOW / 1000) + 86_100,
		});
		const params = first.create.mock.calls[0]?.[0] as Stripe.Checkout.SessionCreateParams;
		expect(params.metadata).toEqual({
			checkoutSnapshotVersion: "2",
			checkoutSnapshotHandle: HANDLE,
			checkoutAdmissionVersion: "1",
			checkoutAdmissionHandleHash: "a".repeat(64),
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
		await expect(createHandleCheckoutSession(test.options)).rejects.toEqual(
			expect.objectContaining<Partial<CheckoutSessionStageError>>({ stage: "checkout_snapshot" }),
		);
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
			admissionClient: {
				...harness().admissionClient,
				bind: vi.fn().mockRejectedValue(new Error("unavailable")),
			},
		});
		await expect(createHandleCheckoutSession(test.options)).rejects.toEqual(
			expect.objectContaining<Partial<CheckoutSessionStageError>>({ stage: "checkout_admission" }),
		);
		expect(test.bindSession).not.toHaveBeenCalled();
	});

	it("tags admission and Stripe failures at their exact effect seams", async () => {
		const admission = harness({
			admissionClient: {
				...harness().admissionClient,
				begin: vi.fn().mockRejectedValue(new Error("private admission failure")),
			},
		});
		await expect(createHandleCheckoutSession(admission.options)).rejects.toMatchObject({
			stage: "checkout_admission",
			message: "private admission failure",
		});
		expect(admission.create).not.toHaveBeenCalled();

		const stripeFailure = new Error("private Stripe failure");
		const stripe = harness({
			stripe: {
				checkout: { sessions: { create: vi.fn().mockRejectedValue(stripeFailure) } },
			} as unknown as Stripe,
		});
		await expect(createHandleCheckoutSession(stripe.options)).rejects.toMatchObject({
			stage: "checkout_stripe",
			message: stripeFailure.message,
		});
		expect(stripe.admissionClient.markUncertain).toHaveBeenCalledOnce();
		expect(stripe.bindSession).not.toHaveBeenCalled();
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

	it("binds the same-origin challenge to the tenant, purpose, attempt, and start time", () => {
		const credential = () => "tenant-purpose-proof-secret-0123456789";
		const challenge = issueSameOriginCheckoutAttempt(
			"angelsrest.online",
			NOW,
			() => ATTEMPT,
			credential,
		);
		expect(
			validateSameOriginCheckoutAttemptRequest(
				"angelsrest.online",
				challenge.attempt,
				challenge.attemptStartedAt,
				challenge.attemptProof,
				NOW,
				() => ATTEMPT,
				credential,
			),
		).toEqual({
			attempt: ATTEMPT,
			attemptStartedAt: NOW,
			proofClass: "same_origin_host_proof",
		});
		expect(() =>
			validateSameOriginCheckoutAttemptRequest(
				"zippymiggy.com",
				challenge.attempt,
				challenge.attemptStartedAt,
				challenge.attemptProof,
				NOW,
				() => ATTEMPT,
				credential,
			),
		).toThrowError(expect.objectContaining({ status: 409 }));
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
		expect(Object.keys(params.metadata ?? {})).toHaveLength(5);
		expect(JSON.stringify(params.metadata)).not.toContain("published-product");
	});
});
