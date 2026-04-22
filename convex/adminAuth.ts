import { v } from "convex/values";
import { query } from "./_generated/server";

/**
 * Check whether the *currently authenticated* user is an admin for the given
 * site. Previously this accepted a client-supplied `email` argument which was
 * an auth bypass: any unauthenticated caller could pass the creator's email
 * and receive `authorized: true`.
 *
 * We now derive the email from `ctx.auth.getUserIdentity()` server-side and
 * ignore the `email` arg for authorization purposes (it's accepted only for
 * backward compatibility with the @jessepomeroy/admin AuthGuard component —
 * which already passes the logged-in user's email — and is cross-checked
 * against identity as a consistency guard).
 */
export const checkAdminAccess = query({
	args: { email: v.string(), siteUrl: v.string() },
	handler: async (ctx, { email, siteUrl }) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity?.email) {
			return { authorized: false, tier: "basic" as const };
		}

		// Defense-in-depth: the client-supplied email should match the
		// authenticated identity. If it doesn't, someone is lying — refuse.
		if (identity.email.toLowerCase() !== email.toLowerCase()) {
			return { authorized: false, tier: "basic" as const };
		}

		const client = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.first();

		if (!client) return { authorized: false, tier: "basic" as const };

		const isAuthorized = client.adminEmails
			.map((e) => e.toLowerCase())
			.includes(identity.email.toLowerCase());

		return {
			authorized: isAuthorized,
			tier: client.tier,
			siteName: client.name,
		};
	},
});
