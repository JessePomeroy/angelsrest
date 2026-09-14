import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	assertOpen: vi.fn(),
	createHandle: vi.fn(),
	getStripe: vi.fn(),
	log: vi.fn(),
	resolveCurrentCommerce: vi.fn(),
	resolveTenant: vi.fn(),
	validateAttempt: vi.fn(),
}));

vi.mock("$lib/server/runtimeConfig", () => ({
	getPublicSiteOrigin: () => "https://www.angelsrest.online",
}));
vi.mock("$lib/server/commercePurposeControls", () => ({
	assertNewOrderCheckoutOpen: mocks.assertOpen,
	NewOrderCheckoutClosedError: class NewOrderCheckoutClosedError extends Error {},
}));
vi.mock("$lib/server/current/currentCheckoutCommerce.server", () => ({
	resolveCurrentCheckoutCommerce: mocks.resolveCurrentCommerce,
}));
vi.mock("$lib/server/handleCheckout", () => ({
	createHandleCheckoutSession: mocks.createHandle,
	validateSameOriginCheckoutAttemptRequest: mocks.validateAttempt,
}));
vi.mock("$lib/server/logger", () => ({ logStructured: mocks.log }));
vi.mock("$lib/server/stripeClient", () => ({ getStripe: mocks.getStripe }));
vi.mock("$lib/server/stripeTenant", () => ({
	resolveStripeTenantForSite: mocks.resolveTenant,
}));

import {
	CHECKOUT_FAILED_MESSAGE,
	CHECKOUT_SELECTION_CHANGED_MESSAGE,
	CHECKOUT_UNAVAILABLE_MESSAGE,
	CheckoutSessionStageError,
	CurrentCheckoutCommerceError,
} from "$lib/server/checkoutFailures";
import { POST } from "./+server";

const snapshot = {
	productKey: "tapestry-one-product",
	revisionId: "tapestry-one-revision",
	productKind: "tapestry" as const,
	variantKey: "tapestry-one-variant",
	materialOptionKey: null,
	sizeOptionKey: null,
	borderOptionKey: null,
	frameOptionKey: null,
};

