import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isStripeCheckoutSessionId, stripeAccountScope } from "./checkoutSnapshot";
import { stripeAccountMatchesSite } from "./stripeAccountOwnership";
import { tenantIdentityMatchesSite } from "./tenantContext";

// Callers authenticate the webhook before using these transaction-local readers.
// Keep the V2 routing result separate from the additive admission fallback.
type CheckoutRoutingFacts = {
	stripeSessionId: string;
	stripeConnectedAccountId?: string;
	stripeTenantMetadataSiteUrl?: string;
	stripeTenantMetadataTenantId?: string;
};

export async function connectedAccountMatchesSite(
	ctx: QueryCtx,
	siteUrl: string,
	account: string | undefined,
) {
	return account === undefined || await stripeAccountMatchesSite(ctx, siteUrl, account);
}

export function routingConflict(): never {
	throw new Error("Checkout routing facts conflict");
}

export async function assertTenantRouting(
	ctx: Pick<QueryCtx, "db">,
	tenantId: string | undefined,
	siteUrl: string,
	storedTenantId?: string,
) {
	if (
		tenantId !== undefined
		&& (storedTenantId !== undefined && storedTenantId !== tenantId
			|| !await tenantIdentityMatchesSite(ctx, tenantId, siteUrl))
	) routingConflict();
}

export async function adoptOrderTenant(
	ctx: MutationCtx,
	order: Doc<"orders">,
	tenantId: string | undefined,
) {
	await assertTenantRouting(ctx, tenantId, order.siteUrl, order.tenantId);
	if (tenantId !== undefined && order.tenantId === undefined) {
		await ctx.db.patch(order._id, { tenantId });
	}
}

export async function assertOrderTenant(
	ctx: Pick<QueryCtx, "db">,
	order: Doc<"orders">,
	tenantId: string | undefined,
) {
	await assertTenantRouting(ctx, tenantId, order.siteUrl, order.tenantId);
}

export async function retiredOrderSession(
	ctx: Pick<QueryCtx, "db">,
	stripeSessionId: string,
) {
	return await ctx.db
		.query("retiredOrderSessions")
		.withIndex("by_stripeSessionId", (q) => q.eq("stripeSessionId", stripeSessionId))
		.unique();
}

export async function readCheckoutRouting(ctx: QueryCtx, args: CheckoutRoutingFacts) {
	const order = await ctx.db.query("orders")
		.withIndex("by_stripeSessionId", (q) => q.eq("stripeSessionId", args.stripeSessionId)).unique();
	const retired = await retiredOrderSession(ctx, args.stripeSessionId);
	if (retired && order) routingConflict();
	if (retired) {
		await assertTenantRouting(
			ctx, args.stripeTenantMetadataTenantId, retired.siteUrl,
		);
		if (retired.routingKind === "connected") {
			if (
				retired.stripeConnectedAccountId === undefined
				|| args.stripeConnectedAccountId !== retired.stripeConnectedAccountId
			) routingConflict();
		} else if (
			retired.stripeConnectedAccountId !== undefined
			|| args.stripeConnectedAccountId !== undefined
				&& !await connectedAccountMatchesSite(
					ctx, retired.siteUrl, args.stripeConnectedAccountId,
				)
		) routingConflict();
		if (
			args.stripeTenantMetadataSiteUrl !== undefined
			&& args.stripeTenantMetadataSiteUrl !== retired.siteUrl
		) routingConflict();
		return { source: "retired" as const, siteUrl: retired.siteUrl,
			stripeConnectedAccountId: retired.stripeConnectedAccountId };
	}
	if (order) {
		await assertTenantRouting(
			ctx, args.stripeTenantMetadataTenantId, order.siteUrl, order.tenantId,
		);
		if (order.stripeConnectedAccountId !== undefined) {
			if (
				args.stripeConnectedAccountId !== order.stripeConnectedAccountId
				|| !await connectedAccountMatchesSite(
					ctx, order.siteUrl, order.stripeConnectedAccountId,
				)
			) routingConflict();
		} else if (
			args.stripeConnectedAccountId !== undefined
			&& !await connectedAccountMatchesSite(
				ctx, order.siteUrl, args.stripeConnectedAccountId,
			)
		) {
			// Explicit legacy fallback: old connected-account orders may not
			// carry the stored account, but the signed event account must still
			// resolve canonically to the order tenant.
			routingConflict();
		}
		if (
			args.stripeTenantMetadataSiteUrl !== undefined
			&& args.stripeTenantMetadataSiteUrl !== order.siteUrl
		) routingConflict();
		return { source: "order" as const, siteUrl: order.siteUrl,
			stripeConnectedAccountId: order.stripeConnectedAccountId };
	}
	const reservation = await ctx.db.query("checkoutSnapshotReservations")
		.withIndex("by_accountScope_and_stripeSessionId", (q) => q
			.eq("accountScope", stripeAccountScope(args.stripeConnectedAccountId))
			.eq("stripeSessionId", args.stripeSessionId)).unique();
	if (!reservation || reservation.state !== "bound") return null;
	await assertTenantRouting(
		ctx, args.stripeTenantMetadataTenantId, reservation.siteUrl, reservation.tenantId,
	);
	if (args.stripeConnectedAccountId !== undefined) {
		if (
			reservation.stripeConnectedAccountId !== args.stripeConnectedAccountId
			|| !await connectedAccountMatchesSite(
				ctx, reservation.siteUrl, args.stripeConnectedAccountId,
			)
		) routingConflict();
	} else if (args.stripeTenantMetadataSiteUrl !== reservation.siteUrl) {
		// Platform-account sessions are tenant-routable only through the
		// marker stamped by the trusted Checkout creation response path.
		routingConflict();
	}
	if (
		args.stripeTenantMetadataSiteUrl !== undefined
		&& args.stripeTenantMetadataSiteUrl !== reservation.siteUrl
	) routingConflict();
	return { source: "reservation" as const, siteUrl: reservation.siteUrl,
		stripeConnectedAccountId: reservation.stripeConnectedAccountId };
}

export async function readCheckoutAdmissionRouting(ctx: QueryCtx, args: CheckoutRoutingFacts) {
	if (!isStripeCheckoutSessionId(args.stripeSessionId)) return null;
	const [order, retired, admission] = await Promise.all([
		ctx.db.query("orders")
			.withIndex("by_stripeSessionId", (q) => q.eq("stripeSessionId", args.stripeSessionId))
			.unique(),
		retiredOrderSession(ctx, args.stripeSessionId),
		ctx.db.query("checkoutSessionAdmissions")
			.withIndex("by_accountScope_and_stripeSessionId", (q) => q
				.eq("accountScope", stripeAccountScope(args.stripeConnectedAccountId))
				.eq("stripeSessionId", args.stripeSessionId))
			.unique(),
	]);
	if (order || retired || !admission || admission.state !== "bound") return null;
	await assertTenantRouting(
		ctx, args.stripeTenantMetadataTenantId, admission.siteUrl, admission.tenantId,
	);
	if (
		admission.stripeConnectedAccountId !== args.stripeConnectedAccountId
		|| args.stripeTenantMetadataSiteUrl !== undefined
			&& args.stripeTenantMetadataSiteUrl !== admission.siteUrl
	) routingConflict();
	if (
		args.stripeConnectedAccountId !== undefined
		&& !await connectedAccountMatchesSite(
			ctx,
			admission.siteUrl,
			args.stripeConnectedAccountId,
		)
	) routingConflict();
	return {
		source: "admission" as const,
		siteUrl: admission.siteUrl,
		stripeConnectedAccountId: admission.stripeConnectedAccountId,
	};
}
