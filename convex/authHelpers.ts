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

/**
 * Require that the authenticated user is an admin of the given site.
 *
 * This is the tenant-authorization primitive. It prevents the class of bug
 * where a caller in tenant A (authenticated as someone else) passes
 * `siteUrl: "tenantB.com"` and gets access to tenant B's data purely because
 * `requireAuth` alone only verifies "someone is logged in."
 *
 * Returns the verified identity + the `platformClients` row for the site.
 * Throws `Not authorized` if the identity's email is not in that site's
 * `adminEmails` list.
 */
export async function requireSiteAdmin(
	ctx: MutationCtx | QueryCtx,
	siteUrl: string,
) {
	const identity = await requireAuth(ctx);
	if (!identity.email) {
		throw new Error("Not authorized (missing email in identity)");
	}
	const client = await ctx.db
		.query("platformClients")
		.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
		.first();
	if (!client) {
		throw new Error("Not authorized (site not found)");
	}
	const identityEmail = identity.email.toLowerCase();
	const isAdmin = client.adminEmails
		.map((e) => e.toLowerCase())
		.includes(identityEmail);
	if (!isAdmin) {
		throw new Error("Not authorized (not a site admin)");
	}
	return { identity, client };
}
