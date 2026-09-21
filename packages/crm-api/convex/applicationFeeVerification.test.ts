/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
	APPLICATION_FEE_INITIAL_DELAY_MS, APPLICATION_FEE_LEASE_MS, APPLICATION_FEE_RETRY_DELAYS,
} from "./helpers/applicationFeeVerification";
import { scheduleApplicationFeeVerification } from "./stripeFeesStore";
import schema from "./schema";

const mocks = vi.hoisted(() => ({ construct: vi.fn(), platform: vi.fn(), balance: vi.fn(),
	session: vi.fn(), payment: vi.fn(), fee: vi.fn() }));
vi.mock("stripe", () => ({ default: class Stripe {
	accounts = { retrieve: mocks.platform };
	balance = { retrieve: mocks.balance };
	checkout = { sessions: { retrieve: mocks.session } };
	paymentIntents = { retrieve: mocks.payment };
	applicationFees = { retrieve: mocks.fee };
	constructor(key: string, options: unknown) { mocks.construct(key, options); }
} }));
const modules = import.meta.glob("./**/*.ts");
const TENANT = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b";
const PLATFORM = "acct_platform1234567890";
const ACCOUNT = "acct_client12345678901";
const SESSION = "cs_test_financial1234567890";
const PI = "pi_original1234567890";
const CHARGE = "ch_original1234567890";
const FEE = "fee_original1234567890";
const APP = "ca_original1234567890";
const SITE = "client.example";
const token = "attempt-token-1234567890";
const snapshot = { version: 1 as const, policy: "print_subtotal_5pct_floor_v1" as const,
	tenantId: TENANT, stripePlatformAccountId: PLATFORM, stripeConnectedAccountId: ACCOUNT,
	stripeLivemode: false, currency: "usd" as const,
	lines: [{ productKind: "print" as const, unitPriceCents: 5000, quantity: 2 }],
	subtotalCents: 10000, printSubtotalCents: 10000, applicationFeeAmountCents: 500 };
function session() { return { object: "checkout.session", id: SESSION, mode: "payment", status: "complete",
	amount_total: 11000, amount_subtotal: 10000, currency: "usd", livemode: false,
	metadata: { commerceTenantSiteUrl: SITE }, payment_status: "paid", payment_intent: PI }; }
function charge() { return { object: "charge", id: CHARGE, payment_intent: PI,
	amount: 11000, amount_captured: 11000, amount_refunded: 0, paid: true, captured: true, status: "succeeded",
	currency: "usd", livemode: false, application_fee_amount: 500, application_fee: FEE, application: APP }; }
function payment() { return { object: "payment_intent", id: PI, status: "succeeded", amount: 11000,
	amount_received: 11000, currency: "usd", livemode: false, metadata: { commerceTenantSiteUrl: SITE },
	application_fee_amount: 500, application: APP, latest_charge: charge() }; }
function fee() { return { object: "application_fee", id: FEE, account: ACCOUNT, charge: CHARGE,
	currency: "usd", livemode: false, amount: 500, amount_refunded: 0, refunded: false,
	application: APP, originating_transaction: null }; }
const observation = { stripeSessionId: SESSION, currency: "usd" as const, subtotalCents: 10000, totalCents: 11000,
	applicationFeeAmountCents: 500, applicationFeeRefundedCents: 0,
	payment: { kind: "paid" as const, stripePaymentIntentId: PI, stripeChargeId: CHARGE,
		stripeApplicationFeeId: FEE, requestedApplicationFeeCents: 500, customerRefundedCents: 0 } };

