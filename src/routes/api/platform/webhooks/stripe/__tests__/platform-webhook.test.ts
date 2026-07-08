import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockConvexMutation = vi.fn();
const mockConvexQuery = vi.fn();
const mockVerifyStripeWebhook = vi.fn();
const mockLogStructured = vi.fn();

vi.mock("$lib/server/convexClient", () => ({
	getConvex: () => ({
		mutation: mockConvexMutation,
		query: mockConvexQuery,
	}),
}));

vi.mock("$lib/server/stripeClient", () => ({
	getStripe: () => ({ webhooks: {} }),
}));

vi.mock("$lib/server/stripeWebhook", () => ({
	verifyStripeWebhook: mockVerifyStripeWebhook,
}));

vi.mock("$lib/server/logger", () => ({
	logStructured: mockLogStructured,
}));

vi.mock("$convex/api", () => ({
	api: {
		platform: {
			getBySubscriptionId: "platform.getBySubscriptionId",
			updateSubscription: "platform.updateSubscription",
		},
	},
}));

function makeEvent(type: string, object: unknown): Stripe.Event {
	return {
		id: "evt_platform_123",
		type,
		data: { object },
	} as unknown as Stripe.Event;
}

function makeRequest() {
	return {
		request: new Request("https://angelsrest.test/api/platform/webhooks/stripe", {
			method: "POST",
			headers: { "stripe-signature": "valid-sig" },
			body: "{}",
		}),
	};
}

describe("platform Stripe webhook", () => {
	let POST: (event: any) => Promise<Response>;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.resetModules();
		const mod = await import("../+server");
		POST = mod.POST as unknown as typeof POST;
	});

	it("logs and activates platform subscriptions from checkout completion", async () => {
		mockVerifyStripeWebhook.mockResolvedValue(
			makeEvent("checkout.session.completed", {
				id: "cs_platform_123",
				customer: "cus_platform_123",
				subscription: "sub_platform_123",
				metadata: {
					type: "platform_subscription",
					siteUrl: "client.example",
				},
			}),
		);

		const response = await POST(makeRequest());

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ received: true });
		expect(mockConvexMutation).toHaveBeenCalledWith("platform.updateSubscription", {
			webhookSecret: "test-webhook-secret",
			siteUrl: "client.example",
			tier: "full",
			subscriptionStatus: "active",
			stripeCustomerId: "cus_platform_123",
			stripeSubscriptionId: "sub_platform_123",
		});
		expect(mockLogStructured).toHaveBeenCalledWith({
			event: "platform_webhook.received",
			stage: "webhook",
			meta: { eventType: "checkout.session.completed" },
		});
		expect(mockLogStructured).toHaveBeenCalledWith({
			event: "platform_subscription.activated",
			stage: "webhook",
			sessionId: "cs_platform_123",
			meta: {
				siteUrl: "client.example",
				stripeCustomerId: "cus_platform_123",
				stripeSubscriptionId: "sub_platform_123",
			},
		});
	});

	it("normalizes expanded checkout customers before structured logging", async () => {
		mockVerifyStripeWebhook.mockResolvedValue(
			makeEvent("checkout.session.completed", {
				id: "cs_platform_123",
				customer: {
					id: "cus_platform_123",
					email: "owner@example.com",
				},
				subscription: {
					id: "sub_platform_123",
					status: "active",
				},
				metadata: {
					type: "platform_subscription",
					siteUrl: "client.example",
				},
			}),
		);

		const response = await POST(makeRequest());

		expect(response.status).toBe(200);
		expect(mockConvexMutation).toHaveBeenCalledWith("platform.updateSubscription", {
			webhookSecret: "test-webhook-secret",
			siteUrl: "client.example",
			tier: "full",
			subscriptionStatus: "active",
			stripeCustomerId: "cus_platform_123",
			stripeSubscriptionId: "sub_platform_123",
		});
		expect(mockLogStructured).toHaveBeenCalledWith({
			event: "platform_subscription.activated",
			stage: "webhook",
			sessionId: "cs_platform_123",
			meta: {
				siteUrl: "client.example",
				stripeCustomerId: "cus_platform_123",
				stripeSubscriptionId: "sub_platform_123",
			},
		});
	});

	it("logs subscription cancellations with the structured logger", async () => {
		mockVerifyStripeWebhook.mockResolvedValue(
			makeEvent("customer.subscription.deleted", {
				id: "sub_platform_123",
			}),
		);
		mockConvexQuery.mockResolvedValue({ siteUrl: "client.example" });

		const response = await POST(makeRequest());

		expect(response.status).toBe(200);
		expect(mockConvexMutation).toHaveBeenCalledWith("platform.updateSubscription", {
			webhookSecret: "test-webhook-secret",
			siteUrl: "client.example",
			tier: "basic",
			subscriptionStatus: "canceled",
		});
		expect(mockLogStructured).toHaveBeenCalledWith({
			event: "platform_subscription.canceled",
			stage: "webhook",
			meta: {
				siteUrl: "client.example",
				stripeSubscriptionId: "sub_platform_123",
			},
		});
	});

	it("logs subscription updates with the structured logger", async () => {
		mockVerifyStripeWebhook.mockResolvedValue(
			makeEvent("customer.subscription.updated", {
				id: "sub_platform_123",
				status: "past_due",
			}),
		);
		mockConvexQuery.mockResolvedValue({ siteUrl: "client.example" });

		const response = await POST(makeRequest());

		expect(response.status).toBe(200);
		expect(mockConvexQuery).toHaveBeenCalledWith("platform.getBySubscriptionId", {
			webhookSecret: "test-webhook-secret",
			subscriptionId: "sub_platform_123",
		});
		expect(mockConvexMutation).toHaveBeenCalledWith("platform.updateSubscription", {
			webhookSecret: "test-webhook-secret",
			siteUrl: "client.example",
			tier: "basic",
			subscriptionStatus: "past_due",
		});
		expect(mockLogStructured).toHaveBeenCalledWith({
			event: "platform_subscription.updated",
			stage: "webhook",
			meta: {
				siteUrl: "client.example",
				stripeSubscriptionId: "sub_platform_123",
				subscriptionStatus: "past_due",
			},
		});
	});

	it("logs failed subscription payments as warnings", async () => {
		mockVerifyStripeWebhook.mockResolvedValue(
			makeEvent("invoice.payment_failed", {
				customer: "cus_platform_123",
			}),
		);

		const response = await POST(makeRequest());

		expect(response.status).toBe(200);
		expect(mockConvexMutation).not.toHaveBeenCalled();
		expect(mockLogStructured).toHaveBeenCalledWith({
			event: "platform_subscription.payment_failed",
			level: "warn",
			stage: "webhook",
			meta: { stripeCustomerId: "cus_platform_123" },
		});
	});

	it("normalizes expanded invoice customers before failed-payment logging", async () => {
		mockVerifyStripeWebhook.mockResolvedValue(
			makeEvent("invoice.payment_failed", {
				customer: {
					id: "cus_platform_123",
					email: "owner@example.com",
				},
			}),
		);

		const response = await POST(makeRequest());

		expect(response.status).toBe(200);
		expect(mockLogStructured).toHaveBeenCalledWith({
			event: "platform_subscription.payment_failed",
			level: "warn",
			stage: "webhook",
			meta: { stripeCustomerId: "cus_platform_123" },
		});
	});
});
