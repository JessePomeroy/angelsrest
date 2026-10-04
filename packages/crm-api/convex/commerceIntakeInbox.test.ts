/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest, type TestConvex } from "convex-test";
import type { FunctionArgs } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { STRIPE_API_VERSION } from "../src/stripeContract";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { INTAKE_LEASE_MS, INTAKE_MAX_CYCLE_AGE_MS } from "./helpers/commerceIntakeJobs";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const siteUrl = "angelsrest.online";
const secret = "inbox-webhook-fixture-0123456789abcdef";
const tenantId = "tenant_00000000-0000-4000-8000-000000000001";
const sessionId = "cs_test_inbox1234567890123456";
const eventId = "evt_inbox1234567890123456";
const runnerSecret = "inbox-runner-fixture-0123456789abcdef";
type Backend = TestConvex<typeof schema>;

function envelope() {
	return { version: 1, role: "your-account", event: {
		id: eventId, type: "checkout.session.completed", api_version: STRIPE_API_VERSION,
		created: 1_790_000_000, livemode: false, account: null,
		session: { id: sessionId, mode: "payment", metadata: { commerceTenantSiteUrl: siteUrl },
			amount_total: 1000, amount_subtotal: 1000, payment_status: "paid", currency: "usd",
			livemode: false, created: 1_790_000_000, expires_at: 1_790_086_400,
			customer_email: "buyer@example.invalid", payment_intent: "pi_inbox1234567890123456",
			customer_details: null, shipping_details: null },
	} };
}
const acceptArgs = () => ({ stripeEventId: eventId, eventJson: JSON.stringify(envelope()), allowNew: true, webhookSecret: secret });

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
	vi.stubEnv("WEBHOOK_SECRET", secret);
	vi.stubEnv("CONVEX_SITE_URL", "https://loyal-swan-967.convex.site");
	vi.stubEnv("ORDER_PRODUCERS_STATE", "open");
	vi.stubEnv("COMMERCE_INTAKE_SCOPES", JSON.stringify({ version: 1, sites: [{ siteUrl, mode: "test" }] }));
	vi.stubEnv("COMMERCE_INTAKE_RUNNER_URL", "");
	vi.stubEnv("COMMERCE_INTAKE_RUNNER_SECRET", "");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function setup() {
	const t = convexTest(schema, modules);
	const { clientId, reservationId } = await t.run(async ctx => ({
		clientId: await ctx.db.insert("platformClients", { siteUrl, tenantId, name: "Creator",
			email: "creator@example.invalid", adminEmails: ["creator@example.invalid"],
			role: "creator", tier: "full", subscriptionStatus: "active" }),
		reservationId: await ctx.db.insert("checkoutSnapshotReservations", {
			state: "bound", siteUrl, tenantId, accountScope: "platform", stripeSessionId: sessionId,
			handleHash: "a".repeat(64), snapshotDigest: "b".repeat(64),
			snapshot: { schemaVersion: 1, catalogProvider: "convex", items: [] },
			unboundPurgeAt: Date.now() + 86400000, createdAt: Date.now(), updatedAt: Date.now(),
		}),
	}));
	const creator = t.withIdentity({ subject: "creator", tokenIdentifier: "fixture|creator",
		email: "creator@example.invalid", emailVerified: true });
	return { t, creator, clientId, reservationId };
}

async function accept(t: Backend) {
	const result = await t.mutation(api.commerceIntakeInbox.accept, acceptArgs());
	if (result.kind !== "accepted") throw new Error("Expected durable acceptance");
	return result.inboxId;
}
async function row(t: Backend, inboxId: Id<"commerceIntakeInbox">) {
	const value = await t.run(ctx => ctx.db.get(inboxId));
	if (!value) throw new Error("Missing inbox row");
	return value;
}
async function wake(t: Backend, inboxId: Id<"commerceIntakeInbox">) {
	const current = await row(t, inboxId);
	vi.setSystemTime(current.nextAt);
	await t.mutation(internal.commerceIntakeInbox.wake, { inboxId, version: current.version, nextAt: current.nextAt });
	return row(t, inboxId);
}
async function claim(t: Backend, inboxId: Id<"commerceIntakeInbox">) {
	const current = await wake(t, inboxId);
	if (!current.leaseToken) throw new Error("Expected processing lease");
	return { inboxId, leaseToken: current.leaseToken, webhookSecret: secret };
}
async function order(t: Backend, patch: Partial<Doc<"orders">> = {}) {
	return t.run(ctx => ctx.db.insert("orders", {
		siteUrl, tenantId, stripeSessionId: sessionId, stripePaymentLivemode: false,
		orderNumber: "ORD-001", customerEmail: "buyer@example.invalid", total: 1000,
		items: [{ productName: "Digital", quantity: 1, price: 1000 }],
		fulfillmentType: "digital", status: "new",
		orderReceiptStartedAt: Date.now(), orderConfirmationClaimedAt: Date.now(), ...patch,
	}));
}
const processed = { kind: "processed", version: 1 } as const;

