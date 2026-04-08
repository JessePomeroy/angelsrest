import { v } from "convex/values";
import { query } from "./_generated/server";

export const checkAdminAccess = query({
	args: { email: v.string(), siteUrl: v.string() },
	handler: async (ctx, { email, siteUrl }) => {
		const client = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.first();

		if (!client) return { authorized: false, tier: "basic" as const };

		const isAuthorized = client.adminEmails
			.map((e) => e.toLowerCase())
			.includes(email.toLowerCase());

		return {
			authorized: isAuthorized,
			tier: client.tier,
			siteName: client.name,
		};
	},
});
