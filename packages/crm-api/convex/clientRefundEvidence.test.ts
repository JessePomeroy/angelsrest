/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { beginClientRefundObservation, CLIENT_REFUND_OBSERVATION_LEASE_MS } from "./helpers/clientRefundEvidence";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "client-refund-evidence-secret-0123456789";
const TENANT = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b";
const PLATFORM = "acct_platform1234567890";
const ACCOUNT = "acct_client12345678901";
const SESSION = "cs_test_original1234567890";
const PI = "pi_original1234567890";
const TOKEN = "123e4567-e89b-42d3-a456-426614174000";
const SECOND_TOKEN = "123e4567-e89b-42d3-a456-426614174001";
const snapshot = { version: 1 as const, policy: "print_subtotal_5pct_floor_v1" as const,
	tenantId: TENANT, stripePlatformAccountId: PLATFORM, stripeConnectedAccountId: ACCOUNT,
	stripeLivemode: false, currency: "usd" as const, subtotalCents: 10000,
	printSubtotalCents: 10000, applicationFeeAmountCents: 500,
	lines: [{ productKind: "print" as const, unitPriceCents: 5000, quantity: 2 }] };
const claim = { stripeSessionId: SESSION, stripeConnectedAccountId: ACCOUNT, stripePaymentIntentId: PI,
	stripeRefundId: "re_original1234567890", stripeEventId: "evt_original1234567890", claimToken: TOKEN, webhookSecret: SECRET };
const observation = { amountCents: 4000, totalCents: 11000, subtotalCents: 10000, currency: "usd" as const,
	stripeChargeId: "ch_original1234567890", status: "succeeded" as const };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-21T12:00:00Z")); vi.stubEnv("WEBHOOK_SECRET", SECRET); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup(beforeOrder = false) {
	const t = convexTest(schema, modules);
	const clientId = await t.run(ctx => ctx.db.insert("platformClients", {
		tenantId: TENANT, siteUrl: "client.example", name: "Client", email: "owner@example.invalid",
		adminEmails: ["owner@example.invalid"], tier: "full", subscriptionStatus: "active",
		stripeConnectedAccountId: ACCOUNT,
	}));
	const insertOrder = () => t.run(ctx => ctx.db.insert("orders", {
		siteUrl: "client.example", tenantId: TENANT, stripeSessionId: SESSION, stripePaymentIntentId: PI,
		stripeConnectedAccountId: ACCOUNT, stripePaymentCurrency: "usd", stripePaymentLivemode: false,
		checkoutFinancialSnapshot: snapshot, orderNumber: "ORD-001", customerEmail: "buyer@example.invalid",
		items: [], total: 11000, status: "new", fulfillmentType: "self",
	}));
	if (beforeOrder) await t.run(ctx => ctx.db.insert("checkoutSessionAdmissions", {
		protocolVersion: 1, siteUrl: "client.example", tenantId: TENANT, stripeConnectedAccountId: ACCOUNT,
		accountScope: `connected:${ACCOUNT}`, attemptDigest: "a".repeat(64), proofClass: "same_origin_host_proof",
		admissionHandleHash: "b".repeat(64), hostGeneration: 1, admissionGeneration: 1, state: "bound",
		requestFingerprint: "c".repeat(64), createdAt: Date.now(), updatedAt: Date.now(), boundAt: Date.now(),
		stripeSessionId: SESSION, checkoutFinancialSnapshot: snapshot,
	}));
	const orderId = beforeOrder ? null : await insertOrder();
	const owner = t.withIdentity({ subject: "owner", email: "owner@example.invalid", emailVerified: true });
	const begin = (args = claim) => t.mutation(api.orders.beginClientRefundObservation, args);
	const row = () => t.run(ctx => ctx.db.query("clientRefundEvidence").take(1).then(rows => rows[0]));
	return { t, owner, clientId, orderId, insertOrder, begin, row };
}

