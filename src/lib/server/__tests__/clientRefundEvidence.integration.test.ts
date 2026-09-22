/// <reference types="vite/client" />
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import { convexTest } from "convex-test";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../../../../packages/crm-api/convex/schema";
import { reconcileSucceededManualRefund } from "../recovery/manualRefundReconciliation.server";
import { STRIPE_API_VERSION } from "../stripeApiVersion";

const env = vi.hoisted(() => ({
	WEBHOOK_SECRET: "client-refund-integration-0123456789abcdef",
	STRIPE_CONNECT_WEBHOOK_SECRET: "client-refund-connected-signature-secret",
	CLIENT_REFUND_EVIDENCE_ENABLED: "true" as string | undefined,
}));
const runtime = vi.hoisted(() => ({
	stripe: undefined as unknown,
	convex: undefined as unknown,
	fulfill: vi.fn(),
	resend: {},
}));
vi.mock("$env/dynamic/private", () => ({ env }));
vi.mock("$lib/server/logger", () => ({ logStructured: vi.fn() }));
vi.mock("$lib/server/convexClient", () => ({ getConvex: () => runtime.convex }));
vi.mock("$lib/server/stripeClient", () => ({ getStripe: () => runtime.stripe }));
vi.mock("$lib/server/resendClient", () => ({ getResend: () => runtime.resend }));
vi.mock("$lib/server/lumaprints", () => ({ createOrderLumaPrintsClient: runtime.fulfill }));
const modules = import.meta.glob("../../../../packages/crm-api/convex/**/*.ts");
const TENANT = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b";
const PLATFORM = "acct_platform1234567890";
const ACCOUNT = "acct_client12345678901";
const SESSION = "cs_test_original1234567890";
const PI = "pi_original1234567890";
const CHARGE = "ch_original1234567890";
const REFUND = "re_original1234567890";
const snapshot = {
	version: 1 as const,
	policy: "print_subtotal_5pct_floor_v1" as const,
	tenantId: TENANT,
	stripePlatformAccountId: PLATFORM,
	stripeConnectedAccountId: ACCOUNT,
	stripeLivemode: false,
	currency: "usd" as const,
	subtotalCents: 10000,
	printSubtotalCents: 10000,
	applicationFeeAmountCents: 500,
	lines: [{ productKind: "print" as const, unitPriceCents: 5000, quantity: 2 }],
};
// Minimal provider fixtures deliberately permit malformed fields for boundary tests.
function response<T>(value: unknown) {
	return value as Stripe.Response<T>;
}
function refund(status = "succeeded", amount = 4000) {
	return response<Stripe.Refund>({
		id: REFUND,
		object: "refund",
		charge: CHARGE,
		payment_intent: PI,
		amount,
		currency: "usd",
		status,
		metadata: {},
	});
}
function event(status = "succeeded", amount = 4000): Stripe.RefundUpdatedEvent {
	return {
		id: "evt_original1234567890",
		object: "event",
		type: "refund.updated",
		account: ACCOUNT,
		livemode: false,
		api_version: STRIPE_API_VERSION,
		created: 1_800_000_000,
		pending_webhooks: 1,
		request: null,
		data: { object: refund(status, amount) },
	};
}
function session() {
	return response<Stripe.Checkout.Session>({
		id: SESSION,
		object: "checkout.session",
		mode: "payment",
		status: "complete",
		payment_status: "paid",
		amount_total: 11000,
		amount_subtotal: 10000,
		currency: "usd",
		livemode: false,
		payment_intent: PI,
		metadata: { commerceTenantSiteUrl: "client.example", commerceTenantId: TENANT },
	});
}
function charge() {
	return response<Stripe.Charge>({
		id: CHARGE,
		object: "charge",
		payment_intent: PI,
		amount: 11000,
		amount_captured: 11000,
		currency: "usd",
		livemode: false,
		paid: true,
		captured: true,
		status: "succeeded",
	});
}

beforeEach(() => {
	env.CLIENT_REFUND_EVIDENCE_ENABLED = "true";
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
	vi.stubEnv("WEBHOOK_SECRET", env.WEBHOOK_SECRET);
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			throw new Error("Unexpected network access in offline refund test");
		}),
	);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