beforeEach(() => {
	vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
	vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_application_fee_read_0123456789abcdef");
	vi.stubEnv("BETTER_AUTH_SECRET", "application-fee-auth-0123456789abcdef");
	vi.stubEnv("AUTH_GOOGLE_SECRET", "application-fee-google-0123456789abcdef");
	vi.stubEnv("WEBHOOK_SECRET", "application-fee-webhook-0123456789abcdef");
	vi.stubEnv("ORDER_LOOKUP_SECRET", "application-fee-lookup-0123456789abcdef");
	for (const name of ["CATALOG_PRIVATE_ASSET_EDITOR_HOST_JOURNAL_SECRETS", "CATALOG_PRIVATE_ASSET_EDITOR_INSPECTION_CLAIM_SECRETS",
		"CATALOG_PRIVATE_EDITOR_UPLOAD_CONTROL_SECRETS", "CATALOG_PRIVATE_ASSET_STORAGE_RECEIPT_SECRETS",
		"CATALOG_PRIVATE_ASSET_INSPECTION_RECEIPT_SECRETS", "CMS_MEDIA_DELETION_COMPLETION_SECRETS", "CHECKOUT_SNAPSHOT_RESERVATION_SECRETS"]) vi.stubEnv(name, undefined);
	for (const mock of Object.values(mocks)) mock.mockReset();
	mocks.platform.mockResolvedValue({ object: "account", id: PLATFORM });
	mocks.balance.mockResolvedValue({ object: "balance", livemode: false });
	mocks.session.mockResolvedValue(session()); mocks.payment.mockResolvedValue(payment()); mocks.fee.mockResolvedValue(fee());
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup(overrides: Partial<Doc<"orders">> = {}) {
	const t = convexTest(schema, modules);
	const clientId = await t.run(ctx => ctx.db.insert("platformClients", {
		siteUrl: SITE, tenantId: TENANT, name: "Client", email: "owner@example.invalid", role: "client",
		adminEmails: ["owner@example.invalid"], tier: "full", subscriptionStatus: "active",
		stripeConnectedAccountId: ACCOUNT,
	}));
	const orderId = await t.run(ctx => ctx.db.insert("orders", {
		siteUrl: SITE, tenantId: TENANT, orderNumber: "ORD-001", stripeSessionId: SESSION,
		stripePaymentIntentId: PI, stripeConnectedAccountId: ACCOUNT, stripePaymentCurrency: "usd",
		stripePaymentLivemode: false, customerEmail: "buyer@example.invalid", items: [],
		total: 11000, fulfillmentType: "self", status: "new", checkoutFinancialSnapshot: snapshot, ...overrides,
	}));
	await t.mutation(ctx => scheduleApplicationFeeVerification(ctx, orderId));
	vi.setSystemTime(Date.now() + APPLICATION_FEE_INITIAL_DELAY_MS);
	const owner = t.withIdentity({ subject: "owner", email: "owner@example.invalid", emailVerified: true });
	const row = () => t.run(ctx => ctx.db.query("orderApplicationFees").withIndex("by_orderId", q => q.eq("orderId", orderId)).unique());
	const run = (attempt = 1) => t.action(internal.stripeFees.verifyApplicationFeeForOrder, { orderId, attempt });
	const begin = (attempt = 1, attemptToken = token) => t.mutation(internal.stripeFeesStore.beginApplicationFeeAttempt, { orderId, attempt, attemptToken });
	const finish = (attempt = 1, attemptToken = token) => t.mutation(internal.stripeFeesStore.finishApplicationFeeAttempt,
		{ orderId, attempt, attemptToken, result: { observation } });
	return { t, clientId, owner, orderId, row, run, begin, finish };
}

describe("original application-fee provider verification", () => {
	test("reads the original account and platform, with bounded requests, and records actual fee separately", async () => {
		const s = await setup();
		await s.t.run(ctx => ctx.db.patch(s.clientId, { stripeConnectedAccountId: "acct_replacement123456" }));
		await s.run();
		expect(mocks.construct).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 10000, maxNetworkRetries: 0 }));
		expect(mocks.session).toHaveBeenCalledWith(SESSION, {}, { stripeAccount: ACCOUNT });
		expect(mocks.payment).toHaveBeenCalledWith(PI, { expand: ["latest_charge"] }, { stripeAccount: ACCOUNT });
		expect(mocks.fee).toHaveBeenCalledWith(FEE);
		expect(await s.row()).toMatchObject({ status: "verified", observation, observedAt: Date.now() });
		const order = await s.t.run(ctx => ctx.db.get(s.orderId));
		expect(order?.stripeFees).toBeUndefined();
		expect(order?.checkoutFinancialSnapshot).toEqual(snapshot);
	});

	test.each(["refunded", "canceled"] as const)("verifies original fees after the order is %s", async status => {
		const s = await setup({ status, stripeRefundId: "re_original123456" });
		mocks.payment.mockResolvedValue({ ...payment(), latest_charge: { ...charge(), amount_refunded: 11000 } });
		mocks.fee.mockResolvedValue({ ...fee(), amount_refunded: 500, refunded: true });
		await s.run();
		expect(await s.row()).toMatchObject({ status: "verified", observation: { applicationFeeAmountCents: 500,
			applicationFeeRefundedCents: 500, payment: { customerRefundedCents: 11000 } } });
	});

	test("returns verified zero only from explicit provider absence, and flags a missing expected fee", async () => {
		const s = await setup();
		mocks.payment.mockResolvedValue({ ...payment(), application_fee_amount: null,
			latest_charge: { ...charge(), application_fee_amount: null, application_fee: null } });
		await s.run();
		expect(await s.row()).toMatchObject({ status: "attention", error: "fee_amount_mismatch",
			observation: { applicationFeeAmountCents: 0, payment: { stripeApplicationFeeId: null } } });
		expect(mocks.fee).not.toHaveBeenCalled();
	});

	test("verifies an intentionally fee-free paid order", async () => {
		const s = await setup({ checkoutFinancialSnapshot: { ...snapshot, lines: [{ ...snapshot.lines[0]!, productKind: "merchandise" }],
			printSubtotalCents: 0, applicationFeeAmountCents: 0 } });
		mocks.payment.mockResolvedValue({ ...payment(), application_fee_amount: 0,
			latest_charge: { ...charge(), application_fee_amount: 0, application_fee: null } });
		await s.run();
		expect(await s.row()).toMatchObject({ status: "verified", observation: { applicationFeeAmountCents: 0 } });
	});

	test("verifies free Checkout sessions without inventing a PaymentIntent", async () => {
		const s = await setup({ total: 0, stripePaymentIntentId: undefined,
			checkoutFinancialSnapshot: { ...snapshot, subtotalCents: 0, printSubtotalCents: 0, applicationFeeAmountCents: 0,
				lines: [{ ...snapshot.lines[0]!, unitPriceCents: 0 }] } });
		mocks.session.mockResolvedValue({ ...session(), amount_total: 0, amount_subtotal: 0,
			payment_status: "no_payment_required", payment_intent: null });
		await s.run();
		expect(await s.row()).toMatchObject({ status: "verified", observation: { applicationFeeAmountCents: 0, payment: { kind: "no_payment_required" } } });
		expect(mocks.payment).not.toHaveBeenCalled(); expect(mocks.fee).not.toHaveBeenCalled();
	});

	test("persists an actual-fee discrepancy without rewriting original expectations", async () => {
		const s = await setup(); mocks.fee.mockResolvedValue({ ...fee(), amount: 499 }); await s.run();
		expect(await s.row()).toMatchObject({ status: "attention", error: "fee_amount_mismatch", observation: { applicationFeeAmountCents: 499 } });
		expect((await s.t.run(ctx => ctx.db.get(s.orderId)))?.checkoutFinancialSnapshot).toEqual(snapshot);
	});

	test.each([
		["platform", { object: "account", id: "acct_wrong1234567890" }],
		["balance", { object: "balance", livemode: true }],
		["session", { ...session(), id: "cs_test_wrong1234567890" }],
		["session", { ...session(), metadata: { commerceTenantSiteUrl: "other.example" } }],
		["session", { ...session(), payment_intent: "pi_wrong1234567890" }],
		["session", { ...session(), amount_subtotal: 9999 }],
		["payment", { ...payment(), amount_received: 10999 }],
		["payment", { ...payment(), currency: "eur" }],
		["payment", { ...payment(), metadata: { commerceTenantSiteUrl: "other.example" } }],
		["payment", { ...payment(), latest_charge: { ...charge(), payment_intent: "pi_wrong1234567890" } }],
		["payment", { ...payment(), latest_charge: { ...charge(), amount_captured: 10999 } }],
		["payment", { ...payment(), latest_charge: { ...charge(), paid: "false" } }],
		["payment", { ...payment(), latest_charge: { ...charge(), amount_refunded: -1 } }],
		["payment", { ...payment(), application_fee_amount: undefined }],
		["fee", { ...fee(), account: "acct_wrong1234567890" }],
		["fee", { ...fee(), charge: "ch_wrong1234567890" }],
		["fee", { ...fee(), application: "ca_wrong1234567890" }],
		["fee", { ...fee(), currency: "eur" }],
		["fee", { ...fee(), livemode: true }],
		["fee", { ...fee(), amount_refunded: 501 }],
		["fee", { ...fee(), refunded: true }],
	] as const)("rejects unrelated/malformed %s facts: %j", async (provider, value) => {
		const s = await setup(); mocks[provider].mockResolvedValue(value); await s.run();
		expect(await s.row()).toMatchObject({ status: "attention", error: "provider_object_mismatch" });
		expect((await s.row())?.observation).toBeUndefined();
	});

	test("retries an asynchronously missing fee and captures the later object", async () => {
		const s = await setup();
		mocks.payment.mockResolvedValueOnce({ ...payment(), latest_charge: { ...charge(), application_fee: null } });
		await s.run();
		expect(await s.row()).toMatchObject({ status: "pending", error: "fee_not_ready", attempts: 1 });
		expect((await s.row())?.observation).toBeUndefined();
		await s.run(2); expect(mocks.payment).toHaveBeenCalledTimes(1);
		vi.setSystemTime(Date.now() + APPLICATION_FEE_RETRY_DELAYS[0]); await s.run(2);
		expect(await s.row()).toMatchObject({ status: "verified", attempts: 2 });
	});

	test("bounds unavailable provider retries without substituting accounts or zero", async () => {
		const s = await setup(); mocks.payment.mockRejectedValue(new Error("private provider detail"));
		for (let attempt = 1; attempt <= 4; attempt++) {
			await s.run(attempt);
			if (attempt < 4) vi.setSystemTime(Date.now() + APPLICATION_FEE_RETRY_DELAYS[attempt - 1]!);
		}
		expect(await s.row()).toMatchObject({ status: "attention", attempts: 4, error: "provider_unavailable" });
		expect((await s.row())?.observation).toBeUndefined();
		await s.run(4); await s.run(5); expect(mocks.payment).toHaveBeenCalledTimes(4);
		expect(JSON.stringify(await s.row())).not.toContain("private provider detail");
	});

	test("stops before provider access when configuration authority collides", async () => {
		const s = await setup(); vi.stubEnv("WEBHOOK_SECRET", process.env.STRIPE_SECRET_KEY!); await s.run();
		expect(await s.row()).toMatchObject({ status: "pending", error: "configuration_unavailable" });
		expect(mocks.construct).not.toHaveBeenCalled();
	});

	test.each([{ tenantId: "tenant_wrong" }, { stripeConnectedAccountId: "acct_other12345678901" },
		{ stripePaymentCurrency: "eur" }, { stripePaymentLivemode: true }, { total: NaN }])("rejects corrupt original identity %j", async overrides => {
		const s = await setup(overrides); await s.run();
		expect(await s.row()).toMatchObject({ status: "attention", error: "original_context_invalid" });
		expect(mocks.platform).not.toHaveBeenCalled();
	});
});

