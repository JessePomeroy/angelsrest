import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
	args: {
		siteUrl: v.string(),
		name: v.string(),
		email: v.string(),
		phone: v.optional(v.string()),
		subject: v.optional(v.string()),
		message: v.string(),
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert("inquiries", {
			...args,
			status: "new",
		});
	},
});

export const list = query({
	args: {
		siteUrl: v.string(),
		status: v.optional(v.string()),
	},
	handler: async (ctx, { siteUrl, status }) => {
		if (status) {
			return await ctx.db
				.query("inquiries")
				.withIndex("by_siteUrl_status", (q) =>
					q
						.eq("siteUrl", siteUrl)
						.eq("status", status as "new" | "read" | "replied"),
				)
				.order("desc")
				.collect();
		}
		return await ctx.db
			.query("inquiries")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.collect();
	},
});

export const countNew = query({
	args: {
		siteUrl: v.string(),
	},
	handler: async (ctx, { siteUrl }) => {
		const newInquiries = await ctx.db
			.query("inquiries")
			.withIndex("by_siteUrl_status", (q) =>
				q.eq("siteUrl", siteUrl).eq("status", "new"),
			)
			.collect();
		return newInquiries.length;
	},
});
