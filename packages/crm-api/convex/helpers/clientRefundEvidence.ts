import { type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isStripeCheckoutSessionId, isStripeConnectedAccountId, stripeAccountScope } from "./checkoutSnapshot";
import { isNonnegativeSafeInteger } from "./stripeFeeCapture";
import { isTenantId } from "./tenantContext";

export const CLIENT_REFUND_OBSERVATION_LEASE_MS = 90_000;
export const clientRefundStatusValidator = v.union(v.literal("pending"), v.literal("requires_action"),
	v.literal("succeeded"), v.literal("failed"), v.literal("canceled"));
export const clientRefundObservationValidator = v.object({
	amountCents: v.number(), totalCents: v.number(), subtotalCents: v.number(),
	currency: v.literal("usd"), stripeChargeId: v.string(), status: clientRefundStatusValidator,
});
export type ClientRefundObservation = Infer<typeof clientRefundObservationValidator>;
export const clientRefundClaimArgs = {
	stripeSessionId: v.string(), stripeConnectedAccountId: v.string(), stripePaymentIntentId: v.string(),
	stripeRefundId: v.string(), stripeEventId: v.string(), claimToken: v.string(), webhookSecret: v.string(),
};
const clientRefundClaimValidator = v.object(clientRefundClaimArgs);
export type ClientRefundClaim = Infer<typeof clientRefundClaimValidator>;

function validId(value: string, prefix: string) {
	return value.startsWith(prefix) && /^[A-Za-z0-9_]{8,255}$/.test(value) && value.length > prefix.length;
}

/** Read only the original order/admission, never today's selected account. */
export async function clientRefundContext(ctx: Pick<QueryCtx, "db">, sessionId: string, accountId: string) {
	const orders = await ctx.db.query("orders").withIndex("by_stripeSessionId", q => q.eq("stripeSessionId", sessionId)).take(2);
	if (orders.length > 1) throw new Error("Ambiguous original refund context");
	const order = orders[0];
	const admission = order ? null : await ctx.db.query("checkoutSessionAdmissions")
		.withIndex("by_accountScope_and_stripeSessionId", q => q.eq("accountScope", stripeAccountScope(accountId)).eq("stripeSessionId", sessionId)).unique();
	const saved = order?.checkoutFinancialSnapshot ?? admission?.checkoutFinancialSnapshot;
	if (!saved) return null;
	const siteUrl = order?.siteUrl ?? admission?.siteUrl;
	if (!siteUrl || !isTenantId(saved.tenantId) || !isStripeConnectedAccountId(saved.stripePlatformAccountId)
		|| saved.stripeConnectedAccountId !== accountId || saved.stripePlatformAccountId === accountId
		|| saved.tenantId !== (order?.tenantId ?? admission?.tenantId)
		|| order && (order.stripeConnectedAccountId !== accountId || order.stripePaymentCurrency !== saved.currency
			|| order.stripePaymentLivemode !== saved.stripeLivemode || !isNonnegativeSafeInteger(order.total))
		|| admission && (admission.boundAt === undefined || admission.stripeConnectedAccountId !== accountId)) {
		throw new Error("Invalid original refund context");
	}
	return { tenantId: saved.tenantId, siteUrl, stripePlatformAccountId: saved.stripePlatformAccountId,
		stripeConnectedAccountId: saved.stripeConnectedAccountId, stripeLivemode: saved.stripeLivemode,
		currency: saved.currency, subtotalCents: saved.subtotalCents,
		...(order ? { totalCents: order.total, stripePaymentIntentId: order.stripePaymentIntentId } : {}) };
}