describe("application-fee durable claims and authorized projection", () => {
	test("rolls back the new record if its initial dispatch fails", async () => {
		const s = await setup({ checkoutFinancialSnapshot: undefined });
		await s.t.run(ctx => ctx.db.patch(s.orderId, { checkoutFinancialSnapshot: snapshot }));
		await expect(s.t.mutation(ctx => scheduleApplicationFeeVerification({ ...ctx,
			scheduler: { ...ctx.scheduler, runAfter: async () => { throw new Error("dispatch unavailable"); } },
		}, s.orderId))).rejects.toThrow("dispatch unavailable");
		expect(await s.row()).toBeNull();
	});

	test("eventually closes repeatedly abandoned claims with attention", async () => {
		const s = await setup();
		for (let attempt = 1; attempt <= 4; attempt++) {
			await s.begin(attempt, `${token}-${attempt}`);
			vi.setSystemTime(Date.now() + APPLICATION_FEE_LEASE_MS);
			await s.t.mutation(internal.stripeFeesStore.expireApplicationFeeAttempt,
				{ orderId: s.orderId, attempt, attemptToken: `${token}-${attempt}` });
			if (attempt < 4) vi.setSystemTime(Date.now() + APPLICATION_FEE_RETRY_DELAYS[attempt - 1]!);
		}
		expect(await s.row()).toMatchObject({ status: "attention", attempts: 4, error: "attempt_expired" });
		expect(await s.begin(5)).toBeNull(); expect(mocks.construct).not.toHaveBeenCalled();
	});

	test("schedules once and admits only one concurrent provider reader", async () => {
		const s = await setup();
		await s.t.mutation(ctx => scheduleApplicationFeeVerification(ctx, s.orderId));
		expect(await s.t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(1);
		await Promise.all([s.run(), s.run()]);
		expect(mocks.payment).toHaveBeenCalledTimes(1);
		expect(await s.row()).toMatchObject({ status: "verified", attempts: 1 });
	});

	test("expires abandoned claims, ignores early expiry and rejects stale completions", async () => {
		const s = await setup(); await s.begin();
		const expire = () => s.t.mutation(internal.stripeFeesStore.expireApplicationFeeAttempt,
			{ orderId: s.orderId, attempt: 1, attemptToken: token });
		expect(await expire()).toBe(false);
		vi.setSystemTime(Date.now() + APPLICATION_FEE_LEASE_MS);
		expect(await s.finish()).toBe(false); expect(await expire()).toBe(true);
		expect(await s.row()).toMatchObject({ status: "pending", error: "attempt_expired" });
		vi.setSystemTime(Date.now() + APPLICATION_FEE_RETRY_DELAYS[0]);
		await s.begin(2, `${token}-second`); expect(await s.finish()).toBe(false);
		expect(await s.finish(2, `${token}-second`)).toBe(true);
		expect(await expire()).toBe(false);
	});

	test("stale failure cannot overwrite a successful observation", async () => {
		const s = await setup(); await s.begin(); await s.finish();
		expect(await s.t.mutation(internal.stripeFeesStore.finishApplicationFeeAttempt, {
			orderId: s.orderId, attempt: 1, attemptToken: token, result: { error: "provider_unavailable" },
		})).toBe(false);
		expect(await s.row()).toMatchObject({ status: "verified" });
	});

	test("retains unknown historical evidence and never schedules an invented fee", async () => {
		const s = await setup({ checkoutFinancialSnapshot: undefined }); await s.run();
		expect(await s.row()).toBeNull(); expect(mocks.construct).not.toHaveBeenCalled();
		expect(await s.owner.query(api.stripeFeesStore.getApplicationFeeForOrder, { orderId: s.orderId }))
			.toMatchObject({ status: "unknown", expected: null, observation: null });
	});

	test("restricts reads to the order's stored site membership and hides lease tokens", async () => {
		const s = await setup(); await s.begin();
		await s.t.run(ctx => ctx.db.insert("platformClients", { siteUrl: "other.example", name: "Other",
			email: "other@example.invalid", adminEmails: ["other@example.invalid"], tier: "full", subscriptionStatus: "active" }));
		await expect(s.t.query(api.stripeFeesStore.getApplicationFeeForOrder, { orderId: s.orderId })).rejects.toThrow();
		await expect(s.t.withIdentity({ subject: "other", email: "other@example.invalid", emailVerified: true })
			.query(api.stripeFeesStore.getApplicationFeeForOrder, { orderId: s.orderId })).rejects.toThrow();
		const result = await s.owner.query(api.stripeFeesStore.getApplicationFeeForOrder, { orderId: s.orderId });
		expect(result).toMatchObject({ status: "pending", expected: snapshot, observation: null });
		expect(JSON.stringify(result)).not.toContain(token);
	});
});
