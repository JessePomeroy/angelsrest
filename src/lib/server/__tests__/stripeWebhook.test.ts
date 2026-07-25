import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { verifyStripeWebhook } from "$lib/server/stripeWebhook";

const mockLogStructured = vi.hoisted(() => vi.fn());

vi.mock("$lib/server/logger", () => ({ logStructured: mockLogStructured }));

function stripeWith(constructEvent: ReturnType<typeof vi.fn>) {
	return { webhooks: { constructEvent } } as unknown as Stripe;
}

describe("verifyStripeWebhook", () => {
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
	});

	it("returns 400 when Stripe rejects an invalid signature", async () => {
		const constructEvent = vi.fn(() => {
			throw new Error("Signature mismatch");
		});
		const request = new Request("https://angelsrest.test/api/webhooks/stripe", {
			method: "POST",
			headers: { "stripe-signature": "bad-sig" },
			body: "raw-body",
		});

		await expect(
			verifyStripeWebhook(request, stripeWith(constructEvent), "webhook-secret"),
		).rejects.toMatchObject({
			status: 400,
			body: { message: "Webhook Error: Signature mismatch" },
		});
		expect(constructEvent).toHaveBeenCalledWith("raw-body", "bad-sig", "webhook-secret");
	});
});
