import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STRIPE_API_VERSION } from "$lib/server/stripeApiVersion";

const mocks = vi.hoisted(() => ({
	convex: { mutation: vi.fn(), query: vi.fn() },
	createLumaPrintsOrder: vi.fn(),
	resend: {},
	stripe: undefined as unknown,
	env: {
		STRIPE_CONNECT_WEBHOOK_SECRET: undefined as string | undefined,
		STRIPE_WEBHOOK_SECRET: "your-account-signing-secret",
		WEBHOOK_SECRET: "convex-webhook-authority",
	},
}));

vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/convexClient", () => ({ getConvex: () => mocks.convex }));
vi.mock("$lib/server/lumaprints", () => ({ createOrder: mocks.createLumaPrintsOrder }));
vi.mock("$lib/server/resendClient", () => ({ getResend: () => mocks.resend }));
vi.mock("$lib/server/stripeClient", () => ({ getStripe: () => mocks.stripe }));

const IDS = {
	event: "evt_refundupdated123456",
	refund: "re_refund1234567890",
	charge: "ch_charge1234567890",
	paymentIntent: "pi_payment1234567890",
	session: "cs_test_session1234567890",
	context: "acct_1234567890abcdef",
};

function signedRequest(
	stripe: Stripe,
	context: unknown = IDS.context,
	options: { account?: string; secret?: string } = {},
) {
	const payload = JSON.stringify({
		id: IDS.event,
		account: options.account,
		object: "event",
		api_version: STRIPE_API_VERSION,
		created: 1_800_000_000,
		context,
		data: {
			object: {
				id: IDS.refund,
				object: "refund",
				amount: 1500,
				charge: IDS.charge,
				currency: "usd",
				metadata: {},
				payment_intent: IDS.paymentIntent,
				status: "succeeded",
			},
		},
		livemode: false,
		pending_webhooks: 1,
		request: { id: null, idempotency_key: null },
		type: "refund.updated",
	});
	const signature = stripe.webhooks.generateTestHeaderString({
		payload,
		secret: options.secret ?? mocks.env.STRIPE_WEBHOOK_SECRET,
	});
	return new Request("https://angelsrest.test/api/webhooks/stripe", {
		method: "POST",
		headers: { "stripe-signature": signature },
		body: payload,
	});
}

describe("signed refund webhook", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.env.STRIPE_CONNECT_WEBHOOK_SECRET = undefined;
		const stripe = new Stripe("sk_test_non_provider_placeholder", {
			apiVersion: STRIPE_API_VERSION,
		});
		const sessionList = {
			object: "list",
			url: "/v1/checkout/sessions",
			data: [
				{
					id: IDS.session,
					object: "checkout.session",
					amount_total: 1500,
					currency: "usd",
					livemode: false,
					metadata: null,
					mode: "payment",
					payment_intent: IDS.paymentIntent,
					payment_status: "paid",
					status: "complete",
				} as Stripe.Checkout.Session,
			],
			has_more: false,
		} as unknown as Awaited<ReturnType<typeof stripe.checkout.sessions.list>>;
		vi.spyOn(stripe.checkout.sessions, "list").mockResolvedValue(sessionList);
		mocks.stripe = stripe;
		mocks.convex.mutation.mockResolvedValue({ kind: "reconciled" });
	});

	it("verifies and reconciles a Clover refund.updated Snapshot without outbound effects", async () => {
		const { POST } = await import("../+server");
		const stripe = mocks.stripe as Stripe;

		const response = await POST({ request: signedRequest(stripe) } as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ received: true });
		expect(stripe.checkout.sessions.list).toHaveBeenCalledWith(
			{
				payment_intent: IDS.paymentIntent,
				limit: 2,
			},
			{ stripeContext: IDS.context },
		);
		expect(mocks.convex.mutation).toHaveBeenCalledOnce();
		const mutationArgs = mocks.convex.mutation.mock.calls[0]?.[1];
		expect(mutationArgs).toEqual(
			expect.objectContaining({
				stripeEventId: IDS.event,
				stripeRefundId: IDS.refund,
				stripeSessionId: IDS.session,
				siteUrl: "angelsrest.online",
			}),
		);
		expect(mutationArgs).not.toHaveProperty("stripeConnectedAccountId");
		expect(mutationArgs).not.toHaveProperty("stripeTenantMetadataSiteUrl");
		expect(mocks.createLumaPrintsOrder).not.toHaveBeenCalled();
	});

	it("rejects a signed non-string context before outbound effects", async () => {
		const { POST } = await import("../+server");
		const stripe = mocks.stripe as Stripe;

		const response = await POST({
			request: signedRequest(stripe, [IDS.context]),
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		expect(stripe.checkout.sessions.list).not.toHaveBeenCalled();
		expect(mocks.convex.query).not.toHaveBeenCalled();
		expect(mocks.convex.mutation).not.toHaveBeenCalled();
		expect(mocks.createLumaPrintsOrder).not.toHaveBeenCalled();
	});

	it("rejects a signed connected refund with a non-string context", async () => {
		const connectedSecret = "connected-account-signing-secret";
		mocks.env.STRIPE_CONNECT_WEBHOOK_SECRET = connectedSecret;
		const { POST } = await import("../+server");
		const stripe = mocks.stripe as Stripe;

		const response = await POST({
			request: signedRequest(stripe, [IDS.context], {
				account: IDS.context,
				secret: connectedSecret,
			}),
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		expect(stripe.checkout.sessions.list).not.toHaveBeenCalled();
		expect(mocks.convex.query).not.toHaveBeenCalled();
		expect(mocks.convex.mutation).not.toHaveBeenCalled();
		expect(mocks.createLumaPrintsOrder).not.toHaveBeenCalled();
	});
});
