import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
	args: {
		siteUrl: v.string(),
		type: v.optional(v.string()),
	},
	handler: async (ctx, { siteUrl, type }) => {
		if (type) {
			return await ctx.db
				.query("emailLog")
				.withIndex("by_siteUrl_and_type", (q) =>
					q.eq("siteUrl", siteUrl).eq("type", type as any),
				)
				.order("desc")
				.take(100);
		}
		return await ctx.db
			.query("emailLog")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(100);
	},
});

export const create = mutation({
	args: {
		siteUrl: v.string(),
		to: v.string(),
		subject: v.string(),
		type: v.union(
			v.literal("invoice"),
			v.literal("quote"),
			v.literal("contract"),
			v.literal("reminder"),
			v.literal("custom"),
		),
		relatedId: v.optional(v.string()),
		status: v.union(v.literal("sent"), v.literal("failed")),
		error: v.optional(v.string()),
		resendId: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert("emailLog", args);
	},
});
