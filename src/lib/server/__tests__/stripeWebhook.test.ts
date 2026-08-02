import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyStripeWebhook, verifyStripeWebhookWithRole } from "$lib/server/stripeWebhook";

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

	it("returns the role of the matching destination after one body read", async () => {
		const verifiedEvent = { id: "evt_refund", type: "refund.updated" } as Stripe.Event;
		const constructEvent = vi.fn((_body, _signature, secret) => {
			if (secret === "platform-secret") return verifiedEvent;
			throw new Error("Signature mismatch");
		});
		const request = new Request("https://angelsrest.test/api/webhooks/stripe", {
			method: "POST",
			headers: { "stripe-signature": "valid-sig" },
			body: "raw-body",
		});
		const readBody = vi.spyOn(request, "text");

		await expect(
			verifyStripeWebhookWithRole(request, stripeWith(constructEvent), [
				{ role: "connected-accounts", secret: "connect-secret" },
				{ role: "your-account", secret: "platform-secret" },
			]),
		).resolves.toEqual({ event: verifiedEvent, role: "your-account" });
		expect(readBody).toHaveBeenCalledOnce();
		expect(constructEvent).toHaveBeenNthCalledWith(1, "raw-body", "valid-sig", "connect-secret");
		expect(constructEvent).toHaveBeenNthCalledWith(2, "raw-body", "valid-sig", "platform-secret");
		expect(mockLogStructured).not.toHaveBeenCalled();
	});

	it("tries each distinct role-secret candidate once and logs sanitized failures", async () => {
		const constructEvent = vi.fn((_body, _signature, secret) => {
			if (secret === "connect-secret") {
				throw new Error("Timestamp outside the tolerance zone");
			}
			throw new Error("Signature mismatch");
		});
		const request = new Request("https://angelsrest.test/api/webhooks/stripe", {
			method: "POST",
			headers: { "stripe-signature": "bad-sig" },
			body: "raw-body",
		});

		await expect(
			verifyStripeWebhookWithRole(
				request,
				stripeWith(constructEvent),
				[
					{ role: "connected-accounts", secret: "connect-secret" },
					{ role: "connected-accounts", secret: "connect-secret" },
					{ role: "your-account", secret: "platform-secret" },
				],
				"Commerce webhook",
			),
		).rejects.toMatchObject({
			status: 400,
			body: { message: "Webhook signature verification failed" },
		});
		expect(constructEvent).toHaveBeenCalledTimes(2);
		expect(mockLogStructured).toHaveBeenCalledOnce();
		expect(mockLogStructured).toHaveBeenCalledWith({
			event: "webhook.signature_verification_failed",
			level: "error",
			stage: "webhook",
			meta: {
				logLabel: "Commerce webhook",
				candidateCount: 2,
				failureCategories: ["timestamp", "signature"],
			},
		});
	});

	it("fails closed when two roles reuse one signing secret", async () => {
		const constructEvent = vi.fn();
		const request = new Request("https://angelsrest.test/api/webhooks/stripe", {
			method: "POST",
			headers: { "stripe-signature": "valid-sig" },
			body: "raw-body",
		});

		await expect(
			verifyStripeWebhookWithRole(
				request,
				stripeWith(constructEvent),
				[
					{ role: "your-account", secret: "reused-secret" },
					{ role: "connected-accounts", secret: "reused-secret" },
				],
				"Commerce webhook",
			),
		).rejects.toMatchObject({
			status: 500,
			body: { message: "Webhook secret configuration is invalid" },
		});
		expect(constructEvent).not.toHaveBeenCalled();
		expect(mockLogStructured).toHaveBeenCalledWith({
			event: "webhook.secret_configuration_invalid",
			level: "error",
			stage: "webhook",
			meta: {
				logLabel: "Commerce webhook",
				candidateCount: 2,
				roleCount: 2,
			},
		});
	});

	it("supports the separate platform-subscription role", async () => {
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
