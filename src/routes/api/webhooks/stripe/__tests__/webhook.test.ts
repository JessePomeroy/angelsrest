import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	convex: {},
	createLumaPrintsOrder: vi.fn(),
	process: vi.fn(),
	resend: {},
	stripe: {},
	verify: vi.fn(),
	env: {
		STRIPE_CONNECT_WEBHOOK_SECRET: "connect-secret",
		STRIPE_WEBHOOK_SECRET: "legacy-secret",
	} as Record<string, string | undefined>,
}));

vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/convexClient", () => ({ getConvex: () => mocks.convex }));
vi.mock("$lib/server/lumaprints", () => ({ createOrder: mocks.createLumaPrintsOrder }));
vi.mock("$lib/server/orderIntake", () => ({ processStripeWebhookEvent: mocks.process }));
vi.mock("$lib/server/resendClient", () => ({ getResend: () => mocks.resend }));
vi.mock("$lib/server/stripeClient", () => ({ getStripe: () => mocks.stripe }));
vi.mock("$lib/server/stripeWebhook", () => ({ verifyStripeWebhook: mocks.verify }));

function event(): Stripe.Event {
	return {
		id: "evt_test_123",
		type: "checkout.session.completed",
		data: { object: { id: "cs_test_123" } },
	} as Stripe.Event;
}

describe("Stripe webhook route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.env.STRIPE_CONNECT_WEBHOOK_SECRET = "connect-secret";
		mocks.env.STRIPE_WEBHOOK_SECRET = "legacy-secret";
		mocks.verify.mockResolvedValue(event());
	});

	it("verifies and delegates one event to the pure intake boundary", async () => {
		const { POST } = await import("../+server");
		const request = new Request("http://localhost/api/webhooks/stripe", {
			method: "POST",
			body: "{}",
		});
		const response = await POST({ request } as Parameters<typeof POST>[0]);

		expect(mocks.verify).toHaveBeenCalledWith(request, mocks.stripe, [
			"connect-secret",
			"legacy-secret",
		]);
		expect(mocks.process).toHaveBeenCalledWith(event(), {
			stripe: mocks.stripe,
			resend: mocks.resend,
			convex: mocks.convex,
			createLumaPrintsOrder: mocks.createLumaPrintsOrder,
		});
		expect(await response.json()).toEqual({ received: true });
	});

	it("retains each single-secret deployment and fails closed without either secret", async () => {
		const { POST } = await import("../+server");
		mocks.env.STRIPE_CONNECT_WEBHOOK_SECRET = undefined;
		const legacyRequest = new Request("http://localhost/api/webhooks/stripe", {
			method: "POST",
			body: "{}",
		});
		await POST({ request: legacyRequest } as Parameters<typeof POST>[0]);
		expect(mocks.verify).toHaveBeenLastCalledWith(legacyRequest, mocks.stripe, ["legacy-secret"]);

		mocks.env.STRIPE_CONNECT_WEBHOOK_SECRET = "connect-secret";
		mocks.env.STRIPE_WEBHOOK_SECRET = undefined;
		const connectRequest = new Request("http://localhost/api/webhooks/stripe", {
			method: "POST",
			body: "{}",
		});
		await POST({ request: connectRequest } as Parameters<typeof POST>[0]);
		expect(mocks.verify).toHaveBeenLastCalledWith(connectRequest, mocks.stripe, ["connect-secret"]);

		mocks.env.STRIPE_CONNECT_WEBHOOK_SECRET = undefined;
		const missingRequest = new Request("http://localhost/api/webhooks/stripe", {
			method: "POST",
			body: "{}",
		});
		await expect(POST({ request: missingRequest } as Parameters<typeof POST>[0])).rejects.toThrow(
			"Stripe commerce webhook secret is not set",
		);
		expect(mocks.process).toHaveBeenCalledTimes(2);
	});
});