test("new intake is off unless both host and exact site/mode scope enable it", async () => {
	const { t } = await setup();
	for (const scopes of ["", '{"version":1,"sites":[]}', JSON.stringify({ version: 1, sites: [{ siteUrl, mode: "live" }] })]) {
		vi.stubEnv("COMMERCE_INTAKE_SCOPES", scopes);
		expect(await t.mutation(api.commerceIntakeInbox.accept, acceptArgs())).toEqual({ kind: "synchronous" });
	}
	vi.stubEnv("COMMERCE_INTAKE_SCOPES", JSON.stringify({ version: 1, sites: [{ siteUrl, mode: "test" }] }));
	expect(await t.mutation(api.commerceIntakeInbox.accept, { ...acceptArgs(), allowNew: false })).toEqual({ kind: "synchronous" });
	expect(await t.run(ctx => ctx.db.query("commerceIntakeInbox").take(2))).toEqual([]);
});

test("authentication precedes parsing and session membership cannot replace hub authority", async () => {
	const { t, creator } = await setup();
	for (const caller of [t, creator]) await expect(caller.mutation(api.commerceIntakeInbox.accept,
		{ ...acceptArgs(), eventJson: "invalid", webhookSecret: "wrong" })).rejects.toThrow("secret mismatch");
});

test("unknown historical payloads or missing durable routing retain synchronous handling", async () => {
	const { t, reservationId } = await setup();
	expect(await t.mutation(api.commerceIntakeInbox.accept, { ...acceptArgs(), eventJson: null })).toEqual({ kind: "synchronous" });
	await t.run(ctx => ctx.db.delete(reservationId));
	expect(await t.mutation(api.commerceIntakeInbox.accept, acceptArgs())).toEqual({ kind: "synchronous" });
	await order(t, { stripePaymentLivemode: undefined });
	expect(await t.mutation(api.commerceIntakeInbox.accept, acceptArgs())).toEqual({ kind: "synchronous" });
});

test("unpaid and producer-closed new events cannot enter the inbox", async () => {
	const { t } = await setup();
	const input = envelope(); input.event.session.payment_status = "unpaid";
	expect(await t.mutation(api.commerceIntakeInbox.accept, { ...acceptArgs(), eventJson: JSON.stringify(input) })).toEqual({ kind: "synchronous" });
	vi.stubEnv("ORDER_PRODUCERS_STATE", "closed");
	await expect(accept(t)).rejects.toThrow();
	expect(await t.run(ctx => ctx.db.query("commerceIntakeInbox").take(2))).toEqual([]);
});

test("simultaneous deliveries persist one immutable receipt and one initial wakeup", async () => {
	const { t } = await setup();
	const receipts = await Promise.all([accept(t), accept(t), accept(t)]);
	expect(new Set(receipts).size).toBe(1);
	expect(await t.run(ctx => ctx.db.query("commerceIntakeInbox").take(3))).toHaveLength(1);
	const scheduled = await t.run(ctx => ctx.db.system.query("_scheduled_functions").take(5));
	expect(scheduled).toHaveLength(1);
	expect(scheduled[0].name).toBe("commerceIntakeInbox:wake");
	const before = await row(t, receipts[0]);
	vi.stubEnv("COMMERCE_INTAKE_SCOPES", "malformed");
	vi.stubEnv("ORDER_PRODUCERS_STATE", "closed");
	expect(await t.mutation(api.commerceIntakeInbox.accept, { ...acceptArgs(), allowNew: false })).toMatchObject({ kind: "accepted", inboxId: before._id });
	expect(await row(t, before._id)).toEqual(before);
});

