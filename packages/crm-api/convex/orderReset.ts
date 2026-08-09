import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { isStripeCheckoutSessionId } from "./helpers/checkoutSnapshot";
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

const liveEffectClassValidator = v.union(
	v.literal("refund_nonterminal"),
	v.literal("refund_outcome_unknown"),
	v.literal("print_submission_unresolved"),
	v.literal("provider_order_nonterminal"),
	v.literal("active_deadline"),
	v.literal("recent_activity"),
);

const liveEffectClassificationValidator = v.union(
	v.object({ outcome: v.literal("source_overflow") }),
	v.object({ outcome: v.literal("source_empty") }),
	v.object({ outcome: v.literal("legacy_source_conflict") }),
	v.object({ outcome: v.literal("no_live_effect") }),
	v.object({
		outcome: v.literal("live_effect"),
		classes: v.array(liveEffectClassValidator),
	}),
);

const providerInvestigationTargetValidator = v.union(
	v.object({ outcome: v.literal("ready"), externalId: v.string() }),
	v.object({ outcome: v.literal("source_conflict") }),
	v.object({ outcome: v.literal("target_conflict") }),
	v.object({ outcome: v.literal("live_effect_conflict") }),
);

const providerMultiInvestigationTargetsValidator = v.union(
	v.object({ outcome: v.literal("ready"), externalIds: v.array(v.string()) }),
	v.object({ outcome: v.literal("source_conflict") }),
	v.object({ outcome: v.literal("target_conflict") }),
	v.object({ outcome: v.literal("live_effect_conflict") }),
);

const providerMultiTargetConflictClassValidator = v.union(
	v.literal("unresolved_none"),
	v.literal("unresolved_single"),
	v.literal("fulfillment_not_lumaprints"),
	v.literal("preparation_only"),
	v.literal("provider_number_present"),
	v.literal("session_not_live"),
	v.literal("session_not_unique"),
);

const providerMultiTargetConflictClassificationValidator = v.union(
	v.object({ outcome: v.literal("source_conflict") }),
	v.object({ outcome: v.literal("live_effect_conflict") }),
	v.object({ outcome: v.literal("no_target_conflict") }),
	v.object({
		outcome: v.literal("target_conflict"),
		classes: v.array(providerMultiTargetConflictClassValidator),
	}),
);

const providerMultiLookupEligibilityClassificationValidator = v.union(
	v.object({ outcome: v.literal("source_conflict") }),
	v.object({ outcome: v.literal("live_effect_conflict") }),
	v.object({ outcome: v.literal("state_changed") }),
	v.object({ outcome: v.literal("lookup_shape_eligible") }),
	v.object({ outcome: v.literal("lookup_shape_ineligible") }),
);

const providerTargetConflictClassValidator = v.union(
	v.literal("unresolved_none"),
	v.literal("unresolved_multiple"),
	v.literal("fulfillment_not_lumaprints"),
	v.literal("preparation_only"),
	v.literal("provider_number_present"),
	v.literal("session_not_live"),
	v.literal("session_not_unique"),
);

const providerTargetConflictClassificationValidator = v.union(
	v.object({ outcome: v.literal("source_conflict") }),
	v.object({ outcome: v.literal("live_effect_conflict") }),
	v.object({ outcome: v.literal("no_target_conflict") }),
	v.object({
		outcome: v.literal("target_conflict"),
		classes: v.array(providerTargetConflictClassValidator),
	}),
);

type ProviderTargetShapeConflictClass =
	| "fulfillment_not_lumaprints"
	| "preparation_only"
	| "provider_number_present"
	| "session_not_live"
	| "session_not_unique";

type ProviderTargetConflictClass =
	| "unresolved_none"
	| "unresolved_multiple"
	| ProviderTargetShapeConflictClass;

type ProviderInvestigationAssessment =
	| { outcome: "source_conflict" | "live_effect_conflict" }
	| { outcome: "target_conflict"; classes: ProviderTargetConflictClass[] }
	| { outcome: "ready"; externalId: string };

type ProviderInvestigationSource =
	| { outcome: "source_conflict" | "live_effect_conflict" }
	| { outcome: "ready"; orders: Doc<"orders">[] };

type ProviderMultiTargetConflictClass =
	| "unresolved_none"
	| "unresolved_single"
	| ProviderTargetShapeConflictClass;

type ProviderMultiInvestigationAssessment =
	| { outcome: "source_conflict" | "live_effect_conflict" }
	| { outcome: "target_conflict"; classes: ProviderMultiTargetConflictClass[] }
	| { outcome: "ready"; externalIds: string[] };