async function setup(beforeOrder = false) {
	const t = convexTest(schema, modules);
	const clientId = await t.run((ctx) =>
		ctx.db.insert("platformClients", {
			siteUrl: "client.example",
			tenantId: TENANT,
			stripeConnectedAccountId: ACCOUNT,
			name: "Client",
			email: "owner@example.invalid",
			adminEmails: ["owner@example.invalid"],
			role: "client",
			tier: "full",
			subscriptionStatus: "active",
		}),
	);
	await t.run((ctx) =>
		ctx.db.insert("stripeAccountBindings", {
			clientId,
			tenantId: TENANT,
			stripeConnectedAccountId: ACCOUNT,
			platformAccountId: PLATFORM,
			livemode: false,
			boundAt: Date.now(),
			attemptId: "original-attempt",
		}),
	);
	const orderId = beforeOrder
		? null
		: await t.run((ctx) =>
				ctx.db.insert("orders", {
					siteUrl: "client.example",
					tenantId: TENANT,
					stripeSessionId: SESSION,
					stripePaymentIntentId: PI,
					stripeConnectedAccountId: ACCOUNT,
					stripePaymentCurrency: "usd",
					stripePaymentLivemode: false,
					checkoutFinancialSnapshot: snapshot,
					orderNumber: "ORD-001",
					customerEmail: "buyer@example.invalid",
					items: [],
					total: 11000,
					status: "new",
					fulfillmentType: "self",
				}),
			);
	if (beforeOrder)
		await t.run((ctx) =>
			ctx.db.insert("checkoutSessionAdmissions", {
				protocolVersion: 1,
				siteUrl: "client.example",
				tenantId: TENANT,
				stripeConnectedAccountId: ACCOUNT,
				accountScope: `connected:${ACCOUNT}`,
				attemptDigest: "a".repeat(64),
				proofClass: "same_origin_host_proof",
				admissionHandleHash: "b".repeat(64),
				hostGeneration: 1,
				admissionGeneration: 1,
				state: "bound",
				requestFingerprint: "c".repeat(64),
				createdAt: Date.now(),
				updatedAt: Date.now(),
				boundAt: Date.now(),
				stripeSessionId: SESSION,
				checkoutFinancialSnapshot: snapshot,
			}),
		);
	const convex = new ConvexHttpClient("https://test.convex.cloud");
	vi.spyOn(convex, "mutation").mockImplementation(
		(...args: Parameters<ConvexHttpClient["mutation"]>) => t.mutation(args[0], args[1]),
	);
	vi.spyOn(convex, "query").mockImplementation((...args: Parameters<ConvexHttpClient["query"]>) =>
		t.query(args[0], args[1]),
	);
	const stripe = new Stripe("sk_test_offline_refund_fixture", { apiVersion: STRIPE_API_VERSION });
	const list = vi.spyOn(stripe.checkout.sessions, "list").mockResolvedValue(
		response<Stripe.ApiList<Stripe.Checkout.Session>>({
			object: "list",
			data: [session()],
			has_more: false,
			url: "/v1/checkout/sessions",
		}),
	);
	const platform = vi
		.spyOn(stripe.accounts, "retrieve")
		.mockResolvedValue(response<Stripe.Account>({ object: "account", id: PLATFORM }));
	const balance = vi
		.spyOn(stripe.balance, "retrieve")
		.mockResolvedValue(response<Stripe.Balance>({ object: "balance", livemode: false }));
	const readRefund = vi.spyOn(stripe.refunds, "retrieve").mockResolvedValue(refund());
	const readCharge = vi.spyOn(stripe.charges, "retrieve").mockResolvedValue(charge());
	const createRefund = vi
		.spyOn(stripe.refunds, "create")
		.mockRejectedValue(new Error("Refund POST is forbidden in evidence capture"));
	const createFeeRefund = vi
		.spyOn(stripe.applicationFees, "createRefund")
		.mockRejectedValue(new Error("Fee POST is forbidden in evidence capture"));
	const run = (value = event()) =>
		reconcileSucceededManualRefund(value, { stripe, convex }, "connected-accounts");
	const row = () =>
		t.run((ctx) =>
			ctx.db
				.query("clientRefundEvidence")
				.take(1)
				.then((rows) => rows[0]),
		);
	return {
		t,
		orderId,
		stripe,
		convex,
		list,
		platform,
		balance,
		readRefund,
		readCharge,
		createRefund,
		createFeeRefund,
		run,
		row,
	};
}