test("a duplicate cannot change payload, mode, event identity or become an unreadable sync replay", async () => {
	const { t } = await setup(); await accept(t);
	const input = envelope(); input.event.session.amount_total = 2000;
	await expect(t.mutation(api.commerceIntakeInbox.accept, { ...acceptArgs(), eventJson: JSON.stringify(input) })).rejects.toThrow("conflicts");
	await expect(t.mutation(api.commerceIntakeInbox.accept, { ...acceptArgs(), eventJson: null, allowNew: false })).rejects.toThrow("must remain readable");
	await expect(t.mutation(api.commerceIntakeInbox.accept, { ...acceptArgs(), stripeEventId: "evt_other1234567890123456" })).rejects.toThrow("identity changed");
});

test("a failed acceptance transaction leaves no receipt or scheduled processing", async () => {
	const { t } = await setup();
	vi.stubEnv("COMMERCE_INTAKE_SCOPES", "malformed");
	await expect(accept(t)).rejects.toThrow("scope configuration");
	expect(await t.run(ctx => ctx.db.query("commerceIntakeInbox").take(2))).toEqual([]);
	expect(await t.run(ctx => ctx.db.system.query("_scheduled_functions").take(2))).toEqual([]);
});

test("claim, watchdog and dispatch are committed once under concurrent wakeups", async () => {
	const { t } = await setup(); const inboxId = await accept(t); const initial = await row(t, inboxId);
	const args = { inboxId, version: initial.version, nextAt: initial.nextAt };
	await Promise.all([t.mutation(internal.commerceIntakeInbox.wake, args), t.mutation(internal.commerceIntakeInbox.wake, args)]);
	const claimed = await row(t, inboxId);
	expect(claimed).toMatchObject({ state: "processing", attempts: 1, cycleAttempts: 1, version: 2, leaseExpiresAt: Date.now() + INTAKE_LEASE_MS });
	const scheduled = await t.run(ctx => ctx.db.system.query("_scheduled_functions").take(5));
	expect(scheduled.map(item => item.name).sort()).toEqual(["commerceIntakeInbox:dispatch", "commerceIntakeInbox:wake", "commerceIntakeInbox:wake"]);
});

test("lost external dispatch recovers from the watchdog and fences the expired worker", async () => {
	const { t } = await setup(); const inboxId = await accept(t); const stale = await claim(t, inboxId);
	await wake(t, inboxId);
	expect(await row(t, inboxId)).toMatchObject({ state: "retry", attempts: 1, errorCode: "runner_unavailable" });
	await expect(t.query(api.commerceIntakeInbox.read, stale)).rejects.toThrow("lease");
	const next = await claim(t, inboxId);
	expect(next.leaseToken).not.toBe(stale.leaseToken);
	await expect(t.mutation(api.commerceIntakeInbox.advance, { ...stale, result: processed })).rejects.toThrow("lease");
	expect((await row(t, inboxId)).attempts).toBe(2);
});

test("delayed dispatch cannot start with too little time remaining on its lease", async () => {
	const { t } = await setup(); const inboxId = await accept(t); const active = await claim(t, inboxId);
	vi.setSystemTime(Date.now() + 26_000);
	const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
	await t.action(internal.commerceIntakeInbox.dispatch, { inboxId, leaseToken: active.leaseToken });
	expect(fetcher).not.toHaveBeenCalled();
	expect((await row(t, inboxId)).state).toBe("processing");
	await wake(t, inboxId);
	expect((await row(t, inboxId)).state).toBe("retry");
});

test("HTTP 200 without a durable completion checkpoint never marks done", async () => {
	const { t } = await setup(); const inboxId = await accept(t); const active = await claim(t, inboxId);
	vi.stubEnv("COMMERCE_INTAKE_RUNNER_URL", "https://angelsrest.online/api/internal/commerce-intake");
	vi.stubEnv("COMMERCE_INTAKE_RUNNER_SECRET", runnerSecret);
	const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 })); vi.stubGlobal("fetch", fetcher);
	await t.action(internal.commerceIntakeInbox.dispatch, { inboxId, leaseToken: active.leaseToken });
	expect(fetcher).toHaveBeenCalledOnce();
	expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ inboxId, leaseToken: active.leaseToken });
	expect((await row(t, inboxId)).state).toBe("retry");
});

