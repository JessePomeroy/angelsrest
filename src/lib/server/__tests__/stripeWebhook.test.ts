import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STRIPE_API_VERSION } from "$lib/server/stripeApiVersion";
import { verifyStripeWebhook, verifyStripeWebhookWithRole } from "$lib/server/stripeWebhook";

const mockLogStructured = vi.hoisted(() => vi.fn());

vi.mock("$lib/server/logger", () => ({ logStructured: mockLogStructured }));

function stripeWith(constructEvent: ReturnType<typeof vi.fn>) {
	return { webhooks: { constructEvent } } as unknown as Stripe;
}

function realEventPayload(apiVersion: string = STRIPE_API_VERSION) {
	return JSON.stringify({
		id: "evt_real_signature",
		object: "event",
		api_version: apiVersion,
		created: 1_800_000_000,
		data: { object: {} },
		livemode: false,
		pending_webhooks: 1,
		request: { id: null, idempotency_key: null },
		type: "checkout.session.completed",
	});
}

function realSignedRequest(payload: string, secret: string, timestamp?: number) {
	const stripe = new Stripe("sk_test_non_provider_placeholder", {
		apiVersion: STRIPE_API_VERSION,
	});
	const signature = stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp });
	return {
		request: new Request("https://angelsrest.test/api/webhooks/stripe", {
			method: "POST",
			headers: { "stripe-signature": signature },
			body: payload,
		}),
		stripe,
	};
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
		const verifiedEvent = {
			id: "evt_refund",
			type: "refund.updated",
			api_version: STRIPE_API_VERSION,
		} as Stripe.Event;
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

	it("accepts the pinned Snapshot contract through Stripe's real verifier", async () => {
		const payload = realEventPayload();
		const { request, stripe } = realSignedRequest(payload, "matching-secret");

		await expect(
			verifyStripeWebhookWithRole(request, stripe, [
				{ role: "connected-accounts", secret: "wrong-secret" },
				{ role: "your-account", secret: "matching-secret" },
			]),
		).resolves.toMatchObject({
			role: "your-account",
			event: { id: "evt_real_signature", api_version: STRIPE_API_VERSION },
		});
		expect(mockLogStructured).not.toHaveBeenCalled();
	});

	it("rejects a correctly signed event from a different API version", async () => {
		const payload = realEventPayload("2026-02-25.clover");
		const { request, stripe } = realSignedRequest(payload, "matching-secret");

		await expect(
			verifyStripeWebhook(request, stripe, "matching-secret", "Commerce webhook"),
		).rejects.toMatchObject({
			status: 400,
			body: { message: "Webhook API version is unsupported" },
		});
		expect(mockLogStructured).toHaveBeenCalledWith({
			event: "webhook.api_version_rejected",
			level: "error",
			stage: "webhook",
			meta: {
				logLabel: "Commerce webhook",
				eventType: "checkout.session.completed",
				expectedApiVersion: STRIPE_API_VERSION,
				actualApiVersion: "2026-02-25.clover",
			},
		});
	});

	it("rejects signed malformed JSON through Stripe's real verifier", async () => {
		const { request, stripe } = realSignedRequest("{", "matching-secret");

		await expect(verifyStripeWebhook(request, stripe, "matching-secret")).rejects.toMatchObject({
			status: 400,
			body: { message: "Webhook signature verification failed" },
		});
		expect(mockLogStructured).toHaveBeenCalledWith(
			expect.objectContaining({
				meta: expect.objectContaining({ failureCategories: ["malformed_payload"] }),
			}),
		);
	});

	it("rejects a correctly signed event outside timestamp tolerance", async () => {
		const payload = realEventPayload();
		const timestamp = Math.floor(Date.now() / 1000) - 301;
		const { request, stripe } = realSignedRequest(payload, "matching-secret", timestamp);

		await expect(verifyStripeWebhook(request, stripe, "matching-secret")).rejects.toMatchObject({
			status: 400,
			body: { message: "Webhook signature verification failed" },
		});
		expect(mockLogStructured).toHaveBeenCalledWith(
			expect.objectContaining({
				meta: expect.objectContaining({ failureCategories: ["timestamp"] }),
			}),
		);
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
		const verifiedEvent = {
			id: "evt_platform",
			type: "checkout.session.completed",
			api_version: STRIPE_API_VERSION,
		} as Stripe.Event;
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
