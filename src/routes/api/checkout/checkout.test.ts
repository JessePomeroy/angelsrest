import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	CHECKOUT_FAILED_MESSAGE,
	CHECKOUT_SELECTION_CHANGED_MESSAGE,
	CHECKOUT_UNAVAILABLE_MESSAGE,
	CheckoutSessionStageError,
	CurrentCheckoutCommerceError,
} from "$lib/server/checkoutFailures";

const mocks = vi.hoisted(() => ({
	assertOpen: vi.fn(),
	createDirect: vi.fn(),
	getStripe: vi.fn(),
	log: vi.fn(),
	rejectCoupon: vi.fn(),
	resolveTenant: vi.fn(),
	validateAttempt: vi.fn(),
}));

vi.mock("$env/static/public", () => ({
	PUBLIC_SITE_URL: "https://www.angelsrest.online",
}));
vi.mock("$lib/server/commercePurposeControls", () => ({
	assertNewOrderCheckoutOpen: mocks.assertOpen,
	NewOrderCheckoutClosedError: class NewOrderCheckoutClosedError extends Error {},
}));
vi.mock("$lib/server/directCheckout", () => ({
	createDirectCheckoutSession: mocks.createDirect,
	rejectCouponAttempt: mocks.rejectCoupon,
}));
vi.mock("$lib/server/handleCheckout", () => ({
	validateSameOriginCheckoutAttemptRequest: mocks.validateAttempt,
}));
vi.mock("$lib/server/logger", () => ({ logStructured: mocks.log }));
vi.mock("$lib/server/stripeClient", () => ({ getStripe: mocks.getStripe }));
vi.mock("$lib/server/stripeTenant", () => ({
	resolveStripeTenantForSite: mocks.resolveTenant,
}));

import { POST } from "./+server";

const request = () =>
	new Request("https://www.angelsrest.online/api/checkout", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ productId: "print-one" }),
	});

describe("direct checkout failure boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.assertOpen.mockReturnValue({ state: "open", generation: 7 });
		mocks.validateAttempt.mockReturnValue({
			attempt: "123e4567-e89b-42d3-a456-426614174000",
			attemptStartedAt: 1_800_000_000_000,
			proofClass: "same_origin_host_proof",
		});
		mocks.getStripe.mockReturnValue({});
		mocks.resolveTenant.mockResolvedValue({ siteUrl: "angelsrest.online" });
		mocks.createDirect.mockResolvedValue({
			sessionId: "cs_direct",
			url: "https://stripe.example/direct",
		});
	});

	it.each([
		["selection_changed", 409, "CONFLICT", CHECKOUT_SELECTION_CHANGED_MESSAGE],
		["unavailable", 503, "UNAVAILABLE", CHECKOUT_UNAVAILABLE_MESSAGE],
		["invalid_authority", 500, "UPSTREAM_FAILED", CHECKOUT_FAILED_MESSAGE],
	] as const)("maps %s catalog authority failure to a safe %i response", async (kind, status, code, message) => {
		const failure = new CurrentCheckoutCommerceError(kind, "resolver");
		mocks.createDirect.mockRejectedValue(failure);

		await expect(
			POST({ request: request(), cookies: {} } as Parameters<typeof POST>[0]),
		).rejects.toMatchObject({ status, body: { code, message } });
		expect(mocks.log).toHaveBeenCalledWith({
			event: "checkout.failed",
			level: kind === "selection_changed" ? "warn" : "error",
			stage: "checkout_catalog",
			...(kind === "selection_changed" ? {} : { error: failure }),
			meta: { failureKind: kind, failurePhase: "resolver" },
		});
	});

	it.each([
		"checkout_snapshot",
		"checkout_admission",
		"checkout_tenant",
		"checkout_stripe",
		"checkout_internal",
	] as const)("logs a truthful %s stage while sanitizing the response", async (stage) => {
		const failure = new CheckoutSessionStageError(stage, new Error("private failure"));
		mocks.createDirect.mockRejectedValue(failure);

		await expect(
			POST({ request: request(), cookies: {} } as Parameters<typeof POST>[0]),
		).rejects.toMatchObject({
			status: 500,
			body: { code: "UPSTREAM_FAILED", message: CHECKOUT_FAILED_MESSAGE },
		});
		expect(mocks.log).toHaveBeenCalledWith({
			event: "checkout.failed",
			level: "error",
			stage,
			error: failure,
		});
	});

	it("sanitizes and classifies Stripe configuration failure inside the route boundary", async () => {
		const failure = new Error("private Stripe configuration");
		mocks.getStripe.mockImplementation(() => {
			throw failure;
		});

		await expect(
			POST({ request: request(), cookies: {} } as Parameters<typeof POST>[0]),
		).rejects.toMatchObject({
			status: 500,
			body: { code: "UPSTREAM_FAILED", message: CHECKOUT_FAILED_MESSAGE },
		});
		expect(mocks.createDirect).not.toHaveBeenCalled();
		expect(mocks.log).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "checkout.failed",
				level: "error",
				stage: "checkout_stripe",
			}),
		);
	});

	it("classifies a tenant lookup failure separately from Stripe", async () => {
		const failure = new Error("private Convex tenant lookup");
		mocks.resolveTenant.mockRejectedValue(failure);

		await expect(
			POST({ request: request(), cookies: {} } as Parameters<typeof POST>[0]),
		).rejects.toMatchObject({
			status: 500,
			body: { code: "UPSTREAM_FAILED", message: CHECKOUT_FAILED_MESSAGE },
		});
		expect(mocks.createDirect).not.toHaveBeenCalled();
		expect(mocks.log).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "checkout.failed",
				level: "error",
				stage: "checkout_tenant",
			}),
		);
	});
});
