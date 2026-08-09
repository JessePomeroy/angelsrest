import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { assertOrderProducersExactlyClosed } from "./helpers/orderProducerGate";

const RESET_PROTOCOL_VERSION = 1 as const;
const RESET_ID = "angels_rest_full_order_reset_v1_20260809";
const SITE_URL = "angelsrest.online";
const LEGACY_SITE_URLS = [
	"https://angelsrest.online",
	"www.angelsrest.online",
	"https://www.angelsrest.online",
] as const;
const RECENT_EFFECT_WINDOW_MS = 5 * 60 * 1000;
/** Conservative one-transaction budget for this fixed, one-use reset. */
export const ORDER_RESET_LIMIT = 50;
const encoder = new TextEncoder();

const activeDeadlineFields = [
	"stripeFeeCaptureNextAttemptAt",
	"printFulfillmentLeaseExpiresAt",
	"printFulfillmentReconciliationAlertLeaseExpiresAt",
	"shipmentEmailNotificationLeaseExpiresAt",
	"automatedRefundLeaseExpiresAt",
	"fulfillmentFailureAdminNotificationLeaseExpiresAt",
	"fulfillmentFailureCustomerNotificationLeaseExpiresAt",
	"automatedRefundFailureNotificationLeaseExpiresAt",
	"automatedRefundAttentionNotificationLeaseExpiresAt",
] as const satisfies readonly (keyof Doc<"orders">)[];

const recentActivityFields = [
	"stripeFeeCaptureLastAttemptAt",
	"printFulfillmentClaimedAt",
	"printFulfillmentReconciliationLastAttemptAt",
	"printFulfillmentReconciliationAlertClaimedAt",
	"orderConfirmationClaimedAt",
	"shipmentEmailNotificationClaimedAt",
	"automatedRefundLastAttemptAt",
	"automatedRefundClaimedAt",
	"fulfillmentFailureAdminNotificationClaimedAt",
	"fulfillmentFailureCustomerNotificationClaimedAt",
	"automatedRefundFailureNotificationClaimedAt",
	"automatedRefundAttentionNotificationClaimedAt",
] as const satisfies readonly (keyof Doc<"orders">)[];

const resetResultValidator = v.union(
	v.object({ outcome: v.literal("applied") }),
	v.object({ outcome: v.literal("already_applied") }),
	v.object({ outcome: v.literal("source_overflow") }),
	v.object({ outcome: v.literal("source_empty") }),
	v.object({ outcome: v.literal("live_effect") }),
	v.object({ outcome: v.literal("conflict") }),
);

const verificationResultValidator = v.union(
	v.object({ outcome: v.literal("complete") }),
	v.object({ outcome: v.literal("missing") }),
	v.object({ outcome: v.literal("source_present") }),
	v.object({ outcome: v.literal("source_overflow") }),
	v.object({ outcome: v.literal("conflict") }),
);

type RetiredBinding = {
	protocolVersion: 1;
	siteUrl: string;
	routingKind: "connected" | "legacy_unscoped";
	stripeSessionId: string;
	stripeConnectedAccountId?: string;
	retiredOrderId: Id<"orders">;
	resetId: string;
};

function hasLiveEffect(order: Doc<"orders">, now: number) {
	if (
		order.fulfillmentRecoveryStatus === "refund_pending"
		|| order.automatedRefundStatus === "pending"
		|| order.automatedRefundStatus === "requires_action"
		|| order.automatedRefundAttentionReason === "request_outcome_unknown"
		|| order.printFulfillmentPhase === "submitting"
		|| order.printFulfillmentResolution === "submission_uncertain"
		|| order.printFulfillmentResolution === "reconciliation_blocked"
		|| order.printFulfillmentClaim === true
			&& order.printFulfillmentResolution !== "resolved"
		|| order.lumaprintsOrderNumber !== undefined
			&& !["shipped", "delivered", "refunded"].includes(order.status)
	) return true;
	if (activeDeadlineFields.some((field) => {
		const value = order[field];
		return typeof value === "number" && value > now;
	})) return true;
	return recentActivityFields.some((field) => {
		const value = order[field];
		return typeof value === "number" && value > now - RECENT_EFFECT_WINDOW_MS;
	});
}

async function legacySourceExists(ctx: Pick<QueryCtx, "db">) {
	for (const siteUrl of LEGACY_SITE_URLS) {
		const [row] = await ctx.db
			.query("orders")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.take(1);
		if (row) return true;
	}
	return false;
}

