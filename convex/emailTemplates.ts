import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		return await ctx.db
			.query("emailTemplates")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.collect();
	},
});

export const get = query({
	args: { templateId: v.id("emailTemplates") },
	handler: async (ctx, { templateId }) => {
		return await ctx.db.get(templateId);
	},
});

export const getByCategory = query({
	args: {
		siteUrl: v.string(),
		category: v.string(),
	},
	handler: async (ctx, { siteUrl, category }) => {
		return await ctx.db
			.query("emailTemplates")
			.withIndex("by_siteUrl_category", (q) =>
				q.eq("siteUrl", siteUrl).eq("category", category as any),
			)
			.take(1)
			.then((results) => results[0] ?? null);
	},
});

export const create = mutation({
	args: {
		siteUrl: v.string(),
		name: v.string(),
		category: v.union(
			v.literal("inquiry-reply"),
			v.literal("booking-confirmation"),
			v.literal("reminder"),
			v.literal("gallery-delivery"),
			v.literal("follow-up"),
			v.literal("thank-you"),
			v.literal("custom"),
		),
		subject: v.string(),
		body: v.string(),
		variables: v.optional(v.array(v.string())),
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert("emailTemplates", args);
	},
});

export const update = mutation({
	args: {
		templateId: v.id("emailTemplates"),
		siteUrl: v.string(),
		name: v.optional(v.string()),
		category: v.optional(v.string()),
		subject: v.optional(v.string()),
		body: v.optional(v.string()),
		variables: v.optional(v.array(v.string())),
	},
	handler: async (ctx, { templateId, siteUrl, ...updates }) => {
		const doc = await ctx.db.get(templateId);
		if (!doc || doc.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		const patch: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(updates)) {
			if (val !== undefined) patch[key] = val;
		}
		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(templateId, patch);
		}
	},
});

export const remove = mutation({
	args: { templateId: v.id("emailTemplates"), siteUrl: v.string() },
	handler: async (ctx, { templateId, siteUrl }) => {
		const doc = await ctx.db.get(templateId);
		if (!doc || doc.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		await ctx.db.delete(templateId);
	},
});
