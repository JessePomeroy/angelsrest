import type { QueryCtx } from "../_generated/server";
import { resolveTenantContext } from "./tenantContext";

/** Resolve historical ownership without treating it as permission for new sales. */
export async function resolveStripeAccountOwner(ctx: QueryCtx, account: string) {
	const current = await ctx.db
		.query("platformClients")
		.withIndex("by_stripeConnectedAccountId", (q) => q.eq("stripeConnectedAccountId", account))
		.take(2);
	const bindings = await ctx.db
		.query("stripeAccountBindings")
		.withIndex("by_stripeConnectedAccountId", (q) => q.eq("stripeConnectedAccountId", account))
		.take(2);
	// Ambiguous or conflicting ownership is not a routing hint.
	if (current.length > 1 || bindings.length > 1) return null;
	const binding = bindings[0];
	if (!binding) return current[0] ?? null;
	const owner = await ctx.db.get(binding.clientId);
	if (!owner || owner.tenantId !== binding.tenantId || (current[0] && current[0]._id !== owner._id))
		return null;
	return owner;
}

/** Admission of a new checkout requires the currently selected account. */
export async function isCurrentStripeAccountForSite(
	ctx: QueryCtx,
	siteUrl: string,
	account: string | undefined,
) {
	if (account === undefined) return true;
	const owner = await accountOwnerAtSite(ctx, siteUrl, account);
	return owner?.stripeConnectedAccountId === account;
}

/** Verified aliases retain ownership without selecting a different payment account. */
export async function stripeAccountMatchesSite(ctx: QueryCtx, siteUrl: string, account: string) {
	return await accountOwnerAtSite(ctx, siteUrl, account) !== null;
}

async function accountOwnerAtSite(ctx: QueryCtx, siteUrl: string, account: string) {
	const [owner, tenant] = await Promise.all([
		resolveStripeAccountOwner(ctx, account), resolveTenantContext(ctx, { siteUrl }),
	]);
	return owner && tenant?.client._id === owner._id ? owner : null;
}