async function tombstonesForReset(ctx: Pick<QueryCtx, "db">) {
	return await ctx.db
		.query("retiredOrderSessions")
		.withIndex("by_resetId_and_stripeSessionId", (q) => q.eq("resetId", RESET_ID))
		.take(ORDER_RESET_LIMIT + 1);
}

function bindingFromOrder(order: Doc<"orders">): RetiredBinding {
	return {
		protocolVersion: RESET_PROTOCOL_VERSION,
		siteUrl: order.siteUrl,
		routingKind: order.stripeConnectedAccountId === undefined
			? "legacy_unscoped"
			: "connected",
		stripeSessionId: order.stripeSessionId,
		stripeConnectedAccountId: order.stripeConnectedAccountId,
		retiredOrderId: order._id,
		resetId: RESET_ID,
	};
}

function bindingFromTombstone(tombstone: Doc<"retiredOrderSessions">): RetiredBinding {
	return {
		protocolVersion: tombstone.protocolVersion,
		siteUrl: tombstone.siteUrl,
		routingKind: tombstone.routingKind,
		stripeSessionId: tombstone.stripeSessionId,
		stripeConnectedAccountId: tombstone.stripeConnectedAccountId,
		retiredOrderId: tombstone.retiredOrderId,
		resetId: tombstone.resetId,
	};
}

async function manifestDigest(bindings: RetiredBinding[]) {
	const canonical = [...bindings]
		.sort((left, right) => left.stripeSessionId < right.stripeSessionId
			? -1
			: left.stripeSessionId > right.stripeSessionId ? 1 : 0)
		.map((binding) => ({
			protocolVersion: binding.protocolVersion,
			siteUrl: binding.siteUrl,
			routingKind: binding.routingKind,
			stripeSessionId: binding.stripeSessionId,
			stripeConnectedAccountId: binding.stripeConnectedAccountId ?? null,
			retiredOrderId: binding.retiredOrderId,
			resetId: binding.resetId,
		}));
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(canonical)));
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function tombstonesMatchReceipt(
	tombstones: Doc<"retiredOrderSessions">[],
	receipt: Doc<"orderResetReceipts">,
) {
	if (
		tombstones.length > ORDER_RESET_LIMIT
		|| !Number.isSafeInteger(receipt.retiredOrderCount)
		|| receipt.retiredOrderCount < 1
		|| tombstones.length !== receipt.retiredOrderCount
	) return false;
	const sessions = new Set<string>();
	for (const tombstone of tombstones) {
		if (
			tombstone.protocolVersion !== RESET_PROTOCOL_VERSION
			|| tombstone.resetId !== RESET_ID
			|| tombstone.siteUrl !== SITE_URL
			|| (tombstone.routingKind === "connected")
				!== (tombstone.stripeConnectedAccountId !== undefined)
			|| sessions.has(tombstone.stripeSessionId)
		) return false;
		sessions.add(tombstone.stripeSessionId);
	}
	return await manifestDigest(tombstones.map(bindingFromTombstone)) === receipt.manifestDigest;
}

async function tombstonesAreGloballyExclusive(
	ctx: Pick<QueryCtx, "db">,
	tombstones: Doc<"retiredOrderSessions">[],
) {
	for (const tombstone of tombstones) {
		const [orders, matchingTombstones] = await Promise.all([
			ctx.db
				.query("orders")
				.withIndex("by_stripeSessionId", (q) =>
					q.eq("stripeSessionId", tombstone.stripeSessionId),
				)
				.take(1),
			ctx.db
				.query("retiredOrderSessions")
				.withIndex("by_stripeSessionId", (q) =>
					q.eq("stripeSessionId", tombstone.stripeSessionId),
				)
				.take(2),
		]);
		if (
			orders.length !== 0
			|| matchingTombstones.length !== 1
			|| matchingTombstones[0]._id !== tombstone._id
		) return false;
	}
	return true;
}

