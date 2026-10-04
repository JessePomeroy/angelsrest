import { ConvexHttpClient } from "convex/browser";
import type Stripe from "stripe";
import { beforeEach, expect, test, vi } from "vitest";
import type { Id } from "$convex/dataModel";
import {
	intakeEnvelopeDigest,
	parseCommerceIntakeEnvelope,
} from "../../../../packages/crm-api/convex/helpers/commerceIntakeEnvelope";
import { STRIPE_API_VERSION } from "../../../../packages/crm-api/src/stripeContract";

const mocks = vi.hoisted(() => ({
	query: vi.fn(),
	mutation: vi.fn(),
	process: vi.fn(),
	stripe: vi.fn(),
	resend: vi.fn(),
	env: {
		STRIPE_SECRET_KEY: "sk_test_fixture",
		WEBHOOK_SECRET: "webhook-fixture",
		COMMERCE_INTAKE_ENABLED: "false",
	},
}));
vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/convexClient", () => ({
	getConvex: () => ({ query: mocks.query, mutation: mocks.mutation }),
}));
vi.mock("$lib/server/stripeClient", () => ({ getStripe: mocks.stripe }));
vi.mock("$lib/server/resendClient", () => ({ getResend: mocks.resend }));
vi.mock("$lib/server/lumaprints", () => ({ createOrderLumaPrintsClient: vi.fn() }));
vi.mock("$lib/server/orderIntake", () => ({ processStripeWebhookEvent: mocks.process }));
vi.mock("$lib/server/logger", () => ({
	logStructured: vi.fn(),
	withPrivateIntakeLogs: (work: () => Promise<unknown>) => work(),
}));
const inboxId = "j1234567890123456789012345678901" as Id<"commerceIntakeInbox">;
const leaseToken = "00000000-0000-4000-8000-000000000001";

function rawEnvelope() {
	return JSON.stringify({
		version: 1,
		role: "your-account",
		event: {
			id: "evt_worker1234567890123456",
			type: "checkout.session.completed",
			api_version: STRIPE_API_VERSION,
			created: 1790000000,
			livemode: false,
			account: null,
			session: {
				id: "cs_test_worker1234567890123456",
				mode: "payment",
				metadata: { commerceTenantSiteUrl: "angelsrest.online" },
				amount_total: 1000,
				amount_subtotal: 1000,
				payment_status: "paid",
				currency: "usd",
				livemode: false,
				created: 1790000000,
				expires_at: 1790086400,
				customer_email: "buyer@example.invalid",
				payment_intent: null,
				customer_details: null,
				shipping_details: null,
			},
		},
	});
}

beforeEach(async () => {
	vi.clearAllMocks();
	mocks.env.STRIPE_SECRET_KEY = "sk_test_fixture";
	mocks.env.COMMERCE_INTAKE_ENABLED = "false";
	mocks.mutation.mockReset().mockResolvedValue(null);
	mocks.process.mockReset().mockResolvedValue(undefined);
	const eventJson = parseCommerceIntakeEnvelope(rawEnvelope()).eventJson;
	mocks.query.mockReset().mockResolvedValue({
		eventJson,
		digest: await intakeEnvelopeDigest(eventJson),
		siteUrl: "angelsrest.online",
		livemode: false,
	});
});

test("a worker replays the typed saved event and asks Convex to establish completion", async () => {
	const { runCommerceIntakeStep } = await import("../commerceIntakeJob");
	await runCommerceIntakeStep(inboxId, leaseToken);
	expect(mocks.query).toHaveBeenCalledWith(expect.anything(), {
		inboxId,
		leaseToken,
		webhookSecret: "webhook-fixture",
	});
	expect(mocks.process).toHaveBeenCalledWith(
		parseCommerceIntakeEnvelope(rawEnvelope()).event,
		expect.anything(),
		"your-account",
	);
	expect(mocks.mutation).toHaveBeenCalledWith(expect.anything(), {
		inboxId,
		leaseToken,
		webhookSecret: "webhook-fixture",
		result: { kind: "processed", version: 1 },
	});
});

test("processing failure schedules retry without leaking provider error text", async () => {
	mocks.process.mockRejectedValue(new Error("buyer@example.invalid provider payload"));
	const { runCommerceIntakeStep } = await import("../commerceIntakeJob");
	await runCommerceIntakeStep(inboxId, leaseToken);
	expect(mocks.mutation.mock.calls[0][1].result).toEqual({
		kind: "retry",
		code: "processing_failed",
	});
	expect(JSON.stringify(mocks.mutation.mock.calls)).not.toContain("buyer@example.invalid");
});

test.each([
	"digest",
	"mode",
])("invalid retained %s blocks before Stripe or email construction", async (kind) => {
	if (kind === "digest")
		mocks.query.mockResolvedValue({ eventJson: rawEnvelope(), digest: "wrong", livemode: false });
	else mocks.env.STRIPE_SECRET_KEY = "sk_live_fixture";
	const { runCommerceIntakeStep } = await import("../commerceIntakeJob");
	await runCommerceIntakeStep(inboxId, leaseToken);
	expect(mocks.mutation.mock.calls[0][1].result).toEqual({
		kind: "blocked",
		code: kind === "digest" ? "payload_invalid" : "scope_conflict",
	});
	expect(mocks.stripe).not.toHaveBeenCalled();
	expect(mocks.resend).not.toHaveBeenCalled();
	expect(mocks.process).not.toHaveBeenCalled();
});

test("an unavailable lease cannot begin provider work or advance another claim", async () => {
	mocks.query.mockRejectedValue(new Error("Lease expired"));
	const { runCommerceIntakeStep } = await import("../commerceIntakeJob");
	await expect(runCommerceIntakeStep(inboxId, leaseToken)).rejects.toThrow("Lease expired");
	expect(mocks.process).not.toHaveBeenCalled();
	expect(mocks.mutation).not.toHaveBeenCalled();
});

test("unsupported checkout variants still consult the accepted-event guard", async () => {
	const { acceptCommerceIntake } = await import("../commerceIntakeJob");
	const event = {
		...parseCommerceIntakeEnvelope(rawEnvelope()).event,
	} as Stripe.CheckoutSessionCompletedEvent;
	event.data.object.metadata = { type: "invoice_payment" };
	mocks.mutation.mockResolvedValue({ kind: "synchronous" });
	const convex = new ConvexHttpClient("https://fixture.convex.cloud");
	vi.spyOn(convex, "mutation").mockImplementation(mocks.mutation);
	expect(await acceptCommerceIntake(event, "your-account", convex)).toBe(false);
	expect(mocks.mutation.mock.calls[0][1]).toMatchObject({
		stripeEventId: event.id,
		eventJson: null,
		allowNew: false,
	});
});
