import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	convex: { query: vi.fn() },
	createLumaPrintsOrder: vi.fn(),
	logStructured: vi.fn(),
	process: vi.fn(),
	getResend: vi.fn(),
	resend: {},
	stripe: {},
	verify: vi.fn(),
	env: {
		ORDER_PRODUCERS_STATE: "open",
		STRIPE_CONNECT_WEBHOOK_SECRET: "connect-secret",
		STRIPE_WEBHOOK_SECRET: "platform-secret",
		WEBHOOK_SECRET: "webhook-secret",
	} as Record<string, string | undefined>,
}));

vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/convexClient", () => ({ getConvex: () => mocks.convex }));
vi.mock("$lib/server/logger", () => ({ logStructured: mocks.logStructured }));
vi.mock("$lib/server/lumaprints", () => ({ createOrder: mocks.createLumaPrintsOrder }));
vi.mock("$lib/server/orderIntake", () => ({ processStripeWebhookEvent: mocks.process }));
vi.mock("$lib/server/resendClient", () => ({ getResend: mocks.getResend }));
vi.mock("$lib/server/stripeClient", () => ({ getStripe: () => mocks.stripe }));
vi.mock("$lib/server/stripeWebhook", () => ({ verifyStripeWebhookWithRole: mocks.verify }));

function event(overrides: Record<string, unknown> = {}): Stripe.Event {
	return {
		id: "evt_test_123",
		type: "checkout.session.completed",
		data: { object: { id: "cs_test_123", metadata: {}, mode: "payment" } },
		...overrides,
	} as Stripe.Event;
}

function request() {
	return new Request("http://localhost/api/webhooks/stripe", {
		method: "POST",
		body: "{}",
	});
}

