/// <reference types="vite/client" />
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import { convexTest } from "convex-test";
import { Resend } from "resend";
import Stripe from "stripe";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "$convex/api";
import schema from "../../../../packages/crm-api/convex/schema";
import { STRIPE_API_VERSION } from "../../../../packages/crm-api/src/stripeContract";

const mocks = vi.hoisted(() => ({
	convex: vi.fn(),
	stripe: vi.fn(),
	resend: vi.fn(),
	customer: vi.fn(),
	admin: vi.fn(),
	env: {
		WEBHOOK_SECRET: "journey-webhook-fixture",
		STRIPE_SECRET_KEY: "sk_test_fixture",
		STRIPE_WEBHOOK_SECRET: "whsec_journey_fixture",
		ORDER_PRODUCERS_STATE: "open",
		COMMERCE_INTAKE_ENABLED: "true",
		CHECKOUT_SNAPSHOT_MODE: "handle-v2",
	},
}));
vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/convexClient", () => ({ getConvex: mocks.convex }));
vi.mock("$lib/server/stripeClient", () => ({ getStripe: mocks.stripe }));
vi.mock("$lib/server/resendClient", () => ({ getResend: mocks.resend }));
vi.mock("$lib/server/webhookEmails", async (importOriginal) => ({
	...(await importOriginal<typeof import("../webhookEmails")>()),
	sendCustomerConfirmation: mocks.customer,
	sendAdminNotification: mocks.admin,
}));
const modules = import.meta.glob("../../../../packages/crm-api/convex/**/*.ts");
const sessionId = "cs_test_journey1234567890123456";
const siteUrl = "angelsrest.online";
const session = {
	id: sessionId,
	object: "checkout.session",
	mode: "payment",
	payment_status: "paid",
	amount_total: 1000,
	amount_subtotal: 1000,
	currency: "usd",
	livemode: false,
	created: 1790000000,
	expires_at: 1790086400,
	customer_email: "buyer@example.invalid",
	customer_details: { email: "buyer@example.invalid", name: "Fixture" },
	payment_intent: null,
	metadata: { commerceTenantSiteUrl: siteUrl, isDigital: "true" },
	collected_information: null,
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
	vi.clearAllMocks();
	vi.stubEnv("WEBHOOK_SECRET", mocks.env.WEBHOOK_SECRET);
	vi.stubEnv("ORDER_PRODUCERS_STATE", "open");
	vi.stubEnv(
		"COMMERCE_INTAKE_SCOPES",
		JSON.stringify({ version: 1, sites: [{ siteUrl, mode: "test" }] }),
	);
	mocks.env.COMMERCE_INTAKE_ENABLED = "true";
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

test("signed acknowledgement survives partial receipt completion and retries only unacknowledged work", async () => {
	const t = convexTest(schema, modules);
	await t.run((ctx) =>
		ctx.db.insert("platformClients", {
			siteUrl,
			name: "Fixture",
			email: "operator@example.invalid",
			adminEmails: ["operator@example.invalid"],
			tier: "full",
			subscriptionStatus: "active",
			role: "creator",
		}),
	);
	// This order checkpoint survived an earlier interrupted intake; no receipt was recorded yet.
	const orderId = await t.run((ctx) =>
		ctx.db.insert("orders", {
			siteUrl,
			orderNumber: "ORD-001",
			stripeSessionId: sessionId,
			stripePaymentLivemode: false,
			customerEmail: "buyer@example.invalid",
			total: 1000,
			items: [{ productName: "Digital", quantity: 1, price: 1000 }],
			fulfillmentType: "digital",
			status: "new",
		}),
	);
	const convex = new ConvexHttpClient("https://fixture.convex.cloud");
	let loseAdminCheckpoint = true;
	vi.spyOn(convex, "query").mockImplementation((...args: Parameters<ConvexHttpClient["query"]>) =>
		t.query(args[0], args[1]),
	);
	vi.spyOn(convex, "mutation").mockImplementation(
		async (...args: Parameters<ConvexHttpClient["mutation"]>) => {
			const input: unknown = args[1];
			if (
				getFunctionName(args[0]) === "orders:completeOrderReceipt" &&
				input &&
				typeof input === "object" &&
				"audience" in input &&
				input.audience === "admin" &&
				loseAdminCheckpoint
			) {
				loseAdminCheckpoint = false;
				throw new Error("Synthetic lost receipt checkpoint after provider acceptance");
			}
			return t.mutation(args[0], args[1]);
		},
	);
	mocks.convex.mockReturnValue(convex);
	mocks.resend.mockReturnValue(new Resend("re_fixture"));
	const providerRead = vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes(`/checkout/sessions/${sessionId}/line_items`)) {
			return Response.json({
				object: "list",
				data: [
					{
						id: "li_fixture",
						object: "item",
						description: "Digital",
						quantity: 1,
						amount_total: 1000,
						amount_subtotal: 1000,
						currency: "usd",
						price: { id: "price_fixture", unit_amount: 1000 },
					},
				],
				has_more: false,
				url: "/fixture",
			});
		}
		if (url.includes(`/checkout/sessions/${sessionId}`)) return Response.json(session);
		throw new Error("Unexpected provider request");
	});
	const stripe = new Stripe("sk_test_fixture", {
		apiVersion: STRIPE_API_VERSION,
		httpClient: Stripe.createFetchHttpClient(providerRead),
	});
	mocks.stripe.mockReturnValue(stripe);
	const acceptedKeys = new Set<string>();
	for (const send of [mocks.customer, mocks.admin])
		send.mockImplementation(async (_resend, _input, key: string) => {
			acceptedKeys.add(key);
		});
	const { POST } = await import("../../../routes/api/webhooks/stripe/+server");
	const body = JSON.stringify({
		id: "evt_journey1234567890123456",
		object: "event",
		type: "checkout.session.completed",
		api_version: STRIPE_API_VERSION,
		created: 1790000000,
		livemode: false,
		data: { object: session },
	});
	const signature = stripe.webhooks.generateTestHeaderString({
		payload: body,
		secret: mocks.env.STRIPE_WEBHOOK_SECRET,
	});
	const request = () =>
		new Request("http://localhost/api/webhooks/stripe", {
			method: "POST",
			headers: { "stripe-signature": signature },
			body,
		});
	expect((await POST({ request: request() } as Parameters<typeof POST>[0])).status).toBe(200);
	expect(mocks.customer).not.toHaveBeenCalled();
	expect(providerRead).not.toHaveBeenCalled();
	let inbox = await t.run((ctx) => ctx.db.query("commerceIntakeInbox").unique());
	if (!inbox) throw new Error("Expected accepted event");
	const inboxId = inbox._id;
	const { runCommerceIntakeStep } = await import("../commerceIntakeJob");
	for (let attempt = 0; attempt < 2; attempt++) {
		inbox = await t.run((ctx) => ctx.db.get(inboxId));
		if (!inbox) throw new Error("Missing receipt");
		vi.setSystemTime(inbox.nextAt);
		await t.mutation(internal.commerceIntakeInbox.wake, {
			inboxId,
			version: inbox.version,
			nextAt: inbox.nextAt,
		});
		const claimed = await t.run((ctx) => ctx.db.get(inboxId));
		if (!claimed?.leaseToken) throw new Error("Expected lease");
		await runCommerceIntakeStep(inboxId, claimed.leaseToken);
		if (attempt === 0) {
			expect(await t.run((ctx) => ctx.db.get(inboxId))).toMatchObject({ state: "retry" });
			expect(await t.run((ctx) => ctx.db.get(orderId))).toMatchObject({
				orderReceiptCustomerSentAt: expect.any(Number),
			});
			expect((await t.run((ctx) => ctx.db.get(orderId)))?.orderReceiptAdminSentAt).toBeUndefined();
		}
	}
	expect(await t.run((ctx) => ctx.db.get(inboxId))).toMatchObject({
		state: "done",
		attempts: 2,
		orderId,
	});
	expect(await t.run((ctx) => ctx.db.query("orders").take(2))).toHaveLength(1);
	expect(mocks.customer).toHaveBeenCalledTimes(1);
	expect(mocks.admin).toHaveBeenCalledTimes(2);
	expect(acceptedKeys).toEqual(
		new Set([`order-receipt-customer:${sessionId}`, `order-receipt-admin:${sessionId}`]),
	);
	mocks.env.COMMERCE_INTAKE_ENABLED = "false";
	const reads = providerRead.mock.calls.length;
	expect((await POST({ request: request() } as Parameters<typeof POST>[0])).status).toBe(200);
	expect(providerRead).toHaveBeenCalledTimes(reads);
	expect(mocks.admin).toHaveBeenCalledTimes(2);
});
