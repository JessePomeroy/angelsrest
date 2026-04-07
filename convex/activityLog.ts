import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

export const getClientActivity = query({
	args: {
		clientId: v.id("photographyClients"),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, { clientId, limit }) => {
		const take = limit ?? 20;
		return await ctx.db
			.query("activityLog")
			.withIndex("by_clientId", (q) => q.eq("clientId", clientId))
			.order("desc")
			.take(take);
	},
});

export const logActivity = internalMutation({
	args: {
		siteUrl: v.string(),
		clientId: v.id("photographyClients"),
		action: v.string(),
		description: v.string(),
		metadata: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert("activityLog", args);
	},
});