type ProviderMultiLookupEligibleAssessment =
	| { outcome: "target_conflict" }
	| { outcome: "ready"; externalIds: string[] };

const providerMultiTargetConflictClassOrder = [
	"unresolved_none",
	"unresolved_single",
	"fulfillment_not_lumaprints",
	"preparation_only",
	"provider_number_present",
	"session_not_live",
	"session_not_unique",
] as const satisfies readonly ProviderMultiTargetConflictClass[];

const expectedProviderMultiTargetConflictClasses = [
	"fulfillment_not_lumaprints",
	"session_not_live",
] as const satisfies readonly ProviderMultiTargetConflictClass[];

type LiveEffectClass =
	| "refund_nonterminal"
	| "refund_outcome_unknown"
	| "print_submission_unresolved"
	| "provider_order_nonterminal"
	| "active_deadline"
	| "recent_activity";

const liveEffectClassOrder = [
	"refund_nonterminal",
	"refund_outcome_unknown",
	"print_submission_unresolved",
	"provider_order_nonterminal",
	"active_deadline",
	"recent_activity",
] as const satisfies readonly LiveEffectClass[];

type RetiredBinding = {
	protocolVersion: 1;
	siteUrl: string;
	routingKind: "connected" | "legacy_unscoped";
	stripeSessionId: string;
	stripeConnectedAccountId?: string;
	retiredOrderId: Id<"orders">;
	resetId: string;
};

function hasUnresolvedPrintSubmission(order: Doc<"orders">) {
	return order.printFulfillmentPhase === "submitting"
		|| order.printFulfillmentResolution === "submission_uncertain"
		|| order.printFulfillmentResolution === "reconciliation_blocked"
		|| order.printFulfillmentClaim === true
			&& order.printFulfillmentResolution !== "resolved";
}

function liveEffectClasses(order: Doc<"orders">, now: number) {
	const classes: LiveEffectClass[] = [];
	if (
		order.fulfillmentRecoveryStatus === "refund_pending"
		|| order.automatedRefundStatus === "pending"
		|| order.automatedRefundStatus === "requires_action"
	) classes.push("refund_nonterminal");
	if (order.automatedRefundAttentionReason === "request_outcome_unknown") {
		classes.push("refund_outcome_unknown");
	}
	if (hasUnresolvedPrintSubmission(order)) classes.push("print_submission_unresolved");
	if (
		order.lumaprintsOrderNumber !== undefined
		&& !["shipped", "delivered", "refunded"].includes(order.status)
	) classes.push("provider_order_nonterminal");
	if (activeDeadlineFields.some((field) => {
		const value = order[field];
		return typeof value === "number" && value > now;
	})) classes.push("active_deadline");
	if (recentActivityFields.some((field) => {
		const value = order[field];
		return typeof value === "number" && value > now - RECENT_EFFECT_WINDOW_MS;
	})) classes.push("recent_activity");
	return classes;
}