describe("client refund evidence authority and lifecycle", () => {
	test("rolls back a claim when its expiry dispatch cannot be persisted", async () => {
		const s = await setup();
		await expect(s.t.mutation(ctx => beginClientRefundObservation({ ...ctx,
			scheduler: { ...ctx.scheduler, runAfter: async () => { throw new Error("dispatch unavailable"); } },
		}, claim))).rejects.toThrow("dispatch unavailable");
		expect(await s.row()).toBeNull();
	});

	test("isolates equal refund IDs across two original connected accounts", async () => {
		const s = await setup();
		const otherAccount = "acct_other12345678901";
		const otherSession = "cs_test_other12345678901";
		const otherTenant = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07c";
		await s.t.run(async ctx => {
			await ctx.db.insert("platformClients", { siteUrl: "other.example", tenantId: otherTenant, name: "Other",
				email: "other@example.invalid", adminEmails: ["other@example.invalid"], tier: "full", subscriptionStatus: "active" });
			const original = await ctx.db.get(s.orderId!); if (!original) throw new Error("Missing order");
			const { _id, _creationTime, ...fields } = original;
			await ctx.db.insert("orders", { ...fields, siteUrl: "other.example", tenantId: otherTenant,
				stripeSessionId: otherSession, stripeConnectedAccountId: otherAccount,
				checkoutFinancialSnapshot: { ...snapshot, tenantId: otherTenant, stripeConnectedAccountId: otherAccount } });
		});
		const first = await s.begin(); const second = await s.begin({ ...claim,
			stripeConnectedAccountId: otherAccount, stripeSessionId: otherSession, claimToken: SECOND_TOKEN });
		if (first.kind !== "claimed" || second.kind !== "claimed") throw new Error("Missing claims");
		expect(first.evidenceId).not.toBe(second.evidenceId);
		expect(await s.t.mutation(api.orders.finishClientRefundObservation, { evidenceId: first.evidenceId,
			claimToken: SECOND_TOKEN, webhookSecret: SECRET, observation })).toBe(false);
		await s.t.mutation(api.orders.finishClientRefundObservation, { evidenceId: second.evidenceId,
			claimToken: SECOND_TOKEN, webhookSecret: SECRET, observation });
		expect(await s.owner.query(api.orders.listClientRefundEvidence, { orderId: s.orderId! }))
			.toMatchObject({ items: [{ state: "checking", observation: null }] });
	});

	test("bounds the authorized evidence list and explicitly signals additional rows", async () => {
		const s = await setup(); await s.begin();
		await s.t.run(async ctx => {
			const row = (await ctx.db.query("clientRefundEvidence").take(1))[0]; if (!row) throw new Error("Missing record");
			const { _id, _creationTime, ...fields } = row;
			for (let i = 0; i < 50; i++) await ctx.db.insert("clientRefundEvidence", { ...fields, stripeRefundId: `re_additional${i}` });
		});
		const result = await s.owner.query(api.orders.listClientRefundEvidence, { orderId: s.orderId! });
		expect(result.items).toHaveLength(50); expect(result.hasMore).toBe(true);
	});

	test("captures a partial refund without changing fulfillment or fee amounts", async () => {
		const s = await setup(); const started = await s.begin();
		if (started.kind !== "claimed") throw new Error("Missing claim");
		expect(started.context).toMatchObject({ tenantId: TENANT, stripePlatformAccountId: PLATFORM,
			stripeConnectedAccountId: ACCOUNT, stripePaymentIntentId: PI, totalCents: 11000 });
		await s.t.mutation(api.orders.finishClientRefundObservation, { evidenceId: started.evidenceId,
			claimToken: TOKEN, webhookSecret: SECRET, observation });
		expect(await s.row()).toMatchObject({ state: "observed", observation, observedAt: Date.now() });
		expect(await s.t.run(ctx => ctx.db.get(s.orderId!))).toMatchObject({ status: "new", checkoutFinancialSnapshot: snapshot });
	});

	test("retains refund evidence before paid intake and exposes it after the order arrives", async () => {
		const s = await setup(true); const started = await s.begin();
		if (started.kind !== "claimed") throw new Error("Missing claim");
		expect(started.context.totalCents).toBeUndefined();
		await s.t.mutation(api.orders.finishClientRefundObservation, { evidenceId: started.evidenceId,
			claimToken: TOKEN, webhookSecret: SECRET, observation });
		const orderId = await s.insertOrder();
		expect(await s.owner.query(api.orders.listClientRefundEvidence, { orderId }))
			.toMatchObject({ evidenceAvailable: true, hasMore: false, items: [{ observation }] });
	});

	test("preserves original context after today's client account changes", async () => {
		const s = await setup();
		await s.t.run(ctx => ctx.db.patch(s.clientId, { stripeConnectedAccountId: "acct_replacement123456" }));
		expect(await s.begin()).toMatchObject({ kind: "claimed", context: { stripeConnectedAccountId: ACCOUNT } });
	});

	test("requires hub authority for every write, including callers with valid membership", async () => {
		const s = await setup();
		for (const caller of [s.t, s.owner]) {
			await expect(caller.mutation(api.orders.beginClientRefundObservation, { ...claim, webhookSecret: "wrong" })).rejects.toThrow();
		}
		expect(await s.row()).toBeNull();
		const started = await s.begin(); if (started.kind !== "claimed") throw new Error("Missing claim");
		await expect(s.owner.mutation(api.orders.finishClientRefundObservation, { evidenceId: started.evidenceId,
			claimToken: TOKEN, webhookSecret: "wrong", observation })).rejects.toThrow();
		await expect(s.owner.mutation(api.orders.failClientRefundObservation, { evidenceId: started.evidenceId,
			claimToken: TOKEN, webhookSecret: "wrong", issue: "provider_unavailable" })).rejects.toThrow();
	});

	test.each([{ stripeConnectedAccountId: "acct_other12345678901" }, { stripePaymentIntentId: "pi_other1234567890" },
		{ stripeRefundId: "bad" }, { claimToken: "bad" }])("rejects substituted or malformed claims %j", async changed => {
		const s = await setup(); await expect(s.begin({ ...claim, ...changed })).rejects.toThrow();
		expect(await s.row()).toBeNull();
	});

	test("allows one observer, then replaces its earlier success with a current provider failure", async () => {
		const s = await setup();
		const claims = await Promise.all([s.begin(), s.begin({ ...claim, claimToken: SECOND_TOKEN })]);
		expect(claims.filter(result => result.kind === "claimed")).toHaveLength(1);
		expect(claims.filter(result => result.kind === "busy")).toHaveLength(1);
		const row = await s.row(); if (!row?.claimToken) throw new Error("Missing claim");
		await s.t.mutation(api.orders.finishClientRefundObservation, { evidenceId: row._id,
			claimToken: row.claimToken, webhookSecret: SECRET, observation });
		await s.begin({ ...claim, claimToken: SECOND_TOKEN, stripeEventId: "evt_latefailed123456" });
		await s.t.mutation(api.orders.finishClientRefundObservation, { evidenceId: row._id,
			claimToken: SECOND_TOKEN, webhookSecret: SECRET, observation: { ...observation, status: "failed" } });
		expect(await s.row()).toMatchObject({ observation: { amountCents: 4000, status: "failed" }, lastEventId: "evt_latefailed123456" });
		expect(await s.t.run(ctx => ctx.db.query("clientRefundEvidence").take(2))).toHaveLength(1);
	});

	test.each(["pending", "requires_action", "failed", "canceled"] as const)("keeps %s distinct from a succeeded refund", async status => {
		const s = await setup(); const started = await s.begin(); if (started.kind !== "claimed") throw new Error("Missing claim");
		await s.t.mutation(api.orders.finishClientRefundObservation, { evidenceId: started.evidenceId,
			claimToken: TOKEN, webhookSecret: SECRET, observation: { ...observation, status } });
		expect((await s.row())?.observation?.status).toBe(status);
	});

	test("expires abandoned reads and rejects their result after a newer claim", async () => {
		const s = await setup(); const started = await s.begin(); if (started.kind !== "claimed") throw new Error("Missing claim");
		const expire = () => s.t.mutation(internal.orders.expireClientRefundObservation, { evidenceId: started.evidenceId, claimToken: TOKEN });
		expect(await expire()).toBe(false); vi.setSystemTime(Date.now() + CLIENT_REFUND_OBSERVATION_LEASE_MS);
		expect(await expire()).toBe(true); expect(await s.row()).toMatchObject({ state: "attention", issue: "observation_expired" });
		await s.begin({ ...claim, claimToken: SECOND_TOKEN });
		expect(await s.t.mutation(api.orders.finishClientRefundObservation, { evidenceId: started.evidenceId,
			claimToken: TOKEN, webhookSecret: SECRET, observation })).toBe(false);
		expect(await expire()).toBe(false);
	});

	test.each([{ amountCents: 0 }, { amountCents: 11001 }, { amountCents: 1.5 }, { totalCents: 11001 },
		{ subtotalCents: 9999 }, { stripeChargeId: "bad" }])("rejects contradictory evidence %j", async changed => {
		const s = await setup(); const started = await s.begin(); if (started.kind !== "claimed") throw new Error("Missing claim");
		await expect(s.t.mutation(api.orders.finishClientRefundObservation, { evidenceId: started.evidenceId,
			claimToken: TOKEN, webhookSecret: SECRET, observation: { ...observation, ...changed } })).rejects.toThrow();
		expect((await s.row())?.observation).toBeUndefined();
	});

	test("does not overwrite immutable refund amounts during status refresh", async () => {
		const s = await setup(); const started = await s.begin(); if (started.kind !== "claimed") throw new Error("Missing claim");
		await s.t.mutation(api.orders.finishClientRefundObservation, { evidenceId: started.evidenceId,
			claimToken: TOKEN, webhookSecret: SECRET, observation });
		await s.begin({ ...claim, claimToken: SECOND_TOKEN });
		await expect(s.t.mutation(api.orders.finishClientRefundObservation, { evidenceId: started.evidenceId,
			claimToken: SECOND_TOKEN, webhookSecret: SECRET, observation: { ...observation, amountCents: 4001 } })).rejects.toThrow();
		expect((await s.row())?.observation).toEqual(observation);
	});

	test("authorizes reads using stored membership and hides worker credentials", async () => {
		const s = await setup(); await s.begin();
		await expect(s.t.query(api.orders.listClientRefundEvidence, { orderId: s.orderId! })).rejects.toThrow();
		await expect(s.t.withIdentity({ subject: "other", email: "other@example.invalid", emailVerified: true })
			.query(api.orders.listClientRefundEvidence, { orderId: s.orderId! })).rejects.toThrow();
		const result = await s.owner.query(api.orders.listClientRefundEvidence, { orderId: s.orderId! });
		expect(result).toMatchObject({ items: [{ state: "checking", observation: null }] });
		expect(JSON.stringify(result)).not.toContain(TOKEN); expect(JSON.stringify(result)).not.toContain(SECRET);
	});

	test("keeps historical orders explicitly outside this evidence protocol", async () => {
		const s = await setup(); await s.t.run(ctx => ctx.db.patch(s.orderId!, { checkoutFinancialSnapshot: undefined }));
		expect(await s.begin()).toEqual({ kind: "legacy" });
		expect(await s.owner.query(api.orders.listClientRefundEvidence, { orderId: s.orderId! }))
			.toEqual({ evidenceAvailable: false, items: [], hasMore: false });
	});
});