describe("current client refund evidence through the existing webhook consumer", () => {
	test.each([
		undefined,
		"false",
		"TRUE",
		"1",
	])("keeps the old consumer when capture is not explicitly enabled: %s", async (value) => {
		const s = await setup();
		env.CLIENT_REFUND_EVIDENCE_ENABLED = value;
		expect(await s.run()).toEqual({ kind: "ignored", reason: "session_amount_mismatch" });
		expect(s.convex.mutation).not.toHaveBeenCalled();
		expect(s.readRefund).not.toHaveBeenCalled();
		s.list.mockClear();
		expect(await s.run(event("pending"))).toEqual({ kind: "ignored", reason: "not_succeeded" });
		expect(s.list).not.toHaveBeenCalled();
	});
	test.each([
		null,
		{},
		{ type: "invoice_payment" },
		{ commerceTenantId: TENANT },
	])("cannot downgrade a known financial checkout through omitted or changed Session metadata: %j", async (metadata) => {
		const s = await setup();
		s.list.mockResolvedValue(
			response<Stripe.ApiList<Stripe.Checkout.Session>>({
				object: "list",
				data: [{ ...session(), metadata }],
				has_more: false,
				url: "/v1/checkout/sessions",
			}),
		);
		await expect(s.run()).rejects.toThrow("does not match");
		expect(await s.row()).toMatchObject({
			state: "attention",
			tenantId: TENANT,
			issue: "evidence_mismatch",
		});
		expect(s.readRefund).not.toHaveBeenCalled();
	});

	test("accepts a correctly signed partial refund through the real hub HTTP handler", async () => {
		const s = await setup();
		runtime.stripe = s.stripe;
		runtime.convex = s.convex;
		const { POST } = await import("../../../routes/api/webhooks/stripe/+server");
		const payload = JSON.stringify(event());
		const signature = s.stripe.webhooks.generateTestHeaderString({
			payload,
			secret: env.STRIPE_CONNECT_WEBHOOK_SECRET,
		});
		const result = await POST({
			request: new Request("https://angelsrest.test/api/webhooks/stripe", {
				method: "POST",
				headers: { "stripe-signature": signature },
				body: payload,
			}),
		} as Parameters<typeof POST>[0]);
		expect(result.status).toBe(200);
		expect(await result.json()).toEqual({ received: true });
		expect((await s.row())?.observation?.amountCents).toBe(4000);
		expect(runtime.fulfill).not.toHaveBeenCalled();
		expect(s.createRefund).not.toHaveBeenCalled();
	});

	test("recovers a lost persistence acknowledgement without duplicating a record or provider write", async () => {
		const s = await setup();
		let dropAcknowledgement = true;
		vi.mocked(s.convex.mutation).mockImplementation(
			async (...args: Parameters<ConvexHttpClient["mutation"]>) => {
				const result = await s.t.mutation(args[0], args[1]);
				if (
					getFunctionName(args[0]) === "orders:finishClientRefundObservation" &&
					dropAcknowledgement
				) {
					dropAcknowledgement = false;
					throw new Error("Persistence response lost");
				}
				return result;
			},
		);
		await expect(s.run()).rejects.toThrow("unavailable");
		expect(await s.row()).toMatchObject({
			state: "observed",
			observation: { status: "succeeded" },
		});
		expect(await s.run()).toEqual({ kind: "client_refund_recorded" });
		expect(await s.t.run((ctx) => ctx.db.query("clientRefundEvidence").take(2))).toHaveLength(1);
		expect(s.createRefund).not.toHaveBeenCalled();
		expect(s.createFeeRefund).not.toHaveBeenCalled();
	});

	test("records a partial refund with original provider scope and no financial writes", async () => {
		const s = await setup();
		const orderId = s.orderId;
		if (!orderId) throw new Error("Missing order");
		expect(await s.run()).toEqual({ kind: "client_refund_recorded" });
		expect(await s.row()).toMatchObject({
			state: "observed",
			tenantId: TENANT,
			observation: { amountCents: 4000, totalCents: 11000, status: "succeeded" },
		});
		expect(s.readRefund).toHaveBeenCalledWith(REFUND, {
			stripeAccount: ACCOUNT,
			timeout: 10000,
			maxNetworkRetries: 0,
		});
		expect(s.readCharge).toHaveBeenCalledWith(CHARGE, {
			stripeAccount: ACCOUNT,
			timeout: 10000,
			maxNetworkRetries: 0,
		});
		expect(s.platform).toHaveBeenCalledWith({ timeout: 10000, maxNetworkRetries: 0 });
		expect(s.balance).toHaveBeenCalledWith({ timeout: 10000, maxNetworkRetries: 0 });
		expect((await s.t.run((ctx) => ctx.db.get(orderId)))?.status).toBe("new");
		expect(s.createRefund).not.toHaveBeenCalled();
		expect(s.createFeeRefund).not.toHaveBeenCalled();
	});

	test("retains a partial refund that arrives before paid intake", async () => {
		const s = await setup(true);
		expect(await s.run()).toEqual({ kind: "client_refund_recorded" });
		expect((await s.row())?.observation?.amountCents).toBe(4000);
		expect(await s.t.run((ctx) => ctx.db.query("orders").take(1))).toEqual([]);
	});

	test.each([
		"pending",
		"requires_action",
		"failed",
		"canceled",
	])("records current %s state instead of ignoring it", async (status) => {
		const s = await setup();
		s.readRefund.mockResolvedValue(refund(status));
		expect(await s.run(event(status))).toEqual({ kind: "client_refund_recorded" });
		expect((await s.row())?.observation?.status).toBe(status);
	});

	test("uses fresh provider state when an old signed success arrives after a later failure", async () => {
		const s = await setup();
		await s.run();
		s.readRefund.mockResolvedValue(refund("failed"));
		await s.run({ ...event("failed"), id: "evt_failed1234567890", type: "refund.updated" });
		await s.run(event("succeeded"));
		expect((await s.row())?.observation?.status).toBe("failed");
		expect(await s.t.run((ctx) => ctx.db.query("clientRefundEvidence").take(2))).toHaveLength(1);
	});

	test("preserves existing whole-order reconciliation after capturing a full refund", async () => {
		const s = await setup();
		const orderId = s.orderId;
		if (!orderId) throw new Error("Missing order");
		s.readRefund.mockResolvedValue(refund("succeeded", 11000));
		expect(await s.run(event("succeeded", 11000))).toMatchObject({ kind: "reconciled" });
		expect((await s.t.run((ctx) => ctx.db.get(orderId)))?.status).toBe("refunded");
		expect((await s.row())?.observation?.amountCents).toBe(11000);
	});

	test.each([
		["platform", { object: "account", id: "acct_other12345678901" }],
		["balance", { object: "balance", livemode: true }],
		["readRefund", { ...refund(), payment_intent: "pi_other1234567890" }],
		["readRefund", { ...refund(), amount: 4001 }],
		["readRefund", { ...refund(), charge: "ch_other1234567890" }],
		["readRefund", { ...refund(), currency: "eur" }],
		["readRefund", { ...refund(), status: "unknown" }],
		["readCharge", { ...charge(), livemode: true }],
		["readCharge", { ...charge(), payment_intent: "pi_other1234567890" }],
		["readCharge", { ...charge(), amount_captured: 10000 }],
	] as const)("rejects mismatched %s provider facts", async (method, value) => {
		const s = await setup();
		s[method].mockResolvedValue(response(value));
		await expect(s.run()).rejects.toThrow("does not match");
		expect(await s.row()).toMatchObject({ state: "attention", issue: "evidence_mismatch" });
		expect((await s.row())?.observation).toBeUndefined();
	});

	test("retains earlier evidence when a later provider read fails", async () => {
		const s = await setup();
		await s.run();
		s.readRefund.mockRejectedValue(new Error("private detail"));
		await expect(s.run()).rejects.toThrow("unavailable");
		expect(await s.row()).toMatchObject({
			state: "attention",
			issue: "provider_unavailable",
			observation: { status: "succeeded" },
		});
		expect(JSON.stringify(await s.row())).not.toContain("private detail");
	});

	test("does not inspect providers for a historical checkout without a captured financial record", async () => {
		const s = await setup();
		const orderId = s.orderId;
		if (!orderId) throw new Error("Missing order");
		await s.t.run((ctx) => ctx.db.patch(orderId, { checkoutFinancialSnapshot: undefined }));
		expect(await s.run()).toEqual({ kind: "ignored", reason: "session_amount_mismatch" });
		expect(s.readRefund).not.toHaveBeenCalled();
		expect(s.platform).not.toHaveBeenCalled();
		expect(await s.row()).toBeNull();
	});

	test("leaves a genuine connected invoice outside the financial-checkout refund protocol", async () => {
		const s = await setup();
		const orderId = s.orderId;
		if (!orderId) throw new Error("Missing order");
		await s.t.run((ctx) => ctx.db.patch(orderId, { checkoutFinancialSnapshot: undefined }));
		s.list.mockResolvedValue(
			response<Stripe.ApiList<Stripe.Checkout.Session>>({
				object: "list",
				data: [{ ...session(), metadata: { type: "invoice_payment" } }],
				has_more: false,
				url: "/v1/checkout/sessions",
			}),
		);
		expect(await s.run()).toEqual({ kind: "ignored", reason: "invoice_payment" });
		expect(await s.row()).toBeNull();
		expect(s.readRefund).not.toHaveBeenCalled();
	});

	test("rejects a connected event delivered to the wrong signed destination role", async () => {
		const s = await setup();
		expect(await reconcileSucceededManualRefund(event(), s, "your-account")).toEqual({
			kind: "ignored",
			reason: "unsupported_scope",
		});
		expect(s.list).not.toHaveBeenCalled();
		expect(s.convex.mutation).not.toHaveBeenCalled();
	});
});