describe("Stripe webhook route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.env.ORDER_PRODUCERS_STATE = "open";
		mocks.env.STRIPE_CONNECT_WEBHOOK_SECRET = "connect-secret";
		mocks.env.STRIPE_WEBHOOK_SECRET = "platform-secret";
		mocks.env.WEBHOOK_SECRET = "webhook-secret";
		mocks.convex.query.mockResolvedValue(null);
		mocks.getResend.mockReturnValue(mocks.resend);
		mocks.verify.mockResolvedValue({ event: event(), role: "your-account" });
	});

	it("verifies the labeled Your-account role and delegates one event", async () => {
		const { POST } = await import("../+server");
		const webhookRequest = request();
		const response = await POST({ request: webhookRequest } as Parameters<typeof POST>[0]);

		expect(mocks.verify).toHaveBeenCalledWith(
			webhookRequest,
			mocks.stripe,
			[
				{ role: "your-account", secret: "platform-secret" },
				{ role: "connected-accounts", secret: "connect-secret" },
			],
			"Commerce webhook",
		);
		expect(mocks.process).toHaveBeenCalledWith(
			event(),
			{
				stripe: mocks.stripe,
				resend: mocks.resend,
				convex: mocks.convex,
				createLumaPrintsOrder: mocks.createLumaPrintsOrder,
			},
			"your-account",
		);
		expect(await response.json()).toEqual({ received: true });
	});

	it.each([
		["missing", undefined],
		["explicit closed", "closed"],
		["invalid", "true"],
		["malformed", " open "],
		["unknown", "paused"],
	] as const)("verifies but rejects order-producing intake for %s state before downstream effects", async (_label, state) => {
		mocks.env.ORDER_PRODUCERS_STATE = state;
		const verifiedEvent = event();
		mocks.verify.mockResolvedValue({ event: verifiedEvent, role: "your-account" });
		const { POST } = await import("../+server");
		const webhookRequest = request();

		await expect(
			POST({ request: webhookRequest } as Parameters<typeof POST>[0]),
		).rejects.toMatchObject({
			status: 503,
			body: { message: "Order intake is closed" },
		});
		expect(mocks.verify).toHaveBeenCalledOnce();
		expect(mocks.convex.query).toHaveBeenCalledOnce();
		expect(mocks.process).not.toHaveBeenCalled();
		expect(mocks.getResend).not.toHaveBeenCalled();
		expect(mocks.createLumaPrintsOrder).not.toHaveBeenCalled();
	});

	it("acknowledges an existing-order replay while producers are closed", async () => {
		mocks.env.ORDER_PRODUCERS_STATE = "closed";
		mocks.convex.query.mockResolvedValue({ source: "order", siteUrl: "tenant.example" });
		const verifiedEvent = event();
		mocks.verify.mockResolvedValue({ event: verifiedEvent, role: "your-account" });
		const { POST } = await import("../+server");

		const response = await POST({ request: request() } as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ received: true });
		expect(mocks.convex.query).toHaveBeenCalledWith(expect.anything(), {
			stripeSessionId: "cs_test_123",
			webhookSecret: "webhook-secret",
		});
		expect(mocks.process).not.toHaveBeenCalled();
		expect(mocks.getResend).not.toHaveBeenCalled();
		expect(mocks.createLumaPrintsOrder).not.toHaveBeenCalled();
	});

	it.each([
		[
			"invoice completion",
			event({
				data: {
					object: {
						id: "cs_invoice_123",
						metadata: { type: "invoice_payment" },
						mode: "payment",
					},
				},
			}),
		],
		[
			"platform subscription completion",
			event({
				data: {
					object: {
						id: "cs_subscription_123",
						metadata: { type: "platform_subscription" },
						mode: "subscription",
					},
				},
			}),
		],
		[
			"payment failure",
			event({ type: "payment_intent.payment_failed", data: { object: { id: "pi_123" } } }),
		],
		["refund update", event({ type: "refund.updated", data: { object: { id: "re_123" } } })],
		["unsupported event", event({ type: "customer.created", data: { object: {} } })],
	] as const)("keeps safe non-order %s intake active while producers are closed", async (_label, safeEvent) => {
		mocks.env.ORDER_PRODUCERS_STATE = undefined;
		mocks.verify.mockResolvedValue({ event: safeEvent, role: "your-account" });
		const { POST } = await import("../+server");

		const response = await POST({ request: request() } as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		expect(mocks.process).toHaveBeenCalledWith(safeEvent, expect.anything(), "your-account");
	});

	it("delegates a connected-account event only for the connected role", async () => {
		const connectedEvent = event({ account: "acct_connected" });
		mocks.verify.mockResolvedValue({ event: connectedEvent, role: "connected-accounts" });
		const { POST } = await import("../+server");

		const response = await POST({ request: request() } as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		expect(mocks.process).toHaveBeenCalledWith(
			connectedEvent,
			expect.anything(),
			"connected-accounts",
		);
		expect(mocks.logStructured).not.toHaveBeenCalled();
	});

	it("forwards the verified Your-account role for a platform context", async () => {
		const contextEvent = event({ context: "acct_1234567890abcdef" });
		mocks.verify.mockResolvedValue({ event: contextEvent, role: "your-account" });
		const { POST } = await import("../+server");

		await POST({ request: request() } as Parameters<typeof POST>[0]);

		expect(mocks.process).toHaveBeenCalledWith(contextEvent, expect.anything(), "your-account");
	});

	it.each([
		["Your-account secret with connected event", "your-account", "acct_connected"],
		["connected secret with platform event", "connected-accounts", undefined],
	] as const)("rejects %s before intake", async (_label, role, account) => {
		const mismatchedEvent = event(account ? { account } : {});
		mocks.verify.mockResolvedValue({ event: mismatchedEvent, role });
		const { POST } = await import("../+server");

		await expect(POST({ request: request() } as Parameters<typeof POST>[0])).rejects.toMatchObject({
			status: 400,
			body: { message: "Webhook account scope does not match its destination" },
		});
		expect(mocks.process).not.toHaveBeenCalled();
		expect(mocks.createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(mocks.logStructured).toHaveBeenCalledWith({
			event: "webhook.commerce_scope_rejected",
			level: "error",
			stage: "webhook",
			meta: {
				eventType: "checkout.session.completed",
				role,
				hasConnectedAccount: Boolean(account),
			},
		});
	});

	it("retains each declared single-role deployment and fails closed without either secret", async () => {
		const { POST } = await import("../+server");
		mocks.env.STRIPE_CONNECT_WEBHOOK_SECRET = undefined;
		const platformRequest = request();
		await POST({ request: platformRequest } as Parameters<typeof POST>[0]);
		expect(mocks.verify).toHaveBeenLastCalledWith(
			platformRequest,
			mocks.stripe,
			[{ role: "your-account", secret: "platform-secret" }],
			"Commerce webhook",
		);

		mocks.env.STRIPE_CONNECT_WEBHOOK_SECRET = "connect-secret";
		mocks.env.STRIPE_WEBHOOK_SECRET = undefined;
		mocks.verify.mockResolvedValue({
			event: event({ account: "acct_connected" }),
			role: "connected-accounts",
		});
		const connectRequest = request();
		await POST({ request: connectRequest } as Parameters<typeof POST>[0]);
		expect(mocks.verify).toHaveBeenLastCalledWith(
			connectRequest,
			mocks.stripe,
			[{ role: "connected-accounts", secret: "connect-secret" }],
			"Commerce webhook",
		);

		mocks.env.STRIPE_CONNECT_WEBHOOK_SECRET = undefined;
		const missingRequest = request();
		await expect(POST({ request: missingRequest } as Parameters<typeof POST>[0])).rejects.toThrow(
			"Stripe commerce webhook secret is not set",
		);
		expect(mocks.process).toHaveBeenCalledTimes(2);
	});
});
