import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Require an authenticated user identity. Throws if not authenticated.
 * Use in all admin-only mutations and sensitive queries.
 */
export async function requireAuth(ctx: MutationCtx | QueryCtx) {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		throw new Error("Not authenticated");
	}
	return identity;
}