function hasLiveEffect(order: Doc<"orders">, now: number) {
	return liveEffectClasses(order, now).length !== 0;
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

async function providerInvestigationSource(
	ctx: Pick<QueryCtx, "db">,
): Promise<ProviderInvestigationSource> {
	if (await legacySourceExists(ctx)) return { outcome: "source_conflict" };
	const [orders, receipts, tombstones] = await Promise.all([
		ctx.db
			.query("orders")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", SITE_URL))
			.order("desc")
			.take(ORDER_RESET_LIMIT + 1),
		ctx.db
			.query("orderResetReceipts")
			.withIndex("by_resetId", (q) => q.eq("resetId", RESET_ID))
			.take(1),
		tombstonesForReset(ctx),
	]);
	if (
		orders.length === 0
		|| orders.length > ORDER_RESET_LIMIT
		|| receipts.length !== 0
		|| tombstones.length !== 0
	) return { outcome: "source_conflict" };

	const now = Date.now();
	if (orders.some((order) =>
		liveEffectClasses(order, now).some(
			(classification) => classification !== "print_submission_unresolved",
		)
	)) return { outcome: "live_effect_conflict" };
	return { outcome: "ready", orders };
}

async function providerTargetConflictClasses(
	ctx: Pick<QueryCtx, "db">,
	target: Doc<"orders">,
): Promise<ProviderTargetShapeConflictClass[]> {
	const classes: ProviderTargetShapeConflictClass[] = [];
	if (target.fulfillmentType !== "lumaprints") classes.push("fulfillment_not_lumaprints");
	if (target.printFulfillmentPhase === "preparing") classes.push("preparation_only");
	if (target.lumaprintsOrderNumber !== undefined) classes.push("provider_number_present");
	if (!/^cs_live_[A-Za-z0-9]{16,120}$/.test(target.stripeSessionId)) {
		classes.push("session_not_live");
	}
	if (!(await providerTargetSessionIsGloballyUnique(ctx, target))) {
		classes.push("session_not_unique");
	}
	return classes;
}

async function providerTargetSessionIsGloballyUnique(
	ctx: Pick<QueryCtx, "db">,
	target: Doc<"orders">,
) {
	const globalMatches = await ctx.db
		.query("orders")
		.withIndex("by_stripeSessionId", (q) => q.eq("stripeSessionId", target.stripeSessionId))
		.take(2);
	return globalMatches.length === 1 && globalMatches[0]._id === target._id;
}

async function providerInvestigationAssessment(
	ctx: Pick<QueryCtx, "db">,
): Promise<ProviderInvestigationAssessment> {
	const source = await providerInvestigationSource(ctx);
	if (source.outcome !== "ready") return source;

	const unresolved = source.orders.filter(hasUnresolvedPrintSubmission);
	if (unresolved.length === 0) {
		return { outcome: "target_conflict", classes: ["unresolved_none"] };
	}
	if (unresolved.length > 1) {
		return { outcome: "target_conflict", classes: ["unresolved_multiple"] };
	}
	const [target] = unresolved;
	const classes = await providerTargetConflictClasses(ctx, target);
	return classes.length === 0
		? { outcome: "ready", externalId: target.stripeSessionId }
		: { outcome: "target_conflict", classes };
}

/**
 * Select the one fixed provider-investigation identity for the trusted host.
 *
 * The Production-authorized operator process consumes the identity only in
 * memory. The one-use command emits a normalized result and never prints it.
 */
export const providerInvestigationTarget = internalQuery({
	args: {},
	returns: providerInvestigationTargetValidator,
	handler: async (ctx) => {
		assertOrderProducersExactlyClosed();
		const assessment = await providerInvestigationAssessment(ctx);
		return assessment.outcome === "target_conflict"
			? { outcome: "target_conflict" as const }
			: assessment;
	},
});

async function providerMultiInvestigationAssessmentForOrders(
	ctx: Pick<QueryCtx, "db">,
	orders: Doc<"orders">[],
): Promise<ProviderMultiInvestigationAssessment> {
	const unresolved = orders.filter(hasUnresolvedPrintSubmission);
	if (unresolved.length === 0) {
		return { outcome: "target_conflict", classes: ["unresolved_none"] };
	}
	if (unresolved.length === 1) {
		return { outcome: "target_conflict", classes: ["unresolved_single"] };
	}
	const classes = new Set<ProviderMultiTargetConflictClass>();
	for (const target of unresolved) {
		for (const classification of await providerTargetConflictClasses(ctx, target)) {
			classes.add(classification);
		}
	}
	if (classes.size !== 0) {
		return {
			outcome: "target_conflict",
			classes: providerMultiTargetConflictClassOrder.filter((classification) =>
				classes.has(classification)
			),
		};
	}
	return {
		outcome: "ready",
		externalIds: unresolved.map((target) => target.stripeSessionId).sort(),
	};
}

async function providerMultiInvestigationAssessment(
	ctx: Pick<QueryCtx, "db">,
): Promise<ProviderMultiInvestigationAssessment> {
	const source = await providerInvestigationSource(ctx);
	return source.outcome === "ready"
		? await providerMultiInvestigationAssessmentForOrders(ctx, source.orders)
		: source;
}

async function providerMultiLookupEligibleAssessmentForOrders(
	ctx: Pick<QueryCtx, "db">,
	orders: Doc<"orders">[],
): Promise<ProviderMultiLookupEligibleAssessment> {
	const unresolved = orders.filter(hasUnresolvedPrintSubmission);
	if (unresolved.length < 2 || unresolved.length > ORDER_RESET_LIMIT) {
		return { outcome: "target_conflict" };
	}
	for (const target of unresolved) {
		if (
			target.printFulfillmentPhase === "preparing"
			|| target.lumaprintsOrderNumber !== undefined
			|| !isStripeCheckoutSessionId(target.stripeSessionId)
			|| !(await providerTargetSessionIsGloballyUnique(ctx, target))
		) return { outcome: "target_conflict" };
	}
	return {
		outcome: "ready",
		externalIds: unresolved.map((target) => target.stripeSessionId).sort(),
	};
}

function hasExpectedProviderMultiTargetConflict(
	assessment: ProviderMultiInvestigationAssessment,
) {
	return assessment.outcome === "target_conflict"
		&& assessment.classes.length === expectedProviderMultiTargetConflictClasses.length
		&& expectedProviderMultiTargetConflictClasses.every(
			(classification, index) => assessment.classes[index] === classification,
		);
}

/** Select all fixed unresolved provider identities for one bounded trusted-host scan. */
export const providerMultiInvestigationTargets = internalQuery({
	args: {},
	returns: providerMultiInvestigationTargetsValidator,
	handler: async (ctx) => {
		assertOrderProducersExactlyClosed();
		const assessment = await providerMultiInvestigationAssessment(ctx);
		return assessment.outcome === "target_conflict"
			? { outcome: "target_conflict" as const }
			: assessment;
	},
});

/**
 * Freshly select all lookup-eligible unresolved identities for one bounded
 * GET-only provider observation. Stored fulfillment type is not provider
 * authority. The trusted caller must re-read and compare this exact array
 * after its scan.
 */
export const providerMultiLookupEligibleTargets = internalQuery({
	args: {},
	returns: providerMultiInvestigationTargetsValidator,
	handler: async (ctx) => {
		assertOrderProducersExactlyClosed();
		const source = await providerInvestigationSource(ctx);
		if (source.outcome !== "ready") return source;
		return await providerMultiLookupEligibleAssessmentForOrders(ctx, source.orders);
	},
});

/** Classify only normalized causes behind a stopped multi-target selection. */
export const classifyProviderMultiTargetConflict = internalQuery({
	args: {},
	returns: providerMultiTargetConflictClassificationValidator,
	handler: async (ctx) => {
		assertOrderProducersExactlyClosed();
		const assessment = await providerMultiInvestigationAssessment(ctx);
		return assessment.outcome === "ready"
			? { outcome: "no_target_conflict" as const }
			: assessment;
	},
});

/**
 * Classify only whether the exact current conflict has provider-observer-shaped
 * identities. Stored fulfillment type is deliberately not provider authority.
 * A state change is normalized category drift, not proof of row-set continuity.
 */
export const classifyProviderMultiLookupEligibility = internalQuery({
	args: {},
	returns: providerMultiLookupEligibilityClassificationValidator,
	handler: async (ctx) => {
		assertOrderProducersExactlyClosed();
		const source = await providerInvestigationSource(ctx);
		if (source.outcome !== "ready") return source;

		const assessment = await providerMultiInvestigationAssessmentForOrders(
			ctx,
			source.orders,
		);
		if (!hasExpectedProviderMultiTargetConflict(assessment)) {
			return { outcome: "state_changed" as const };
		}

		const unresolved = source.orders.filter(hasUnresolvedPrintSubmission);
		return unresolved.every((target) => isStripeCheckoutSessionId(target.stripeSessionId))
			? { outcome: "lookup_shape_eligible" as const }
			: { outcome: "lookup_shape_ineligible" as const };
	},
});

/** Classify only the normalized family behind a stopped provider target selection. */
export const classifyProviderTargetConflict = internalQuery({
	args: {},
	returns: providerTargetConflictClassificationValidator,
	handler: async (ctx) => {
		assertOrderProducersExactlyClosed();
		const assessment = await providerInvestigationAssessment(ctx);
		return assessment.outcome === "ready"
			? { outcome: "no_target_conflict" as const }
			: assessment;
	},
});

/** Return only normalized classes for the live-effect condition that stopped the reset. */
export const classifyLiveEffect = internalQuery({
	args: {},
	returns: liveEffectClassificationValidator,
	handler: async (ctx) => {
		assertOrderProducersExactlyClosed();
		if (await legacySourceExists(ctx)) {
			return { outcome: "legacy_source_conflict" as const };
		}
		const orders = await ctx.db
			.query("orders")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", SITE_URL))
			.order("desc")
			.take(ORDER_RESET_LIMIT + 1);
		if (orders.length > ORDER_RESET_LIMIT) {
			return { outcome: "source_overflow" as const };
		}
		if (orders.length === 0) return { outcome: "source_empty" as const };

		const classes = new Set<LiveEffectClass>();
		const now = Date.now();
		for (const order of orders) {
			for (const classification of liveEffectClasses(order, now)) {
				classes.add(classification);
			}
		}
		if (classes.size === 0) return { outcome: "no_live_effect" as const };
		return {
			outcome: "live_effect" as const,
			classes: liveEffectClassOrder.filter((classification) => classes.has(classification)),
		};
	},
});

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
