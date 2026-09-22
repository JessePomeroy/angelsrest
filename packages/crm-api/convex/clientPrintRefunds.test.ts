/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { CLIENT_PRINT_REFUND_LEASE_MS, CLIENT_PRINT_REFUND_RETRY_MS } from "./helpers/clientPrintRefunds";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "guided-refund-secret-01234567890123456789";
const TENANT = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b";
const ACCOUNT = "acct_client12345678901";
const PLATFORM = "acct_platform1234567890";
const SESSION = "cs_test_original1234567890";
const PI = "pi_original1234567890";
const CHARGE = "ch_original1234567890";
const FEE = "fee_original1234567890";
const TOKEN = "123e4567-e89b-42d3-a456-426614174000";
const OTHER = "123e4567-e89b-42d3-a456-426614174001";
const snapshot = { version: 1 as const, policy: "print_subtotal_5pct_floor_v1" as const, tenantId: TENANT,
	stripePlatformAccountId: PLATFORM, stripeConnectedAccountId: ACCOUNT, stripeLivemode: false, currency: "usd" as const,
	subtotalCents: 13000, printSubtotalCents: 10000, applicationFeeAmountCents: 500,
	lines: [{ productKind: "print" as const, unitPriceCents: 5000, quantity: 2 }, { productKind: "digital_download" as const, unitPriceCents: 3000, quantity: 1 }] };
const observation = { stripeSessionId: SESSION, currency: "usd" as const, subtotalCents: 13000, totalCents: 14000,
	applicationFeeAmountCents: 500, applicationFeeRefundedCents: 0, payment: { kind: "paid" as const,
		stripePaymentIntentId: PI, stripeChargeId: CHARGE, stripeApplicationFeeId: FEE, requestedApplicationFeeCents: 500, customerRefundedCents: 0 } };
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-21T12:00:00Z")); vi.stubEnv("WEBHOOK_SECRET", SECRET); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup() {
	const t = convexTest(schema, modules);
	const clientId = await t.run(ctx => ctx.db.insert("platformClients", { siteUrl: "client.example", tenantId: TENANT, name: "Client",
		email: "owner@example.invalid", adminEmails: ["owner@example.invalid"], tier: "full", subscriptionStatus: "active", stripeConnectedAccountId: ACCOUNT }));
	const orderId = await t.run(ctx => ctx.db.insert("orders", { siteUrl: "client.example", tenantId: TENANT,
		stripeSessionId: SESSION, stripeConnectedAccountId: ACCOUNT, stripePaymentIntentId: PI,
		stripePaymentCurrency: "usd", stripePaymentLivemode: false, checkoutFinancialSnapshot: snapshot,
		orderNumber: "ORD-001", customerEmail: "buyer@example.invalid", items: [{ productName: "Print", quantity: 2, price: 10000 }, { productName: "Download", quantity: 1, price: 3000 }],
		total: 14000, subtotal: 13000, status: "new", fulfillmentType: "self" }));
	const owner = t.withIdentity({ subject: "owner", email: "owner@example.invalid", emailVerified: true });
	const request = (lineAmountsCents = [4000, 0], otherAmountCents = 0, requestToken = TOKEN) => owner.mutation(api.orders.requestClientPrintRefund,
		{ orderId, requestToken, allocation: { lineAmountsCents, otherAmountCents }, webhookSecret: SECRET });
	const run = async (amounts = [4000, 0], other = 0, requestToken = TOKEN) => {
		const operationId = await request(amounts, other, requestToken);
		const args = { operationId, leaseToken: OTHER, webhookSecret: SECRET };
		const claim = await t.mutation(api.orders.claimClientPrintRefund, args);
		if (claim.kind !== "claimed") throw new Error("Missing claim");
		const checkpoint = (stage: "customer" | "fee", observed = observation) => t.mutation(api.orders.checkpointClientPrintRefund, { ...args, checkpoint: { stage, observation: observed } });
		const customer = (status: "succeeded" | "pending" | "requires_action" | "failed" | "canceled" = "succeeded", refundId = "re_original1234567890") =>
			t.mutation(api.orders.recordClientPrintRefund, { ...args, result: { stage: "customer", refundId, amountCents: amounts.reduce((sum, n) => sum+n, other), status } });
		const fee = (refundId = "fr_original1234567890") => t.mutation(api.orders.recordClientPrintRefund, { ...args, result: { stage: "fee", refundId, amountCents: claim.operation.feeAmountCents } });
		const row = () => t.run(ctx => ctx.db.get(operationId));
		return { operationId, args, claim, checkpoint, customer, fee, row };
	};
	return { t, owner, orderId, clientId, request, run };
}

