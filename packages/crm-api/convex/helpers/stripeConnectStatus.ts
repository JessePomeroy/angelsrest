import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { resolveStripeAccountOwner } from "./stripeAccountOwnership";

export const STRIPE_STATUS_REFRESH_MAX_AGE_MS = 60_000;

export const stripeConnectReadinessValidator = v.object({
	status: v.union(v.literal("setup_required"), v.literal("pending_verification"), v.literal("restricted"), v.literal("ready")),
	chargesEnabled: v.boolean(),
	payoutsEnabled: v.boolean(),
	detailsSubmitted: v.boolean(),
});

export const stripeConnectStatusResultValidator = v.union(
	v.object({ kind: v.literal("observed"), readiness: stripeConnectReadinessValidator }),
	v.object({ kind: v.literal("unavailable"), reason: v.union(v.literal("provider_unavailable"), v.literal("account_mismatch")) }),
);

export const stripeConnectStatusValidator = v.object({
	accountId: v.string(),
	state: v.union(
		v.object({ kind: v.literal("checking"), refreshToken: v.string(), startedAt: v.number() }),
		v.object({ kind: v.literal("observed"), readiness: stripeConnectReadinessValidator, checkedAt: v.number() }),
		v.object({ kind: v.literal("unavailable"), reason: v.union(v.literal("provider_unavailable"), v.literal("account_mismatch")), checkedAt: v.number() }),
		v.object({ kind: v.literal("disconnected"), eventId: v.string(), disconnectedAt: v.number() }),
	),
});

export const stripeConnectStatusTargetArgs = {
	clientId: v.id("platformClients"),
	accountId: v.string(),
	platformAccountId: v.string(),
	livemode: v.boolean(),
	webhookSecret: v.string(),
};

/** Status is only authority for the currently selected, verified connection. */
export async function requireCurrentStripeConnectBinding(ctx: QueryCtx, args: {
	clientId: Id<"platformClients">;
	accountId: string;
	platformAccountId: string;
	livemode: boolean;
}) {
	const owner = await resolveStripeAccountOwner(ctx, args.accountId);
	const binding = await ctx.db.query("stripeAccountBindings")
		.withIndex("by_stripeConnectedAccountId", q => q.eq("stripeConnectedAccountId", args.accountId))
		.unique();
	const attempt = owner?.stripeConnectAttempt;
	if (!owner || !binding || !attempt
		|| owner._id !== args.clientId || binding.clientId !== owner._id
		|| owner.stripeConnectedAccountId !== args.accountId
		|| owner.tenantId !== binding.tenantId
		|| attempt.id !== binding.attemptId || attempt.model !== "full-v1"
		|| attempt.platformAccountId !== args.platformAccountId || binding.platformAccountId !== args.platformAccountId
		|| attempt.livemode !== args.livemode || binding.livemode !== args.livemode
		|| (owner.stripeConnectStatus && owner.stripeConnectStatus.accountId !== args.accountId)) {
		throw new Error("Stripe status requires the current verified account binding and environment");
	}
	return owner;
}