test.each(["https://staging.angelsrest.online", "https://angelsrest.online"])(
	"staging intake dispatch enforces its environment before sending credentials: %s", async (origin) => {
		const { t } = await setup(); const inboxId = await accept(t); const active = await claim(t, inboxId);
		vi.stubEnv("CONVEX_SITE_URL", "https://rosy-firefly-366.convex.site");
		vi.stubEnv("COMMERCE_INTAKE_RUNNER_URL", `${origin}/api/internal/commerce-intake`);
		vi.stubEnv("COMMERCE_INTAKE_RUNNER_SECRET", runnerSecret);
		const fetcher = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetcher);
		await t.action(internal.commerceIntakeInbox.dispatch, { inboxId, leaseToken: active.leaseToken });
		expect(fetcher).toHaveBeenCalledTimes(origin === "https://staging.angelsrest.online" ? 1 : 0);
		if (fetcher.mock.calls.length) expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error" });
		expect((await row(t, inboxId)).state).toBe("retry");
	},
);

test("processed with no order blocks visibly instead of silently completing", async () => {
	const { t } = await setup(); const inboxId = await accept(t);
	await t.mutation(api.commerceIntakeInbox.advance, { ...await claim(t, inboxId), result: processed });
	expect(await row(t, inboxId)).toMatchObject({ state: "blocked", errorCode: "missing_order" });
});

test("each receipt audience must be acknowledged and late provider acceptance can finish safely", async () => {
	const { t } = await setup(); const inboxId = await accept(t);
	const orderId = await order(t, { orderReceiptCustomerSentAt: Date.now() });
	await t.mutation(api.commerceIntakeInbox.advance, { ...await claim(t, inboxId), result: processed });
	expect(await row(t, inboxId)).toMatchObject({ state: "retry", errorCode: "receipt_pending", orderId });
	await t.run(ctx => ctx.db.patch(orderId, { orderReceiptAdminSentAt: Date.now() }));
	await t.mutation(api.commerceIntakeInbox.advance, { ...await claim(t, inboxId), result: processed });
	expect(await row(t, inboxId)).toMatchObject({ state: "done", completion: "order_intake", orderId });
});

test("expired receipt evidence stays blocked and ordinary recovery cannot reopen email sends", async () => {
	const { t, creator } = await setup(); const inboxId = await accept(t);
	await order(t, { orderReceiptStartedAt: Date.now() - INTAKE_MAX_CYCLE_AGE_MS });
	await t.mutation(api.commerceIntakeInbox.advance, { ...await claim(t, inboxId), result: processed });
	const current = await row(t, inboxId);
	expect(current).toMatchObject({ state: "blocked", errorCode: "receipt_uncertain" });
	await expect(creator.mutation(api.commerceIntakeInbox.recover, { inboxId, siteUrl, expectedVersion: current.version, reason: "dependencies_restored" })).rejects.toThrow("separate evidence");
});

test("a durable print job is sufficient handoff without waiting for or reclaiming fulfillment", async () => {
	const { t } = await setup(); const inboxId = await accept(t);
	const orderId = await order(t, { fulfillmentType: "lumaprints", orderReceiptCustomerSentAt: Date.now(), orderReceiptAdminSentAt: Date.now() });
	const jobId = await t.run(async ctx => {
		const id = await ctx.db.insert("printFulfillmentJobs", { orderId, stage: "resolve", cursor: 0,
			attempts: 0, nextAt: Date.now(), startedAt: Date.now(), ordinalCount: 0, sourceCount: 0 });
		await ctx.db.patch(orderId, { printJobId: id }); return id;
	});
	const before = await t.run(ctx => ctx.db.get(jobId));
	await t.mutation(api.commerceIntakeInbox.advance, { ...await claim(t, inboxId), result: processed });
	expect((await row(t, inboxId)).state).toBe("done");
	expect(await t.run(ctx => ctx.db.get(jobId))).toEqual(before);
});

test("scope changes and stored-payload corruption stop dispatch before provider work", async () => {
	for (const change of ["scope", "payload"] as const) {
		const { t, clientId } = await setup(); const inboxId = await accept(t);
		if (change === "scope") await t.run(ctx => ctx.db.patch(clientId, { tenantId: "tenant_00000000-0000-4000-8000-000000000002" }));
		else await t.run(ctx => ctx.db.patch(inboxId, { digest: "0".repeat(64) }));
		await wake(t, inboxId);
		expect(await row(t, inboxId)).toMatchObject({ state: "blocked", attempts: 0 });
	}
});