describe("guided client print refund operations", () => {
	test("keeps print principal, customer payment and fee return distinct in mixed orders", async () => {
		const s = await setup(); const r = await s.run([4000, 1000], 500);
		expect(r.claim.operation).toMatchObject({ amountCents: 5500, printAmountCents: 4000, feeAmountCents: 200 });
		await r.checkpoint("customer"); await r.customer(); await r.checkpoint("fee"); await r.fee();
		expect(await r.row()).toMatchObject({ state: "complete", customerStatus: "succeeded", feeRefundId: "fr_original1234567890" });
		expect(await s.t.run(ctx => ctx.db.get(s.orderId))).toMatchObject({ status: "new" });
		expect((await s.t.run(ctx => ctx.db.get(s.orderId)))?.clientPrintRefundOperationId).toBeUndefined();
	});
	test("closes fulfillment for a full refund without treating it as supplier cancellation", async () => {
		const s = await setup(); const r = await s.run([10000, 3000], 1000);
		await r.checkpoint("customer"); await r.customer(); await r.checkpoint("fee"); await r.fee();
		expect(await s.t.run(ctx => ctx.db.get(s.orderId))).toMatchObject({ status: "refunded", stripeRefundId: "re_original1234567890" });
	});
	test("rounds cumulative print principal across partial refunds", async () => {
		const s = await setup(); const first = await s.run([19, 0]); await first.checkpoint("customer"); await first.customer();
		expect(await first.row()).toMatchObject({ state: "complete", feeAmountCents: 0 });
		const second = await s.run([1, 0], 0, OTHER);
		expect(second.claim.operation).toMatchObject({ amountCents: 1, feeAmountCents: 1 });
	});
	test("returns no fee on shipping or non-print amounts", async () => {
		const s = await setup(); const r = await s.run([0, 3000], 1000);
		expect(r.claim.operation.feeAmountCents).toBe(0);
		await r.checkpoint("customer"); await r.customer();
		expect(await r.row()).toMatchObject({ state: "complete" });
		expect(await r.checkpoint("fee")).toBe(false);
	});
	test.each([[[10001, 0], 0], [[0, 0], 1001], [[-1, 0], 0], [[0.1, 0], 0], [[0], 0], [[0, 0], 0]] as const)("rejects invalid allocation %j/%s", async (lines, other) => {
		const s = await setup(); await expect(s.request([...lines], other)).rejects.toThrow();
		expect(await s.t.run(ctx => ctx.db.query("clientPrintRefundOperations").take(1))).toEqual([]);
	});
	test("requires both original tenant membership and the private hub capability", async () => {
		const s = await setup(); const args = { orderId: s.orderId, requestToken: TOKEN, allocation: { lineAmountsCents: [4000, 0], otherAmountCents: 0 }, webhookSecret: SECRET };
		await expect(s.t.mutation(api.orders.requestClientPrintRefund, args)).rejects.toThrow();
		await expect(s.owner.mutation(api.orders.requestClientPrintRefund, { ...args, webhookSecret: "bad" })).rejects.toThrow();
		await expect(s.t.withIdentity({ subject: "foreign", email: "foreign@example.invalid", emailVerified: true }).mutation(api.orders.requestClientPrintRefund, args)).rejects.toThrow();
	});
	test("idempotent repeated requests retain one intent and reject changed amounts", async () => {
		const s = await setup(); const ids = await Promise.all([s.request(), s.request()]); expect(ids[0]).toBe(ids[1]);
		await expect(s.request([4001, 0])).rejects.toThrow("cannot change");
		await expect(s.request([100, 0], 0, OTHER)).rejects.toThrow("existing refund");
	});
	test("serializes competing requests and provider workers", async () => {
		const s = await setup(); const results = await Promise.allSettled([s.request(), s.request([100, 0], 0, OTHER)]);
		expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
		const operationId = results.find(result => result.status === "fulfilled")?.value; if (!operationId) throw new Error("Missing operation");
		const claims = await Promise.all([TOKEN, OTHER].map(leaseToken => s.t.mutation(api.orders.claimClientPrintRefund, { operationId, leaseToken, webhookSecret: SECRET })));
		expect(claims.map(result => result.kind).sort()).toEqual(["busy", "claimed"]);
	});
	test("fences stale workers and never repeats an uncertain POST beyond 23 hours", async () => {
		const s = await setup(); const r = await s.run(); await r.checkpoint("customer");
		vi.setSystemTime(Date.now() + CLIENT_PRINT_REFUND_LEASE_MS);
		await s.t.mutation(api.orders.claimClientPrintRefund, { ...r.args, leaseToken: TOKEN });
		expect(await r.customer()).toBe(false);
		vi.setSystemTime(Date.now() + CLIENT_PRINT_REFUND_RETRY_MS);
		await s.t.mutation(api.orders.claimClientPrintRefund, r.args);
		expect(await r.checkpoint("customer")).toBe(false);
	});
	test.each(["pending", "requires_action", "failed", "canceled"] as const)("does not return a fee for a %s customer refund", async status => {
		const s = await setup(); const r = await s.run(); await r.checkpoint("customer"); await r.customer(status);
		expect(await r.checkpoint("fee")).toBe(false);
		expect((await r.row())?.state).toBe(status === "pending" || status === "requires_action" ? "customer_pending" : "failed");
	});
	test("allows cancellation only before the customer POST checkpoint", async () => {
		const s = await setup(); const r = await s.run();
		await s.owner.mutation(api.orders.cancelClientPrintRefund, { operationId: r.operationId, webhookSecret: SECRET });
		expect(await r.checkpoint("customer")).toBe(false);
		const next = await s.run([4000, 0], 0, OTHER); await next.checkpoint("customer");
		await expect(s.owner.mutation(api.orders.cancelClientPrintRefund, { operationId: next.operationId, webhookSecret: SECRET })).rejects.toThrow("no longer");
	});
	test("keeps original access after a real domain rename and omits private recovery proof", async () => {
		const s = await setup(); const r = await s.run();
		await s.t.mutation(internal.platform.renameClientSiteUrl, { fromSiteUrl: "client.example", toSiteUrl: "renamed.example" });
		const page = await s.owner.query(api.orders.getClientPrintRefundPage, { siteUrl: "renamed.example", orderId: s.orderId });
		expect(page.selected?.operations[0]?.id).toBe(r.operationId);
		expect(JSON.stringify(page)).not.toContain(r.claim.operation.providerProof); expect(JSON.stringify(page)).not.toContain(SECRET);
	});
	test("holds supplier claims and automatic refunds while a guided request is active", async () => {
		const s = await setup(); await s.request();
		expect(await s.t.mutation(api.orders.claimPrintFulfillmentV5, { orderId: s.orderId, tenantId: TENANT, claimToken: TOKEN, webhookSecret: SECRET })).toEqual({ kind: "busy" });
		expect(await s.t.mutation(api.orders.beginPrintFulfillmentSubmission, { orderId: s.orderId, tenantId: TENANT, claimToken: TOKEN, webhookSecret: SECRET })).toEqual({ kind: "lost" });
		expect(await s.t.mutation(api.orders.claimPrintFulfillmentV2, { orderId: s.orderId, claimToken: TOKEN, webhookSecret: SECRET })).toEqual({ kind: "busy" });
		expect(await s.t.mutation(api.orders.claimAutomatedFulfillmentRefundV2, { orderId: s.orderId, claimToken: TOKEN, fulfillmentError: "Supplier rejected", webhookSecret: SECRET })).toEqual({ kind: "unavailable", guidedRefund: true });
	});
	test("does not take over an in-flight supplier submission or automated refund", async () => {
		const s = await setup(); await s.t.run(ctx => ctx.db.patch(s.orderId, { printFulfillmentClaim: true }));
		await expect(s.request()).rejects.toThrow("Fulfillment");
		await s.t.run(ctx => ctx.db.patch(s.orderId, { printFulfillmentClaim: undefined, automatedRefundClaimToken: TOKEN }));
		await expect(s.request()).rejects.toThrow("Fulfillment");
	});
});