export async function beginClientRefundObservation(ctx: MutationCtx, args: ClientRefundClaim) {
	if (!isStripeCheckoutSessionId(args.stripeSessionId) || !isStripeConnectedAccountId(args.stripeConnectedAccountId)
		|| !validId(args.stripePaymentIntentId, "pi_") || !validId(args.stripeRefundId, "re_")
		|| !validId(args.stripeEventId, "evt_") || !/^[0-9a-f-]{36}$/.test(args.claimToken)) {
		throw new Error("Invalid client refund observation claim");
	}
	const context = await clientRefundContext(ctx, args.stripeSessionId, args.stripeConnectedAccountId);
	if (!context) return { kind: "legacy" as const };
	if (context.stripePaymentIntentId !== undefined && context.stripePaymentIntentId !== args.stripePaymentIntentId) {
		throw new Error("Original refund payment identity mismatch");
	}
	let row = await ctx.db.query("clientRefundEvidence")
		.withIndex("by_stripeConnectedAccountId_and_stripeRefundId", q => q
			.eq("stripeConnectedAccountId", args.stripeConnectedAccountId).eq("stripeRefundId", args.stripeRefundId)).unique();
	if (row && (row.stripeSessionId !== args.stripeSessionId || row.stripePaymentIntentId !== args.stripePaymentIntentId
		|| row.tenantId !== context.tenantId || row.stripePlatformAccountId !== context.stripePlatformAccountId
		|| row.stripeLivemode !== context.stripeLivemode)) throw new Error("Refund identity cannot change");
	if (row?.claimToken && row.leaseUntil !== undefined && row.leaseUntil > Date.now()) return { kind: "busy" as const };
	if (!row) {
		const id = await ctx.db.insert("clientRefundEvidence", {
			stripeSessionId: args.stripeSessionId, stripeConnectedAccountId: args.stripeConnectedAccountId,
			stripeRefundId: args.stripeRefundId, stripePaymentIntentId: args.stripePaymentIntentId,
			tenantId: context.tenantId, stripePlatformAccountId: context.stripePlatformAccountId,
			stripeLivemode: context.stripeLivemode, state: "checking",
		});
		row = await ctx.db.get(id);
	}
	if (!row) throw new Error("Refund observation is unavailable");
	await ctx.db.patch(row._id, { state: "checking", claimToken: args.claimToken,
		leaseUntil: Date.now() + CLIENT_REFUND_OBSERVATION_LEASE_MS, checkingEventId: args.stripeEventId, issue: undefined });
	await ctx.scheduler.runAfter(CLIENT_REFUND_OBSERVATION_LEASE_MS,
		internal.orders.expireClientRefundObservation, { evidenceId: row._id, claimToken: args.claimToken });
	return { kind: "claimed" as const, evidenceId: row._id, context };
}

export async function finishClientRefundObservation(ctx: MutationCtx, args: {
	evidenceId: Id<"clientRefundEvidence">;
	claimToken: string; observation: ClientRefundObservation;
}) {
	const row = await ctx.db.get(args.evidenceId);
	if (!row || row.claimToken !== args.claimToken || row.leaseUntil === undefined || row.leaseUntil <= Date.now()) return false;
	const context = await clientRefundContext(ctx, row.stripeSessionId, row.stripeConnectedAccountId);
	const observed = args.observation;
	if (!context || context.tenantId !== row.tenantId || context.stripePlatformAccountId !== row.stripePlatformAccountId
		|| context.stripeLivemode !== row.stripeLivemode || context.currency !== observed.currency
		|| context.subtotalCents !== observed.subtotalCents
		|| context.totalCents !== undefined && context.totalCents !== observed.totalCents
		|| context.stripePaymentIntentId !== undefined && context.stripePaymentIntentId !== row.stripePaymentIntentId
		|| !isNonnegativeSafeInteger(observed.amountCents) || observed.amountCents < 1
		|| !isNonnegativeSafeInteger(observed.totalCents) || observed.amountCents > observed.totalCents
		|| !validId(observed.stripeChargeId, "ch_")
		|| row.observation && (row.observation.amountCents !== observed.amountCents
			|| row.observation.totalCents !== observed.totalCents || row.observation.stripeChargeId !== observed.stripeChargeId)) {
		throw new Error("Verified refund evidence conflicts with original identity");
	}
	await ctx.db.patch(row._id, { state: "observed", observation: observed, observedAt: Date.now(),
		lastEventId: row.checkingEventId, checkingEventId: undefined, claimToken: undefined, leaseUntil: undefined, issue: undefined });
	return true;
}