test("retry exhaustion is bounded and creator recovery preserves total attempts and audit identity", async () => {
	const { t, creator } = await setup(); const inboxId = await accept(t);
	for (let i = 0; i < 12; i++) {
		await t.mutation(api.commerceIntakeInbox.advance, { ...await claim(t, inboxId), result: { kind: "retry", code: "processing_failed" } });
	}
	const exhausted = await row(t, inboxId);
	expect(exhausted).toMatchObject({ state: "blocked", attempts: 12, errorCode: "attempts_exhausted" });
	await creator.mutation(api.commerceIntakeInbox.recover, { inboxId, siteUrl, expectedVersion: exhausted.version, reason: "dependencies_restored" });
	expect(await row(t, inboxId)).toMatchObject({ state: "retry", attempts: 12, cycleAttempts: 0, recoveryCount: 1 });
	const audit = await creator.query(api.commerceIntakeInbox.inspect, { inboxId, siteUrl });
	expect(audit.recoveries).toMatchObject([{ operatorTokenIdentifier: "fixture|creator", reason: "dependencies_restored", previousVersion: exhausted.version }]);
	await expect(creator.mutation(api.commerceIntakeInbox.recover, { inboxId, siteUrl, expectedVersion: exhausted.version, reason: "dependencies_restored" })).rejects.toThrow("target changed");
});

