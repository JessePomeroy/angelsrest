import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { isSiteAdminIdentity, requireAuth } from "./authHelpers";

/**
 * Return the currently-authenticated identity for this request, or null if
 * the caller has no valid Better Auth session.
 *
 * Used by SvelteKit server-side guards (audit H3/H4) to validate a session
 * token before rendering admin-only pages. Cheaper than `checkAdminAccess`
 * when all you need is "is this token valid" without the siteUrl check.
 */
export const whoami = query({
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return null;
		return {
			email: identity.email ?? null,
			emailVerified: identity.emailVerified ?? false,
			name: identity.name ?? null,
			subject: identity.subject,
			tokenIdentifier: identity.tokenIdentifier,
		};
	},
});

/** Bind one verified invited account to stable tenant membership. */
export const claimAdminAccess = mutation({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const identity = await requireAuth(ctx);
		const client = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.unique();
		if (!client) throw new Error("Not authorized");

		const stableIds = client.adminIdentityIds ?? [];
		if (stableIds.includes(identity.tokenIdentifier)) {
			return { claimed: false, authorized: true, tier: client.tier };
		}
		if (identity.emailVerified !== true || !identity.email) {
			throw new Error("A verified account is required");
		}
		const invited = client.adminEmails.some(
			(email) => email.toLowerCase() === identity.email?.toLowerCase(),
		);
		if (!invited || stableIds.length >= 20) throw new Error("Not authorized");

		await ctx.db.patch(client._id, {
			adminIdentityIds: [...stableIds, identity.tokenIdentifier],
		});
		return { claimed: true, authorized: true, tier: client.tier };
	},
});

/**
 * Check whether the *currently authenticated* user is an admin for the given
 * site. Previously this accepted a client-supplied `email` argument which was
 * an auth bypass: any unauthenticated caller could pass the creator's email
 * and receive `authorized: true`.
 *
 * Stable claimed identity is authoritative. The `email` arg remains only for
 * backward compatibility with the shared AuthGuard and is cross-checked with
 * the authenticated identity before membership is evaluated.
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
			.unique();

		if (!client) return { authorized: false, tier: "basic" as const };

		const isAuthorized = isSiteAdminIdentity(identity, client);

		return {
			authorized: isAuthorized,
			tier: client.tier,
			siteName: client.name,
		};
	},
});