/** Atomically retain checkout replay tombstones and remove the approved tenant's old orders. */
export const apply = internalMutation({
	args: {},
	returns: resetResultValidator,
	handler: async (ctx) => {
		assertOrderProducersExactlyClosed();
		if (await legacySourceExists(ctx)) return { outcome: "conflict" as const };

		const orders = await ctx.db
			.query("orders")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", SITE_URL))
			.order("desc")
			.take(ORDER_RESET_LIMIT + 1);
		if (orders.length > ORDER_RESET_LIMIT) return { outcome: "source_overflow" as const };

		const receipts = await ctx.db
			.query("orderResetReceipts")
			.withIndex("by_resetId", (q) => q.eq("resetId", RESET_ID))
			.take(2);
		if (receipts.length > 1) return { outcome: "conflict" as const };
		const [receipt] = receipts;
		if (receipt) {
			const tombstones = await tombstonesForReset(ctx);
			return receipt.protocolVersion === RESET_PROTOCOL_VERSION
				&& receipt.siteUrl === SITE_URL
				&& orders.length === 0
				&& await tombstonesMatchReceipt(tombstones, receipt)
				&& await tombstonesAreGloballyExclusive(ctx, tombstones)
				? { outcome: "already_applied" as const }
				: { outcome: "conflict" as const };
		}
		if (orders.length === 0) return { outcome: "source_empty" as const };
		if ((await tombstonesForReset(ctx)).length !== 0) return { outcome: "conflict" as const };

		const sessionIds = new Set(orders.map((order) => order.stripeSessionId));
		if (sessionIds.size !== orders.length) return { outcome: "conflict" as const };

		const now = Date.now();
		if (orders.some((order) => hasLiveEffect(order, now))) {
			return { outcome: "live_effect" as const };
		}

		for (const order of orders) {
			const [globalMatches, existingTombstones, reservations] = await Promise.all([
				ctx.db
					.query("orders")
					.withIndex("by_stripeSessionId", (q) =>
						q.eq("stripeSessionId", order.stripeSessionId),
					)
					.take(2),
				ctx.db
					.query("retiredOrderSessions")
					.withIndex("by_stripeSessionId", (q) =>
						q.eq("stripeSessionId", order.stripeSessionId),
					)
					.take(2),
				ctx.db
					.query("checkoutSnapshotReservations")
					.withIndex("by_stripeSessionId", (q) =>
						q.eq("stripeSessionId", order.stripeSessionId),
					)
					.take(ORDER_RESET_LIMIT + 1),
			]);
			if (
				globalMatches.length !== 1
				|| globalMatches[0]._id !== order._id
				|| existingTombstones.length !== 0
				|| reservations.length > ORDER_RESET_LIMIT
				|| reservations.some((reservation) => reservation.state === "bound")
			) return { outcome: "conflict" as const };
		}

		const bindings = orders.map(bindingFromOrder);
		const digest = await manifestDigest(bindings);
		for (const binding of bindings) {
			await ctx.db.insert("retiredOrderSessions", {
				...binding,
				retiredAt: now,
			});
			await ctx.db.delete(binding.retiredOrderId);
		}
		await ctx.db.insert("orderResetReceipts", {
			protocolVersion: RESET_PROTOCOL_VERSION,
			resetId: RESET_ID,
			siteUrl: SITE_URL,
			retiredOrderCount: orders.length,
			manifestDigest: digest,
			completedAt: now,
		});
		return { outcome: "applied" as const };
	},
});

/** Return only a closed class for post-reset verification. */
export const verify = internalQuery({
	args: {},
	returns: verificationResultValidator,
	handler: async (ctx) => {
		assertOrderProducersExactlyClosed();
		if (await legacySourceExists(ctx)) return { outcome: "conflict" as const };
		const orders = await ctx.db
			.query("orders")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", SITE_URL))
			.take(ORDER_RESET_LIMIT + 1);
		if (orders.length > ORDER_RESET_LIMIT) return { outcome: "source_overflow" as const };
		if (orders.length !== 0) return { outcome: "source_present" as const };
		const receipts = await ctx.db
			.query("orderResetReceipts")
			.withIndex("by_resetId", (q) => q.eq("resetId", RESET_ID))
			.take(2);
		if (receipts.length === 0) return { outcome: "missing" as const };
		if (receipts.length > 1) return { outcome: "conflict" as const };
		const [receipt] = receipts;
		const tombstones = await tombstonesForReset(ctx);
		return receipt.protocolVersion === RESET_PROTOCOL_VERSION
			&& receipt.siteUrl === SITE_URL
			&& await tombstonesMatchReceipt(tombstones, receipt)
			&& await tombstonesAreGloballyExclusive(ctx, tombstones)
			? { outcome: "complete" as const }
			: { outcome: "conflict" as const };
	},
});