test("creator views are bounded, private payloads and capabilities stay out, and site mismatch rejects recovery", async () => {
	const { t, creator } = await setup(); const inboxId = await accept(t); const active = await claim(t, inboxId);
	await expect(t.query(api.commerceIntakeInbox.list, { siteUrl, paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow("authenticated");
	const projection = await creator.query(api.commerceIntakeInbox.inspect, { inboxId, siteUrl });
	const encoded = JSON.stringify(projection);
	for (const privateValue of ["buyer@example.invalid", active.leaseToken, secret, "eventJson", "digest"]) expect(encoded).not.toContain(privateValue);
	await expect(creator.query(api.commerceIntakeInbox.list, { siteUrl, paginationOpts: { numItems: 51, cursor: null } })).rejects.toThrow("1 to 50");
	await expect(creator.mutation(api.commerceIntakeInbox.recover, { inboxId, siteUrl: "other.example", expectedVersion: projection.version, reason: "input_repaired" })).rejects.toThrow("target changed");
});

test("a completed receipt remains authoritative after acceptance is disabled and cannot be recovered", async () => {
	const { t, creator } = await setup(); const inboxId = await accept(t);
	await order(t, { orderReceiptCustomerSentAt: Date.now(), orderReceiptAdminSentAt: Date.now() });
	await t.mutation(api.commerceIntakeInbox.advance, { ...await claim(t, inboxId), result: processed });
	const completed = await row(t, inboxId);
	vi.stubEnv("COMMERCE_INTAKE_SCOPES", "");
	expect(await t.mutation(api.commerceIntakeInbox.accept, { ...acceptArgs(), allowNew: false })).toMatchObject({ kind: "accepted", state: "done" });
	expect(await creator.mutation(api.commerceIntakeInbox.recover, { inboxId, siteUrl, expectedVersion: completed.version, reason: "dependencies_restored" })).toEqual({ changed: false, state: "done" });
	expect(await row(t, inboxId)).toEqual(completed);
});

test("scheduled processing completes after acknowledgement without a second Stripe delivery", async () => {
	const { t } = await setup();
	vi.stubEnv("COMMERCE_INTAKE_RUNNER_URL", "https://angelsrest.online/api/internal/commerce-intake");
	vi.stubEnv("COMMERCE_INTAKE_RUNNER_SECRET", runnerSecret);
	let attempt = 0;
	vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => {
		const callback: Pick<FunctionArgs<typeof api.commerceIntakeInbox.advance>, "inboxId" | "leaseToken"> = JSON.parse(String(options.body));
		attempt++;
		if (attempt === 1) throw new Error("Synthetic interruption after successful ingress acknowledgement");
		await order(t, { orderReceiptCustomerSentAt: Date.now(), orderReceiptAdminSentAt: Date.now() });
		await t.mutation(api.commerceIntakeInbox.advance, { ...callback, webhookSecret: secret, result: processed });
		return new Response("{}", { status: 200 });
	}));
	const inboxId = await accept(t);
	for (let tick = 0; tick < 40 && (await row(t, inboxId)).state !== "done"; tick++) {
		await vi.advanceTimersByTimeAsync(1000);
		await t.finishInProgressScheduledFunctions();
	}
	expect(attempt).toBe(2);
	expect(await row(t, inboxId)).toMatchObject({ state: "done", attempts: 2 });
	expect(await t.run(ctx => ctx.db.query("orders").take(2))).toHaveLength(1);
});

test("local cancellation cannot complete missing paid receipts through worker or operator recovery", async () => {
	const { t, creator } = await setup(); const inboxId = await accept(t);
	const orderId = await order(t, { fulfillmentType: "lumaprints", orderReceiptStartedAt: Date.now() - INTAKE_MAX_CYCLE_AGE_MS });
	await creator.mutation(api.orders.cancelFulfillment, { orderId });
	await t.mutation(api.commerceIntakeInbox.advance, { ...await claim(t, inboxId), result: processed });
	const blocked = await row(t, inboxId);
	expect(blocked).toMatchObject({ state: "blocked", errorCode: "financial_recovery", orderId });
	expect(await creator.mutation(api.commerceIntakeInbox.recover, { inboxId, siteUrl, expectedVersion: blocked.version, reason: "persisted_outcome_verified" })).toEqual({ changed: false, state: "blocked" });
	expect((await row(t, inboxId)).completedAt).toBeUndefined();
});

test("provider-authoritative refund evidence is a terminal receipt exclusion", async () => {
	const { t } = await setup(); const inboxId = await accept(t);
	await order(t, { status: "refunded", stripeRefundId: "re_fixture1234567890123456" });
	await t.mutation(api.commerceIntakeInbox.advance, { ...await claim(t, inboxId), result: processed });
	expect((await row(t, inboxId)).state).toBe("done");
});

test("failure during initial scheduling rolls back the already inserted receipt", async () => {
	const { t } = await setup();
	const { accept: handler } = await import("./commerceIntakeInbox");
	// Inject a scheduler fault inside the same transaction after the real handler inserts its row.
	if (!("_handler" in handler) || typeof handler._handler !== "function") throw new Error("Expected registered Convex handler");
	const invoke = handler._handler;
	await expect(t.run(ctx => invoke({ ...ctx, scheduler: { ...ctx.scheduler,
		runAt: async () => { throw new Error("Synthetic scheduler failure after insert"); },
	} }, acceptArgs()))).rejects.toThrow("scheduler failure after insert");
	expect(await t.run(ctx => ctx.db.query("commerceIntakeInbox").take(2))).toEqual([]);
	expect(await t.run(ctx => ctx.db.system.query("_scheduled_functions").take(2))).toEqual([]);
});

test("connected-account history retains ownership and an event ID cannot cross account scopes", async () => {
	const { t, clientId, reservationId } = await setup();
	const account = "acct_history1234567890";
	await t.run(async ctx => {
		await ctx.db.insert("stripeAccountBindings", { stripeConnectedAccountId: account, clientId, tenantId,
			attemptId: "original", platformAccountId: "acct_platform1234567890", livemode: false, boundAt: Date.now() });
		await ctx.db.patch(reservationId, { accountScope: `connected:${account}`, stripeConnectedAccountId: account });
	});
	const input = { ...envelope(), role: "connected-accounts", event: { ...envelope().event, account } };
	const accepted = await t.mutation(api.commerceIntakeInbox.accept, { ...acceptArgs(), eventJson: JSON.stringify(input) });
	expect(accepted.kind).toBe("accepted");
	await expect(t.mutation(api.commerceIntakeInbox.accept, acceptArgs())).rejects.toThrow("conflicts");
	const other = { ...input, event: { ...input.event, account: "acct_foreign1234567890" } };
	await expect(t.mutation(api.commerceIntakeInbox.accept, { ...acceptArgs(), eventJson: JSON.stringify(other) })).rejects.toThrow("conflicts");
});

test("foreign account cannot borrow a reservation owned by this website", async () => {
	const { t, reservationId } = await setup();
	const account = "acct_foreign1234567890";
	await t.run(async ctx => {
		await ctx.db.insert("platformClients", { siteUrl: "foreign.example", name: "Foreign", email: "foreign@example.invalid",
			adminEmails: [], tier: "full", subscriptionStatus: "active", stripeConnectedAccountId: account });
		await ctx.db.patch(reservationId, { accountScope: `connected:${account}`, stripeConnectedAccountId: account });
	});
	const input = { ...envelope(), role: "connected-accounts", event: { ...envelope().event, account } };
	await expect(t.mutation(api.commerceIntakeInbox.accept, { ...acceptArgs(), eventJson: JSON.stringify(input) })).rejects.toThrow("routing facts conflict");
	expect(await t.run(ctx => ctx.db.query("commerceIntakeInbox").take(2))).toEqual([]);
});

test("an authenticated retired session completes accepted work without creating a new order", async () => {
	const { t } = await setup(); const inboxId = await accept(t);
	const orderId = await order(t);
	await t.run(async ctx => {
		await ctx.db.insert("retiredOrderSessions", { protocolVersion: 1, siteUrl, routingKind: "legacy_unscoped",
			stripeSessionId: sessionId, retiredOrderId: orderId, resetId: "fixture-retirement", retiredAt: Date.now() });
		await ctx.db.delete(orderId);
	});
	await t.mutation(api.commerceIntakeInbox.advance, { ...await claim(t, inboxId), result: processed });
	expect(await row(t, inboxId)).toMatchObject({ state: "done", completion: "retired_session" });
	expect(await t.run(ctx => ctx.db.query("orders").take(2))).toEqual([]);
});

test("attempt age and operator recovery count/age are independently bounded", async () => {
	const { t, creator } = await setup(); const inboxId = await accept(t);
	await t.run(ctx => ctx.db.patch(inboxId, { cycleStartedAt: Date.now() - INTAKE_MAX_CYCLE_AGE_MS }));
	await wake(t, inboxId);
	expect(await row(t, inboxId)).toMatchObject({ state: "blocked", attempts: 0, errorCode: "age_exceeded" });
	for (let i = 0; i < 3; i++) {
		const current = await row(t, inboxId);
		await creator.mutation(api.commerceIntakeInbox.recover, { inboxId, siteUrl, expectedVersion: current.version, reason: "schedule_restored" });
		await t.run(ctx => ctx.db.patch(inboxId, { cycleStartedAt: Date.now() - INTAKE_MAX_CYCLE_AGE_MS }));
		await wake(t, inboxId);
	}
	const exhausted = await row(t, inboxId);
	await expect(creator.mutation(api.commerceIntakeInbox.recover, { inboxId, siteUrl, expectedVersion: exhausted.version, reason: "schedule_restored" })).rejects.toThrow("separate evidence");
	expect(exhausted.recoveryCount).toBe(3);
	const second = await setup(); const otherId = await accept(second.t);
	await second.t.run(ctx => ctx.db.patch(otherId, { state: "blocked", acceptedAt: Date.now() - 30 * 86400000 }));
	const old = await row(second.t, otherId);
	await expect(second.creator.mutation(api.commerceIntakeInbox.recover, { inboxId: otherId, siteUrl, expectedVersion: old.version, reason: "schedule_restored" })).rejects.toThrow("separate evidence");
});

test("overdue unclaimed work can be recovered but an active lease cannot be superseded", async () => {
	const { t, creator } = await setup(); const inboxId = await accept(t);
	let current = await row(t, inboxId);
	await expect(creator.mutation(api.commerceIntakeInbox.recover, { inboxId, siteUrl, expectedVersion: current.version, reason: "schedule_restored" })).rejects.toThrow("not blocked or overdue");
	vi.setSystemTime(Date.now() + 300_001);
	expect((await creator.query(api.commerceIntakeInbox.inspect, { inboxId, siteUrl })).overdue).toBe(true);
	await creator.mutation(api.commerceIntakeInbox.recover, { inboxId, siteUrl, expectedVersion: current.version, reason: "schedule_restored" });
	await claim(t, inboxId); current = await row(t, inboxId);
	await expect(creator.mutation(api.commerceIntakeInbox.recover, { inboxId, siteUrl, expectedVersion: current.version, reason: "schedule_restored" })).rejects.toThrow("not blocked or overdue");
});
