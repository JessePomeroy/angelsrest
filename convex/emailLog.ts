import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./authHelpers";

const emailTypeValidator = v.union(
	v.literal("invoice"),
	v.literal("quote"),
	v.literal("contract"),
	v.literal("reminder"),
	v.literal("custom"),
);

export const list = query({
	args: {
		siteUrl: v.string(),
		type: v.optional(emailTypeValidator),
	},
	handler: async (ctx, { siteUrl, type }) => {
		await requireAuth(ctx);
		if (type) {
			return await ctx.db
				.query("emailLog")
				.withIndex("by_siteUrl_and_type", (q) =>
					q.eq("siteUrl", siteUrl).eq("type", type),
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
		type: emailTypeValidator,
		relatedId: v.optional(v.string()),
		status: v.union(v.literal("sent"), v.literal("failed")),
		error: v.optional(v.string()),
		resendId: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		// Gated: email logging happens as a side effect of admin actions.
		// Previously this was public, which let any caller pollute the log.
		// Audit C6.
		await requireAuth(ctx);
		return await ctx.db.insert("emailLog", args);
	},
});
