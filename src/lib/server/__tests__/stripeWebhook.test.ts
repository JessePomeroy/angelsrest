import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyStripeWebhook } from "$lib/server/stripeWebhook";

const mockLogStructured = vi.hoisted(() => vi.fn());

vi.mock("$lib/server/logger", () => ({ logStructured: mockLogStructured }));

function stripeWith(constructEvent: ReturnType<typeof vi.fn>) {
	return { webhooks: { constructEvent } } as unknown as Stripe;
}

describe("verifyStripeWebhook", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 400 when the stripe-signature header is missing", async () => {
		const constructEvent = vi.fn();
		const request = new Request("https://angelsrest.test/api/webhooks/stripe", {
			method: "POST",
			body: "{}",
		});

		await expect(
			verifyStripeWebhook(request, stripeWith(constructEvent), "webhook-secret"),
		).rejects.toMatchObject({
			status: 400,
			body: { message: "Missing stripe-signature header" },
		});
		expect(constructEvent).not.toHaveBeenCalled();
		expect(mockLogStructured).not.toHaveBeenCalled();
	});

	it("accepts either destination secret after one body read", async () => {
		const verifiedEvent = { id: "evt_refund", type: "refund.updated" } as Stripe.Event;
		const constructEvent = vi.fn((_body, _signature, secret) => {
			if (secret === "legacy-secret") return verifiedEvent;
			throw new Error("Signature mismatch");
		});
		const request = new Request("https://angelsrest.test/api/webhooks/stripe", {
			method: "POST",
			headers: { "stripe-signature": "valid-sig" },
			body: "raw-body",
		});
		const readBody = vi.spyOn(request, "text");

		await expect(
			verifyStripeWebhook(request, stripeWith(constructEvent), ["connect-secret", "legacy-secret"]),
		).resolves.toBe(verifiedEvent);
		expect(readBody).toHaveBeenCalledOnce();
		expect(constructEvent).toHaveBeenNthCalledWith(1, "raw-body", "valid-sig", "connect-secret");
		expect(constructEvent).toHaveBeenNthCalledWith(2, "raw-body", "valid-sig", "legacy-secret");
		expect(mockLogStructured).not.toHaveBeenCalled();
	});

	it("tries each distinct nonempty secret once and logs only final failure", async () => {
		const constructEvent = vi.fn((_body, _signature, secret) => {
			throw new Error(`Signature mismatch for ${secret}`);
		});
		const request = new Request("https://angelsrest.test/api/webhooks/stripe", {
			method: "POST",
			headers: { "stripe-signature": "bad-sig" },
			body: "raw-body",
		});

		await expect(
			verifyStripeWebhook(
				request,
				stripeWith(constructEvent),
				["connect-secret", "", "connect-secret", "legacy-secret"],
				"Commerce webhook",
			),
		).rejects.toMatchObject({
			status: 400,
			body: { message: "Webhook Error: Signature mismatch for legacy-secret" },
		});
		expect(constructEvent).toHaveBeenCalledTimes(2);
		expect(mockLogStructured).toHaveBeenCalledOnce();
		expect(mockLogStructured).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "webhook.signature_verification_failed",
				meta: {
					logLabel: "Commerce webhook",
					message: "Signature mismatch for legacy-secret",
				},
			}),
		);
	});

	it("preserves scalar-secret verification", async () => {
		const verifiedEvent = { id: "evt_platform" } as Stripe.Event;
		const constructEvent = vi.fn(() => verifiedEvent);
		const request = new Request("https://angelsrest.test/api/platform/webhooks/stripe", {
			method: "POST",
			headers: { "stripe-signature": "valid-sig" },
			body: "raw-body",
		});

		await expect(
			verifyStripeWebhook(request, stripeWith(constructEvent), "platform-secret"),
		).resolves.toBe(verifiedEvent);
		expect(constructEvent).toHaveBeenCalledWith("raw-body", "valid-sig", "platform-secret");
	});
});
