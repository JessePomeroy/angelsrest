/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { ORDER_RESET_LIMIT } from "./orderReset";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE_URL = "angelsrest.online";
const RESET_ID = "angels_rest_full_order_reset_v1_20260809";

beforeEach(() => {
	process.env.ORDER_PRODUCERS_STATE = "closed";
	process.env.WEBHOOK_SECRET = "test-webhook-secret";
});

afterEach(() => {
	delete process.env.ORDER_PRODUCERS_STATE;
	delete process.env.WEBHOOK_SECRET;
});

function order(index: number, overrides: Record<string, unknown> = {}) {
	return {
		siteUrl: SITE_URL,
		orderNumber: `BAD-${index}`,
		stripeSessionId: `cs_reset_${index}`,
		customerEmail: "dummy@example.com",
		items: [],
		total: 0,
		fulfillmentType: "self" as const,
		status: "new" as const,
		...overrides,
	};
}

async function insertOrder(
	t: ReturnType<typeof convexTest>,
	index: number,
	overrides: Record<string, unknown> = {},
) {
	return await t.run((ctx) => ctx.db.insert("orders", order(index, overrides)));
}

async function apply(t: ReturnType<typeof convexTest>) {
	return await t.mutation(internal.orderReset.apply, {});
}

describe("owner-approved full order reset", () => {
	test("atomically retains replay tombstones, preserves audit state, and verifies the reset", async () => {
		const t = convexTest(schema, modules);
		const first = await insertOrder(t, 1);
		await insertOrder(t, 2, { stripeConnectedAccountId: "acct_tenant" });
		const intent = await t.run((ctx) => ctx.db.insert("manualRefundIntents", {
			accountScope: "platform",
			siteUrl: SITE_URL,
			stripeEventId: "evt_audit",
			stripeRefundId: "re_audit",
			stripeChargeId: "ch_audit",
			stripeSessionId: "cs_audit",
			stripePaymentIntentId: "pi_audit",
			amount: 0,
			currency: "usd",
			livemode: true,
			createdAt: 1,
			orderId: first,
			consumedAt: 2,
		}));
		const auditBefore = await t.run((ctx) => ctx.db.get(intent));

		await expect(apply(t)).resolves.toEqual({ outcome: "applied" });
		await expect(t.query(internal.orderReset.verify, {})).resolves.toEqual({ outcome: "complete" });

		const state = await t.run(async (ctx) => ({
			orders: await ctx.db.query("orders").take(1),
			tombstones: await ctx.db
				.query("retiredOrderSessions")
				.withIndex("by_siteUrl", (q) => q.eq("siteUrl", SITE_URL))
				.take(3),
			receipt: await ctx.db
				.query("orderResetReceipts")
				.withIndex("by_resetId", (q) => q.eq("resetId", RESET_ID))
				.unique(),
			audit: await ctx.db.get(intent),
		}));
		expect(state.orders).toEqual([]);
		expect(state.tombstones).toHaveLength(2);
		expect(state.tombstones.map(({ protocolVersion, siteUrl, resetId, routingKind }) => ({
			protocolVersion,
			siteUrl,
			resetId,
			routingKind,
		})).sort((a, b) => a.routingKind.localeCompare(b.routingKind))).toEqual([
			{ protocolVersion: 1, siteUrl: SITE_URL, resetId: RESET_ID, routingKind: "connected" },
			{ protocolVersion: 1, siteUrl: SITE_URL, resetId: RESET_ID, routingKind: "legacy_unscoped" },
		]);
		expect(state.receipt).toMatchObject({
			protocolVersion: 1,
			siteUrl: SITE_URL,
			resetId: RESET_ID,
			retiredOrderCount: 2,
			manifestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
		});
		expect(state.audit).toEqual(auditBefore);
		await expect(apply(t)).resolves.toEqual({ outcome: "already_applied" });
	});

	test("detects missing tombstones on verification and retry", async () => {
		const t = convexTest(schema, modules);
		await insertOrder(t, 1);
		await insertOrder(t, 2);
		await expect(apply(t)).resolves.toEqual({ outcome: "applied" });
		await t.run(async (ctx) => {
			const [tombstone] = await ctx.db.query("retiredOrderSessions").take(1);
			await ctx.db.delete(tombstone._id);
		});

		await expect(t.query(internal.orderReset.verify, {})).resolves.toEqual({ outcome: "conflict" });
		await expect(apply(t)).resolves.toEqual({ outcome: "conflict" });
	});

	test("restarts tenant numbering at ORD-001 after the separately gated reopen", async () => {
		const t = convexTest(schema, modules);
		await insertOrder(t, 1);
		await expect(apply(t)).resolves.toEqual({ outcome: "applied" });
		process.env.ORDER_PRODUCERS_STATE = "open";

		const created = await t.mutation(api.orders.create, {
			siteUrl: SITE_URL,
			webhookSecret: "test-webhook-secret",
			stripeSessionId: "cs_after_reset",
			customerEmail: "buyer@example.com",
			items: [{ productName: "Paid name", quantity: 1, price: 4200 }],
			total: 4200,
			fulfillmentType: "lumaprints",
		});

		expect(created.orderNumber).toBe("ORD-001");
	});

	test("treats live-order and tombstone coexistence as a routing and verification conflict", async () => {
		const t = convexTest(schema, modules);
		await insertOrder(t, 1);
		await expect(apply(t)).resolves.toEqual({ outcome: "applied" });
		const [tombstone] = await t.run((ctx) => ctx.db.query("retiredOrderSessions").take(1));
		await insertOrder(t, 9, {
			siteUrl: "other.example",
			stripeSessionId: tombstone.stripeSessionId,
		});

		await expect(t.query(internal.orderReset.verify, {})).resolves.toEqual({ outcome: "conflict" });
		await expect(t.query(api.orders.resolveCheckoutRouting, {
			stripeSessionId: tombstone.stripeSessionId,
			stripeTenantMetadataSiteUrl: SITE_URL,
			webhookSecret: "test-webhook-secret",
		})).rejects.toThrow("Checkout routing facts conflict");
	});

	test("rejects a structurally valid replacement tombstone with the wrong manifest", async () => {
		const t = convexTest(schema, modules);
		await insertOrder(t, 1);
		await insertOrder(t, 2);
		await expect(apply(t)).resolves.toEqual({ outcome: "applied" });
		await t.run(async (ctx) => {
			const [tombstone] = await ctx.db.query("retiredOrderSessions").take(1);
			await ctx.db.delete(tombstone._id);
			await ctx.db.insert("retiredOrderSessions", {
				protocolVersion: 1,
				siteUrl: SITE_URL,
				routingKind: "legacy_unscoped",
				stripeSessionId: "cs_replacement",
				retiredOrderId: tombstone.retiredOrderId,
				resetId: RESET_ID,
				retiredAt: tombstone.retiredAt,
			});
		});

		await expect(t.query(internal.orderReset.verify, {})).resolves.toEqual({ outcome: "conflict" });
	});

	test.each([undefined, "open", " closed ", "paused"])(
		"requires the explicit closed producer state: %s",
		async (state) => {
			if (state === undefined) delete process.env.ORDER_PRODUCERS_STATE;
			else process.env.ORDER_PRODUCERS_STATE = state;
			const t = convexTest(schema, modules);
			await insertOrder(t, 1);

			await expect(apply(t)).rejects.toThrow("Order producers must be explicitly closed");
			await expect(t.query(internal.orderReset.verify, {})).rejects.toThrow(
				"Order producers must be explicitly closed",
			);
			await expect(t.query(
				internal.orderReset.providerInvestigationTarget,
				{},
			)).rejects.toThrow("Order producers must be explicitly closed");
			await expect(t.query(
				internal.orderReset.providerMultiInvestigationTargets,
				{},
			)).rejects.toThrow("Order producers must be explicitly closed");
			await expect(t.query(
				internal.orderReset.providerMultiLookupEligibleTargets,
				{},
			)).rejects.toThrow("Order producers must be explicitly closed");
			await expect(t.query(
				internal.orderReset.classifyProviderMultiTargetConflict,
				{},
			)).rejects.toThrow("Order producers must be explicitly closed");
			await expect(t.query(
				internal.orderReset.classifyProviderMultiLookupEligibility,
				{},
			)).rejects.toThrow("Order producers must be explicitly closed");
			await expect(t.query(
				internal.orderReset.classifyProviderTargetConflict,
				{},
			)).rejects.toThrow("Order producers must be explicitly closed");
			expect(await t.run((ctx) => ctx.db.query("orders").take(2))).toHaveLength(1);
		},
	);

	test("stops without writes when the bounded source overflows", async () => {
		const t = convexTest(schema, modules);
		await t.run(async (ctx) => {
			for (let index = 0; index < ORDER_RESET_LIMIT + 1; index += 1) {
				await ctx.db.insert("orders", order(index));
			}
		});

		await expect(t.query(
			internal.orderReset.classifyProviderTargetConflict,
			{},
		)).resolves.toEqual({ outcome: "source_conflict" });
		await expect(apply(t)).resolves.toEqual({ outcome: "source_overflow" });
		expect(await t.run((ctx) => ctx.db.query("retiredOrderSessions").take(1))).toEqual([]);
		expect(await t.run((ctx) => ctx.db.query("orderResetReceipts").take(1))).toEqual([]);
	});

	test("stops on tenant and global duplicate sessions without touching a foreign order", async () => {
		const duplicate = convexTest(schema, modules);
		await insertOrder(duplicate, 1, { stripeSessionId: "cs_duplicate" });
		await insertOrder(duplicate, 2, { stripeSessionId: "cs_duplicate" });
		await expect(apply(duplicate)).resolves.toEqual({ outcome: "conflict" });

		const global = convexTest(schema, modules);
		await insertOrder(global, 1, { stripeSessionId: "cs_global_duplicate" });
		const foreign = await insertOrder(global, 2, {
			siteUrl: "other.example",
			stripeSessionId: "cs_global_duplicate",
		});
		await expect(apply(global)).resolves.toEqual({ outcome: "conflict" });
		expect(await global.run((ctx) => ctx.db.get(foreign))).not.toBeNull();
	});

	test.each([
		"https://angelsrest.online",
		"www.angelsrest.online",
		"https://www.angelsrest.online",
	])("stops when legacy site source %s exists", async (legacySiteUrl) => {
		const t = convexTest(schema, modules);
		await insertOrder(t, 1);
		await insertOrder(t, 2, { siteUrl: legacySiteUrl });
		await expect(apply(t)).resolves.toEqual({ outcome: "conflict" });
	});

	test("stops when a tombstone conflict or live effect exists", async () => {
		const conflict = convexTest(schema, modules);
		const orderId = await insertOrder(conflict, 1);
		await conflict.run((ctx) => ctx.db.insert("retiredOrderSessions", {
			protocolVersion: 1,
			siteUrl: SITE_URL,
			routingKind: "legacy_unscoped",
			stripeSessionId: "cs_reset_1",
			retiredOrderId: orderId,
			resetId: "different_reset",
			retiredAt: 1,
		}));
		await expect(apply(conflict)).resolves.toEqual({ outcome: "conflict" });

		const live = convexTest(schema, modules);
		await insertOrder(live, 1, { printFulfillmentLeaseExpiresAt: Date.now() + 60_000 });
		await expect(apply(live)).resolves.toEqual({ outcome: "live_effect" });
	});

	test.each([
		{ printFulfillmentClaim: true, printFulfillmentClaimedAt: 1 },
		{ printFulfillmentPhase: "submitting" as const, printFulfillmentClaimedAt: 1 },
		{ printFulfillmentResolution: "submission_uncertain" as const },
		{ printFulfillmentResolution: "reconciliation_blocked" as const },
		{ lumaprintsOrderNumber: "LP-unresolved", status: "printing" as const },
		{ fulfillmentRecoveryStatus: "refund_pending" as const },
		{ automatedRefundStatus: "pending" as const },
		{ automatedRefundStatus: "requires_action" as const },
		{ automatedRefundAttentionReason: "request_outcome_unknown" as const },
	])("stops on durable unresolved provider state %#", async (unresolvedState) => {
		const t = convexTest(schema, modules);
		await insertOrder(t, 1, unresolvedState);
		await expect(apply(t)).resolves.toEqual({ outcome: "live_effect" });
		expect(await t.run((ctx) => ctx.db.query("orders").collect())).toHaveLength(1);
	});

	test("classifies all live-effect families with deterministic closed output", async () => {
		const t = convexTest(schema, modules);
		const now = Date.now();
		await insertOrder(t, 1, {
			fulfillmentRecoveryStatus: "refund_pending",
			automatedRefundAttentionReason: "request_outcome_unknown",
			printFulfillmentClaim: true,
			lumaprintsOrderNumber: "LP-unresolved",
			status: "printing",
			automatedRefundLeaseExpiresAt: now + 60_000,
			stripeFeeCaptureLastAttemptAt: now,
		});

		const result = await t.query(internal.orderReset.classifyLiveEffect, {});
		expect(result).toEqual({
			outcome: "live_effect",
			classes: [
				"refund_nonterminal",
				"refund_outcome_unknown",
				"print_submission_unresolved",
				"provider_order_nonterminal",
				"active_deadline",
				"recent_activity",
			],
		});
		expect(Object.keys(result).sort()).toEqual(["classes", "outcome"]);
	});

	test("classifies empty, clear, legacy-conflict, and overflow sources without raw facts", async () => {
		const empty = convexTest(schema, modules);
		await expect(empty.query(internal.orderReset.classifyLiveEffect, {})).resolves.toEqual({
			outcome: "source_empty",
		});

		const clear = convexTest(schema, modules);
		await insertOrder(clear, 1);
		await expect(clear.query(internal.orderReset.classifyLiveEffect, {})).resolves.toEqual({
			outcome: "no_live_effect",
		});

		const legacy = convexTest(schema, modules);
		await insertOrder(legacy, 1, { siteUrl: "https://angelsrest.online" });
		await expect(legacy.query(internal.orderReset.classifyLiveEffect, {})).resolves.toEqual({
			outcome: "legacy_source_conflict",
		});

		const overflow = convexTest(schema, modules);
		await overflow.run(async (ctx) => {
			for (let index = 0; index < ORDER_RESET_LIMIT + 1; index += 1) {
				await ctx.db.insert("orders", order(index));
			}
		});
		await expect(overflow.query(internal.orderReset.classifyLiveEffect, {})).resolves.toEqual({
			outcome: "source_overflow",
		});
	});

	test("selects one authorized provider-investigation target without a write", async () => {
		const t = convexTest(schema, modules);
		const externalId = "cs_live_1234567890abcdef";
		await insertOrder(t, 1, {
			stripeSessionId: externalId,
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
			printFulfillmentResolution: "submission_uncertain",
		});
		const before = await t.run((ctx) => ctx.db.query("orders").take(2));

		await expect(t.query(internal.orderReset.providerInvestigationTarget, {})).resolves.toEqual({
			outcome: "ready",
			externalId,
		});
		expect(await t.run((ctx) => ctx.db.query("orders").take(2))).toEqual(before);
		await expect(apply(t)).resolves.toEqual({ outcome: "live_effect" });
	});

	test("fails provider target selection closed on source, target, and live-effect conflicts", async () => {
		const empty = convexTest(schema, modules);
		await expect(empty.query(
			internal.orderReset.providerInvestigationTarget,
			{},
		)).resolves.toEqual({ outcome: "source_conflict" });

		const resetApplied = convexTest(schema, modules);
		await insertOrder(resetApplied, 1);
		await expect(apply(resetApplied)).resolves.toEqual({ outcome: "applied" });
		await expect(resetApplied.query(
			internal.orderReset.providerInvestigationTarget,
			{},
		)).resolves.toEqual({ outcome: "source_conflict" });

		const duplicate = convexTest(schema, modules);
		for (let index = 1; index <= 2; index += 1) {
			await insertOrder(duplicate, index, {
				stripeSessionId: `cs_live_1234567890abcde${index}`,
				fulfillmentType: "lumaprints",
				printFulfillmentClaim: true,
				printFulfillmentClaimedAt: 1,
			});
		}
		await expect(duplicate.query(
			internal.orderReset.providerInvestigationTarget,
			{},
		)).resolves.toEqual({ outcome: "target_conflict" });

		const excludedUnresolved = convexTest(schema, modules);
		await insertOrder(excludedUnresolved, 1, {
			stripeSessionId: "cs_live_1234567890abcdef",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await insertOrder(excludedUnresolved, 2, {
			stripeSessionId: "cs_live_1234567890abcdeg",
			fulfillmentType: "self",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await expect(excludedUnresolved.query(
			internal.orderReset.providerInvestigationTarget,
			{},
		)).resolves.toEqual({ outcome: "target_conflict" });

		const globalDuplicate = convexTest(schema, modules);
		await insertOrder(globalDuplicate, 1, {
			stripeSessionId: "cs_live_1234567890abcdef",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await insertOrder(globalDuplicate, 2, {
			siteUrl: "other.example",
			stripeSessionId: "cs_live_1234567890abcdef",
		});
		await expect(globalDuplicate.query(
			internal.orderReset.providerInvestigationTarget,
			{},
		)).resolves.toEqual({ outcome: "target_conflict" });

		const otherLiveEffect = convexTest(schema, modules);
		await insertOrder(otherLiveEffect, 1, {
			stripeSessionId: "cs_live_1234567890abcdef",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
			fulfillmentRecoveryStatus: "refund_pending",
		});
		await expect(otherLiveEffect.query(
			internal.orderReset.providerInvestigationTarget,
			{},
		)).resolves.toEqual({ outcome: "live_effect_conflict" });

		const preparationOnly = convexTest(schema, modules);
		await insertOrder(preparationOnly, 1, {
			stripeSessionId: "cs_live_1234567890abcdef",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
			printFulfillmentPhase: "preparing",
		});
		await expect(preparationOnly.query(
			internal.orderReset.providerInvestigationTarget,
			{},
		)).resolves.toEqual({ outcome: "target_conflict" });

		const legacy = convexTest(schema, modules);
		await insertOrder(legacy, 1, {
			siteUrl: "https://angelsrest.online",
			stripeSessionId: "cs_live_1234567890abcdef",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
		});
		await expect(legacy.query(
			internal.orderReset.providerInvestigationTarget,
			{},
		)).resolves.toEqual({ outcome: "source_conflict" });
	});

	test("classifies provider target conflicts with deterministic normalized output", async () => {
		const combined = convexTest(schema, modules);
		await insertOrder(combined, 1, {
			stripeSessionId: "cs_test_1234567890abcdef",
			fulfillmentType: "self",
			status: "refunded",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
			printFulfillmentPhase: "preparing",
			lumaprintsOrderNumber: "10000000001",
		});
		await insertOrder(combined, 2, {
			siteUrl: "other.example",
			stripeSessionId: "cs_test_1234567890abcdef",
		});
		await expect(combined.query(
			internal.orderReset.classifyProviderTargetConflict,
			{},
		)).resolves.toEqual({
			outcome: "target_conflict",
			classes: [
				"fulfillment_not_lumaprints",
				"preparation_only",
				"provider_number_present",
				"session_not_live",
				"session_not_unique",
			],
		});
		await expect(combined.query(
			internal.orderReset.providerInvestigationTarget,
			{},
		)).resolves.toEqual({ outcome: "target_conflict" });
	});

	test("classifies provider target source, live-effect, cardinality, and ready states", async () => {
		const empty = convexTest(schema, modules);
		await expect(empty.query(
			internal.orderReset.classifyProviderTargetConflict,
			{},
		)).resolves.toEqual({ outcome: "source_conflict" });

		const clear = convexTest(schema, modules);
		await insertOrder(clear, 1);
		await expect(clear.query(
			internal.orderReset.classifyProviderTargetConflict,
			{},
		)).resolves.toEqual({ outcome: "target_conflict", classes: ["unresolved_none"] });

		const multiple = convexTest(schema, modules);
		for (let index = 1; index <= 2; index += 1) {
			await insertOrder(multiple, index, {
				stripeSessionId: `cs_live_1234567890abcde${index}`,
				fulfillmentType: "lumaprints",
				printFulfillmentClaim: true,
				printFulfillmentClaimedAt: 1,
			});
		}
		await expect(multiple.query(
			internal.orderReset.classifyProviderTargetConflict,
			{},
		)).resolves.toEqual({ outcome: "target_conflict", classes: ["unresolved_multiple"] });

		const otherLiveEffect = convexTest(schema, modules);
		await insertOrder(otherLiveEffect, 1, {
			stripeSessionId: "cs_live_1234567890abcdef",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
			fulfillmentRecoveryStatus: "refund_pending",
		});
		await expect(otherLiveEffect.query(
			internal.orderReset.classifyProviderTargetConflict,
			{},
		)).resolves.toEqual({ outcome: "live_effect_conflict" });

		const ready = convexTest(schema, modules);
		await insertOrder(ready, 1, {
			stripeSessionId: "cs_live_1234567890abcdef",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await expect(ready.query(
			internal.orderReset.classifyProviderTargetConflict,
			{},
		)).resolves.toEqual({ outcome: "no_target_conflict" });
	});

	test("selects a bounded sorted multi-target set without writes and fails closed", async () => {
		const ready = convexTest(schema, modules);
		for (const [index, suffix] of [[1, "2"], [2, "1"]] as const) {
			await insertOrder(ready, index, {
				stripeSessionId: `cs_live_1234567890abcde${suffix}`,
				fulfillmentType: "lumaprints",
				printFulfillmentClaim: true,
				printFulfillmentClaimedAt: 1,
			});
		}
		const before = await ready.run((ctx) => ctx.db.query("orders").collect());
		await expect(ready.query(
			internal.orderReset.providerMultiInvestigationTargets,
			{},
		)).resolves.toEqual({
			outcome: "ready",
			externalIds: ["cs_live_1234567890abcde1", "cs_live_1234567890abcde2"],
		});
		expect(await ready.run((ctx) => ctx.db.query("orders").collect())).toEqual(before);

		const single = convexTest(schema, modules);
		await insertOrder(single, 1, {
			stripeSessionId: "cs_live_1234567890abcdef",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await expect(single.query(
			internal.orderReset.providerMultiInvestigationTargets,
			{},
		)).resolves.toEqual({ outcome: "target_conflict" });

		const invalid = convexTest(schema, modules);
		await insertOrder(invalid, 1, {
			stripeSessionId: "cs_live_1234567890abcdef",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await insertOrder(invalid, 2, {
			stripeSessionId: "cs_test_1234567890abcdef",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await expect(invalid.query(
			internal.orderReset.providerMultiInvestigationTargets,
			{},
		)).resolves.toEqual({ outcome: "target_conflict" });

		const liveEffect = convexTest(schema, modules);
		for (let index = 1; index <= 2; index += 1) {
			await insertOrder(liveEffect, index, {
				stripeSessionId: `cs_live_1234567890abcde${index}`,
				fulfillmentType: "lumaprints",
				printFulfillmentClaim: true,
				printFulfillmentClaimedAt: 1,
				...(index === 2 ? { fulfillmentRecoveryStatus: "refund_pending" } : {}),
			});
		}
		await expect(liveEffect.query(
			internal.orderReset.providerMultiInvestigationTargets,
			{},
		)).resolves.toEqual({ outcome: "live_effect_conflict" });
	});

	test("freshly selects lookup-eligible test and live targets without fulfillment authority or writes", async () => {
		const t = convexTest(schema, modules);
		await insertOrder(t, 1, {
			stripeSessionId: "cs_live_1234567890abcdeg",
			fulfillmentType: "self",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await insertOrder(t, 2, {
			stripeSessionId: "cs_test_1234567890abcdef",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		const before = await t.run((ctx) => ctx.db.query("orders").collect());

		await expect(t.query(
			internal.orderReset.providerMultiLookupEligibleTargets,
			{},
		)).resolves.toEqual({
			outcome: "ready",
			externalIds: ["cs_live_1234567890abcdeg", "cs_test_1234567890abcdef"],
		});
		expect(await t.run((ctx) => ctx.db.query("orders").collect())).toEqual(before);
	});

	test("bounds lookup-eligible selection and rejects every unsafe target shape", async () => {
		const empty = convexTest(schema, modules);
		await expect(empty.query(
			internal.orderReset.providerMultiLookupEligibleTargets,
			{},
		)).resolves.toEqual({ outcome: "source_conflict" });

		const single = convexTest(schema, modules);
		await insertOrder(single, 1, {
			stripeSessionId: "cs_test_1234567890abcdef",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await expect(single.query(
			internal.orderReset.providerMultiLookupEligibleTargets,
			{},
		)).resolves.toEqual({ outcome: "target_conflict" });

		for (const unsafe of [
			{ stripeSessionId: "invalid-provider-identity" },
			{ stripeSessionId: `cs_test_${"A".repeat(15)}` },
			{ stripeSessionId: `cs_test_${"A".repeat(121)}` },
			{ printFulfillmentPhase: "preparing" },
			{ lumaprintsOrderNumber: "10000000001", status: "shipped" },
		] as const) {
			const t = convexTest(schema, modules);
			await insertOrder(t, 1, {
				stripeSessionId: "cs_live_1234567890abcdef",
				printFulfillmentClaim: true,
				printFulfillmentClaimedAt: 1,
			});
			await insertOrder(t, 2, {
				stripeSessionId: "cs_test_1234567890abcdeg",
				printFulfillmentClaim: true,
				printFulfillmentClaimedAt: 1,
				...unsafe,
			});
			await expect(t.query(
				internal.orderReset.providerMultiLookupEligibleTargets,
				{},
			)).resolves.toEqual({ outcome: "target_conflict" });
		}

		const nonUnique = convexTest(schema, modules);
		await insertOrder(nonUnique, 1, {
			stripeSessionId: "cs_live_1234567890abcdef",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await insertOrder(nonUnique, 2, {
			stripeSessionId: "cs_test_1234567890abcdeg",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await insertOrder(nonUnique, 3, {
			siteUrl: "other.example",
			stripeSessionId: "cs_test_1234567890abcdeg",
		});
		await expect(nonUnique.query(
			internal.orderReset.providerMultiLookupEligibleTargets,
			{},
		)).resolves.toEqual({ outcome: "target_conflict" });

		const otherLiveEffect = convexTest(schema, modules);
		for (let index = 1; index <= 2; index += 1) {
			await insertOrder(otherLiveEffect, index, {
				stripeSessionId: `cs_${index === 1 ? "live" : "test"}_1234567890abcde${index}`,
				printFulfillmentClaim: true,
				printFulfillmentClaimedAt: 1,
				...(index === 2 ? { fulfillmentRecoveryStatus: "refund_pending" } : {}),
			});
		}
		await expect(otherLiveEffect.query(
			internal.orderReset.providerMultiLookupEligibleTargets,
			{},
		)).resolves.toEqual({ outcome: "live_effect_conflict" });
	});

	test("uses the shared exact Checkout Session shape boundaries", async () => {
		const t = convexTest(schema, modules);
		const externalIds = [`cs_live_${"A".repeat(120)}`, `cs_test_${"B".repeat(16)}`];
		for (const [index, stripeSessionId] of externalIds.entries()) {
			await insertOrder(t, index, {
				stripeSessionId,
				printFulfillmentClaim: true,
				printFulfillmentClaimedAt: 1,
			});
		}
		await expect(t.query(
			internal.orderReset.providerMultiLookupEligibleTargets,
			{},
		)).resolves.toEqual({ outcome: "ready", externalIds });
	});

	test("preserves every bounded source and reset-artifact conflict", async () => {
		const overflow = convexTest(schema, modules);
		await overflow.run(async (ctx) => {
			for (let index = 0; index < ORDER_RESET_LIMIT + 1; index += 1) {
				await ctx.db.insert("orders", order(index));
			}
		});
		await expect(overflow.query(
			internal.orderReset.providerMultiLookupEligibleTargets,
			{},
		)).resolves.toEqual({ outcome: "source_conflict" });

		const legacy = convexTest(schema, modules);
		await insertOrder(legacy, 1, { siteUrl: "https://angelsrest.online" });
		await expect(legacy.query(
			internal.orderReset.providerMultiLookupEligibleTargets,
			{},
		)).resolves.toEqual({ outcome: "source_conflict" });

		const receipt = convexTest(schema, modules);
		await insertOrder(receipt, 1);
		await receipt.run((ctx) => ctx.db.insert("orderResetReceipts", {
			protocolVersion: 1,
			resetId: RESET_ID,
			siteUrl: SITE_URL,
			retiredOrderCount: 1,
			manifestDigest: "0".repeat(64),
			completedAt: 1,
		}));
		await expect(receipt.query(
			internal.orderReset.providerMultiLookupEligibleTargets,
			{},
		)).resolves.toEqual({ outcome: "source_conflict" });

		const tombstone = convexTest(schema, modules);
		const retiredOrderId = await insertOrder(tombstone, 1);
		await tombstone.run((ctx) => ctx.db.insert("retiredOrderSessions", {
			protocolVersion: 1,
			siteUrl: SITE_URL,
			routingKind: "legacy_unscoped",
			stripeSessionId: "cs_retired_source_conflict",
			retiredOrderId,
			resetId: RESET_ID,
			retiredAt: 1,
		}));
		await expect(tombstone.query(
			internal.orderReset.providerMultiLookupEligibleTargets,
			{},
		)).resolves.toEqual({ outcome: "source_conflict" });
	});

	test("accepts the full bounded lookup-eligible target set", async () => {
		const t = convexTest(schema, modules);
		for (let index = 0; index < ORDER_RESET_LIMIT; index += 1) {
			await insertOrder(t, index, {
				stripeSessionId: `cs_${index % 2 === 0 ? "test" : "live"}_${String(index).padStart(16, "0")}`,
				printFulfillmentClaim: true,
				printFulfillmentClaimedAt: 1,
			});
		}
		const result = await t.query(internal.orderReset.providerMultiLookupEligibleTargets, {});
		expect(result.outcome).toBe("ready");
		if (result.outcome === "ready") {
			expect(result.externalIds).toHaveLength(ORDER_RESET_LIMIT);
			expect(result.externalIds).toEqual([...result.externalIds].sort());
		}
	});

	test("classifies multi-target conflicts without rows, counts, writes, or provider access", async () => {
		const empty = convexTest(schema, modules);
		await expect(empty.query(
			internal.orderReset.classifyProviderMultiTargetConflict,
			{},
		)).resolves.toEqual({ outcome: "source_conflict" });

		const none = convexTest(schema, modules);
		await insertOrder(none, 1);
		await expect(none.query(
			internal.orderReset.classifyProviderMultiTargetConflict,
			{},
		)).resolves.toEqual({ outcome: "target_conflict", classes: ["unresolved_none"] });

		const single = convexTest(schema, modules);
		await insertOrder(single, 1, {
			stripeSessionId: "cs_live_1234567890abcdef",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await expect(single.query(
			internal.orderReset.classifyProviderMultiTargetConflict,
			{},
		)).resolves.toEqual({ outcome: "target_conflict", classes: ["unresolved_single"] });

		const combined = convexTest(schema, modules);
		await insertOrder(combined, 1, {
			stripeSessionId: "cs_live_1234567890abcdef",
			fulfillmentType: "self",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
			printFulfillmentPhase: "preparing",
		});
		await insertOrder(combined, 2, {
			stripeSessionId: "cs_test_1234567890abcdef",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
			lumaprintsOrderNumber: "10000000001",
			status: "shipped",
		});
		const before = await combined.run((ctx) => ctx.db.query("orders").collect());
		await expect(combined.query(
			internal.orderReset.classifyProviderMultiTargetConflict,
			{},
		)).resolves.toEqual({
			outcome: "target_conflict",
			classes: [
				"fulfillment_not_lumaprints",
				"preparation_only",
				"provider_number_present",
				"session_not_live",
			],
		});
		expect(await combined.run((ctx) => ctx.db.query("orders").collect())).toEqual(before);

		const ready = convexTest(schema, modules);
		for (let index = 1; index <= 2; index += 1) {
			await insertOrder(ready, index, {
				stripeSessionId: `cs_live_1234567890abcde${index}`,
				fulfillmentType: "lumaprints",
				printFulfillmentClaim: true,
				printFulfillmentClaimedAt: 1,
			});
		}
		await expect(ready.query(
			internal.orderReset.classifyProviderMultiTargetConflict,
			{},
		)).resolves.toEqual({ outcome: "no_target_conflict" });
	});

	test.each([
		["minimum", `cs_test_${"a".repeat(16)}`],
		["maximum", `cs_test_${"a".repeat(120)}`],
	])(
		"classifies the exact conflict as aggregate lookup eligible at the %s identity bound",
		async (_boundary, testSessionId) => {
			const t = convexTest(schema, modules);
			await insertOrder(t, 1, {
				stripeSessionId: "cs_live_1234567890abcdef",
				fulfillmentType: "self",
				printFulfillmentClaim: true,
				printFulfillmentClaimedAt: 1,
			});
			await insertOrder(t, 2, {
				stripeSessionId: testSessionId,
				fulfillmentType: "lumaprints",
				printFulfillmentClaim: true,
				printFulfillmentClaimedAt: 1,
			});
			const before = await t.run((ctx) => ctx.db.query("orders").collect());

			await expect(t.query(
				internal.orderReset.classifyProviderMultiTargetConflict,
				{},
			)).resolves.toEqual({
				outcome: "target_conflict",
				classes: ["fulfillment_not_lumaprints", "session_not_live"],
			});
			await expect(t.query(
				internal.orderReset.classifyProviderMultiLookupEligibility,
				{},
			)).resolves.toEqual({ outcome: "lookup_shape_eligible" });
			expect(await t.run((ctx) => ctx.db.query("orders").collect())).toEqual(before);
		},
	);

	test.each([
		["short test identity", `cs_test_${"a".repeat(15)}`],
		["long test identity", `cs_test_${"a".repeat(121)}`],
		["unsupported identity family", `cs_other_${"a".repeat(16)}`],
	])(
		"classifies an exact conflict with a %s as aggregate lookup ineligible",
		async (_case, invalidSessionId) => {
			const t = convexTest(schema, modules);
			await insertOrder(t, 1, {
				stripeSessionId: "cs_live_1234567890abcdef",
				fulfillmentType: "self",
				printFulfillmentClaim: true,
				printFulfillmentClaimedAt: 1,
			});
			await insertOrder(t, 2, {
				stripeSessionId: invalidSessionId,
				fulfillmentType: "lumaprints",
				printFulfillmentClaim: true,
				printFulfillmentClaimedAt: 1,
			});
			const before = await t.run((ctx) => ctx.db.query("orders").collect());

			await expect(t.query(
				internal.orderReset.classifyProviderMultiTargetConflict,
				{},
			)).resolves.toEqual({
				outcome: "target_conflict",
				classes: ["fulfillment_not_lumaprints", "session_not_live"],
			});
			await expect(t.query(
				internal.orderReset.classifyProviderMultiLookupEligibility,
				{},
			)).resolves.toEqual({ outcome: "lookup_shape_ineligible" });
			expect(await t.run((ctx) => ctx.db.query("orders").collect())).toEqual(before);
		},
	);

	test("returns state_changed unless the exact accepted conflict still holds", async () => {
		const none = convexTest(schema, modules);
		await insertOrder(none, 1);
		await expect(none.query(
			internal.orderReset.classifyProviderMultiLookupEligibility,
			{},
		)).resolves.toEqual({ outcome: "state_changed" });

		const single = convexTest(schema, modules);
		await insertOrder(single, 1, {
			stripeSessionId: "cs_test_1234567890abcdef",
			fulfillmentType: "self",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await expect(single.query(
			internal.orderReset.classifyProviderMultiLookupEligibility,
			{},
		)).resolves.toEqual({ outcome: "state_changed" });

		const ready = convexTest(schema, modules);
		for (let index = 1; index <= 2; index += 1) {
			await insertOrder(ready, index, {
				stripeSessionId: `cs_live_1234567890abcde${index}`,
				fulfillmentType: "lumaprints",
				printFulfillmentClaim: true,
				printFulfillmentClaimedAt: 1,
			});
		}
		await expect(ready.query(
			internal.orderReset.classifyProviderMultiLookupEligibility,
			{},
		)).resolves.toEqual({ outcome: "state_changed" });

		const missingFulfillmentClass = convexTest(schema, modules);
		await insertOrder(missingFulfillmentClass, 1, {
			stripeSessionId: "cs_live_1234567890abcdef",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await insertOrder(missingFulfillmentClass, 2, {
			stripeSessionId: "cs_test_1234567890abcdef",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await expect(missingFulfillmentClass.query(
			internal.orderReset.classifyProviderMultiLookupEligibility,
			{},
		)).resolves.toEqual({ outcome: "state_changed" });

		const missingSessionClass = convexTest(schema, modules);
		for (let index = 1; index <= 2; index += 1) {
			await insertOrder(missingSessionClass, index, {
				stripeSessionId: `cs_live_1234567890abcde${index}`,
				fulfillmentType: index === 1 ? "self" : "lumaprints",
				printFulfillmentClaim: true,
				printFulfillmentClaimedAt: 1,
			});
		}
		await expect(missingSessionClass.query(
			internal.orderReset.classifyProviderMultiLookupEligibility,
			{},
		)).resolves.toEqual({ outcome: "state_changed" });

		const extraClass = convexTest(schema, modules);
		await insertOrder(extraClass, 1, {
			stripeSessionId: "cs_live_1234567890abcdef",
			fulfillmentType: "self",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
			printFulfillmentPhase: "preparing",
		});
		await insertOrder(extraClass, 2, {
			stripeSessionId: "cs_test_1234567890abcdef",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await expect(extraClass.query(
			internal.orderReset.classifyProviderMultiLookupEligibility,
			{},
		)).resolves.toEqual({ outcome: "state_changed" });

		const providerNumberBeforeIneligible = convexTest(schema, modules);
		await insertOrder(providerNumberBeforeIneligible, 1, {
			stripeSessionId: "cs_live_1234567890abcdef",
			fulfillmentType: "self",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await insertOrder(providerNumberBeforeIneligible, 2, {
			stripeSessionId: "invalid-provider-identity",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
			lumaprintsOrderNumber: "10000000001",
			status: "shipped",
		});
		await expect(providerNumberBeforeIneligible.query(
			internal.orderReset.classifyProviderMultiLookupEligibility,
			{},
		)).resolves.toEqual({ outcome: "state_changed" });

		const globalNonUnique = convexTest(schema, modules);
		await insertOrder(globalNonUnique, 1, {
			stripeSessionId: "cs_live_1234567890abcdef",
			fulfillmentType: "self",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await insertOrder(globalNonUnique, 2, {
			stripeSessionId: "cs_test_1234567890abcdef",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await insertOrder(globalNonUnique, 3, {
			siteUrl: "other.example",
			stripeSessionId: "cs_test_1234567890abcdef",
		});
		await expect(globalNonUnique.query(
			internal.orderReset.classifyProviderMultiLookupEligibility,
			{},
		)).resolves.toEqual({ outcome: "state_changed" });
	});

	test("preserves normalized source and other-live-effect conflicts", async () => {
		const empty = convexTest(schema, modules);
		await expect(empty.query(
			internal.orderReset.classifyProviderMultiLookupEligibility,
			{},
		)).resolves.toEqual({ outcome: "source_conflict" });

		const liveEffect = convexTest(schema, modules);
		await insertOrder(liveEffect, 1, {
			stripeSessionId: "cs_live_1234567890abcdef",
			fulfillmentType: "self",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
			fulfillmentRecoveryStatus: "refund_pending",
		});
		await insertOrder(liveEffect, 2, {
			stripeSessionId: "cs_test_1234567890abcdef",
			fulfillmentType: "lumaprints",
			printFulfillmentClaim: true,
			printFulfillmentClaimedAt: 1,
		});
		await expect(liveEffect.query(
			internal.orderReset.classifyProviderMultiLookupEligibility,
			{},
		)).resolves.toEqual({ outcome: "live_effect_conflict" });
	});

	test("routes and rejects retired checkout replays after a later reopen", async () => {
		const t = convexTest(schema, modules);
		const retiredOrderId = await insertOrder(t, 1);
		await t.run(async (ctx) => {
			await ctx.db.insert("retiredOrderSessions", {
				protocolVersion: 1,
				siteUrl: SITE_URL,
				routingKind: "legacy_unscoped",
				stripeSessionId: "cs_retired",
				retiredOrderId,
				resetId: RESET_ID,
				retiredAt: 1,
			});
			await ctx.db.delete(retiredOrderId);
		});

		await expect(t.query(api.orders.resolveCheckoutRouting, {
			stripeSessionId: "cs_retired",
			stripeTenantMetadataSiteUrl: SITE_URL,
			webhookSecret: "test-webhook-secret",
		})).resolves.toEqual({
			source: "retired",
			siteUrl: SITE_URL,
			stripeConnectedAccountId: undefined,
		});

		process.env.ORDER_PRODUCERS_STATE = "open";
		await expect(t.mutation(api.orders.create, {
			siteUrl: SITE_URL,
			webhookSecret: "test-webhook-secret",
			stripeSessionId: "cs_retired",
			customerEmail: "dummy@example.com",
			items: [],
			total: 0,
			fulfillmentType: "self",
		})).rejects.toThrow("Order session is retired");
		expect(await t.run((ctx) => ctx.db.query("orders").take(1))).toEqual([]);
	});

	test("uses the stored connected-account binding for historical routing", async () => {
		const t = convexTest(schema, modules);
		const retiredOrderId = await insertOrder(t, 1, {
			stripeConnectedAccountId: "acct_historical",
		});
		await t.run(async (ctx) => {
			await ctx.db.insert("retiredOrderSessions", {
				protocolVersion: 1,
				siteUrl: SITE_URL,
				routingKind: "connected",
				stripeSessionId: "cs_connected_retired",
				stripeConnectedAccountId: "acct_historical",
				retiredOrderId,
				resetId: RESET_ID,
				retiredAt: 1,
			});
			await ctx.db.delete(retiredOrderId);
		});

		await expect(t.query(api.orders.resolveCheckoutRouting, {
			stripeSessionId: "cs_connected_retired",
			stripeConnectedAccountId: "acct_historical",
			webhookSecret: "test-webhook-secret",
		})).resolves.toMatchObject({ source: "retired", siteUrl: SITE_URL });
		await expect(t.query(api.orders.resolveCheckoutRouting, {
			stripeSessionId: "cs_connected_retired",
			stripeConnectedAccountId: "acct_different",
			webhookSecret: "test-webhook-secret",
		})).rejects.toThrow("Checkout routing facts conflict");
	});

	test("stops atomically when a source order still has a bound checkout reservation", async () => {
		const t = convexTest(schema, modules);
		await insertOrder(t, 1);
		await t.run((ctx) => ctx.db.insert("checkoutSnapshotReservations", {
			state: "bound",
			siteUrl: SITE_URL,
			handleHash: "handle",
			snapshotDigest: "digest",
			snapshot: { schemaVersion: 1, catalogProvider: "convex", items: [] },
			accountScope: "acct_unstored_scope",
			stripeConnectedAccountId: "acct_unstored_scope",
			stripeSessionId: "cs_reset_1",
			stripeExpiresAt: 1,
			unboundPurgeAt: 1,
			boundReconcileAt: 1,
			createdAt: 1,
			updatedAt: 1,
			boundAt: 1,
			reconciliationAttempt: 0,
			reconciliationNextAt: Date.now() - 1,
		}));

		await expect(apply(t)).resolves.toEqual({ outcome: "conflict" });
		expect(await t.run((ctx) => ctx.db.query("orders").collect())).toHaveLength(1);
	});

	test("prevents a retired bound reservation from starting provider reconciliation", async () => {
		const t = convexTest(schema, modules);
		const retiredOrderId = await insertOrder(t, 1);
		const now = Date.now();
		const reservationId = await t.run(async (ctx) => {
			await ctx.db.insert("retiredOrderSessions", {
				protocolVersion: 1,
				siteUrl: SITE_URL,
				routingKind: "legacy_unscoped",
				stripeSessionId: "cs_retired_reservation",
				retiredOrderId,
				resetId: RESET_ID,
				retiredAt: 1,
			});
			return await ctx.db.insert("checkoutSnapshotReservations", {
				state: "bound",
				siteUrl: SITE_URL,
				handleHash: "handle",
				snapshotDigest: "digest",
				snapshot: { schemaVersion: 1, catalogProvider: "convex", items: [] },
				accountScope: "platform",
				stripeSessionId: "cs_retired_reservation",
				stripeExpiresAt: 1,
				unboundPurgeAt: 1,
				boundReconcileAt: 1,
				createdAt: 1,
				updatedAt: 1,
				boundAt: 1,
				reconciliationAttempt: 0,
				reconciliationNextAt: now - 1,
			});
		});

		await expect(t.query(internal.orders.getCheckoutSnapshotForReconciliation, {
			reservationId,
			boundAt: 1,
			attempt: 0,
		})).resolves.toBeNull();
	});

	test("does not create a receipt for an unverified empty source", async () => {
		const t = convexTest(schema, modules);
		await expect(apply(t)).resolves.toEqual({ outcome: "source_empty" });
		expect(await t.run((ctx) => ctx.db.query("orderResetReceipts").take(1))).toEqual([]);
	});
});