describe("cart checkout", () => {
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
		mocks.resolveCurrentCommerce.mockResolvedValue({
			provider: "convex",
			items: [
				{
					productId: "tapestry-one",
					title: "Tapestry One",
					unitPriceCents: 5600,
					productCategory: "tapestry",
					publicImage: "https://media.example/tapestry.webp",
					snapshot,
					legacyFulfillment: {
						isDigital: false,
						isPrintSet: false,
						imageUrl: "https://media.example/tapestry.webp",
						imageUrls: [],
						paper: null,
					},
				},
			],
		});
		mocks.createHandle.mockResolvedValue({
			sessionId: "cs_cart",
			url: "https://stripe.example/cart",
			expiresAt: 1_800_086_100,
		});
	});

	it("uses only Convex-resolved price and snapshot identity for a fixed-price line", async () => {
		const request = new Request("https://www.angelsrest.online/api/cart/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				items: [{ productSlug: "tapestry-one", type: "print", quantity: 2, paperIndex: 0 }],
			}),
		});

		const response = await POST({ request, cookies: {} } as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			sessionId: "cs_cart",
			url: "https://stripe.example/cart",
			expiresAt: 1_800_086_100,
		});
		expect(mocks.resolveCurrentCommerce).toHaveBeenCalledWith([
			{
				productId: "tapestry-one",
				isPrintSet: false,
				paperSlug: undefined,
				sizeSlug: undefined,
				paperIndex: 0,
				borderWidth: undefined,
				frame: undefined,
			},
		]);
		expect(mocks.createHandle).toHaveBeenCalledWith(
			expect.objectContaining({
				catalogProvider: "convex",
				snapshotItems: [snapshot],
				hostGeneration: 7,
				shippingAllowedCountries: ["US"],
				lineItems: [
					expect.objectContaining({
						quantity: 2,
						price_data: expect.objectContaining({ unit_amount: 5600 }),
					}),
				],
			}),
		);
	});

	it.each([
		["selection_changed", 409, "CONFLICT", CHECKOUT_SELECTION_CHANGED_MESSAGE],
		["unavailable", 503, "UNAVAILABLE", CHECKOUT_UNAVAILABLE_MESSAGE],
		["invalid_authority", 500, "UPSTREAM_FAILED", CHECKOUT_FAILED_MESSAGE],
	] as const)("maps %s catalog authority failure to a safe %i response", async (kind, status, code, message) => {
		const failure = new CurrentCheckoutCommerceError(kind, "graph");
		mocks.resolveCurrentCommerce.mockRejectedValue(failure);
		const request = new Request("https://www.angelsrest.online/api/cart/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				items: [
					{
						productSlug: "print-one",
						type: "print",
						quantity: 1,
						paperIndex: 0,
					},
				],
			}),
		});

		await expect(
			POST({ request, cookies: {} } as Parameters<typeof POST>[0]),
		).rejects.toMatchObject({ status, body: { code, message } });
		expect(mocks.createHandle).not.toHaveBeenCalled();
		expect(mocks.log).toHaveBeenCalledWith({
			event: "cart_checkout.failed",
			level: kind === "selection_changed" ? "warn" : "error",
			stage: "checkout_catalog",
			...(kind === "selection_changed" ? {} : { error: failure }),
			meta: { failureKind: kind, failurePhase: "graph" },
		});
	});

	it.each([
		"checkout_snapshot",
		"checkout_admission",
		"checkout_tenant",
		"checkout_stripe",
		"checkout_internal",
	] as const)("preserves the truthful %s log stage while sanitizing session failure", async (stage) => {
		const failure = new CheckoutSessionStageError(stage, new Error("private failure"));
		mocks.createHandle.mockRejectedValue(failure);
		const request = new Request("https://www.angelsrest.online/api/cart/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				items: [{ productSlug: "tapestry-one", type: "print", quantity: 1 }],
			}),
		});

		await expect(
			POST({ request, cookies: {} } as Parameters<typeof POST>[0]),
		).rejects.toMatchObject({
			status: 500,
			body: { code: "UPSTREAM_FAILED", message: CHECKOUT_FAILED_MESSAGE },
		});
		expect(mocks.log).toHaveBeenCalledWith({
			event: "cart_checkout.failed",
			level: "error",
			stage,
			error: failure,
		});
	});

	it("sanitizes and classifies eager Stripe configuration failure", async () => {
		const failure = new Error("private Stripe configuration");
		mocks.getStripe.mockImplementation(() => {
			throw failure;
		});
		const request = new Request("https://www.angelsrest.online/api/cart/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				items: [{ productSlug: "tapestry-one", type: "print", quantity: 1 }],
			}),
		});

		await expect(
			POST({ request, cookies: {} } as Parameters<typeof POST>[0]),
		).rejects.toMatchObject({
			status: 500,
			body: { code: "UPSTREAM_FAILED", message: CHECKOUT_FAILED_MESSAGE },
		});
		expect(mocks.resolveCurrentCommerce).not.toHaveBeenCalled();
		expect(mocks.log).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "cart_checkout.failed",
				level: "error",
				stage: "checkout_stripe",
			}),
		);
	});

	it("classifies a tenant lookup failure separately from Stripe", async () => {
		const failure = new Error("private Convex tenant lookup");
		mocks.resolveTenant.mockRejectedValue(failure);
		const request = new Request("https://www.angelsrest.online/api/cart/checkout", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				items: [{ productSlug: "tapestry-one", type: "print", quantity: 1 }],
			}),
		});

		await expect(
			POST({ request, cookies: {} } as Parameters<typeof POST>[0]),
		).rejects.toMatchObject({
			status: 500,
			body: { code: "UPSTREAM_FAILED", message: CHECKOUT_FAILED_MESSAGE },
		});
		expect(mocks.createHandle).not.toHaveBeenCalled();
		expect(mocks.log).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "cart_checkout.failed",
				level: "error",
				stage: "checkout_tenant",
			}),
		);
	});
});
