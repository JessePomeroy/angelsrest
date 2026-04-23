import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./authHelpers";
import { deleteDocument } from "./helpers/deleting";
import { BULK_SCAN_LIMIT } from "./helpers/limits";
import { patchDocument } from "./helpers/patching";

const categoryValidator = v.union(
	v.literal("inquiry-reply"),
	v.literal("booking-confirmation"),
	v.literal("reminder"),
	v.literal("gallery-delivery"),
	v.literal("follow-up"),
	v.literal("thank-you"),
	v.literal("custom"),
);

export const list = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireAuth(ctx);
		return await ctx.db
			.query("emailTemplates")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.take(BULK_SCAN_LIMIT);
	},
});

export const get = query({
	args: { templateId: v.id("emailTemplates") },
	handler: async (ctx, { templateId }) => {
		await requireAuth(ctx);
		return await ctx.db.get(templateId);
	},
});

export const getByCategory = query({
	args: {
		siteUrl: v.string(),
		category: categoryValidator,
	},
	handler: async (ctx, { siteUrl, category }) => {
		await requireAuth(ctx);
		return await ctx.db
			.query("emailTemplates")
			.withIndex("by_siteUrl_category", (q) =>
				q.eq("siteUrl", siteUrl).eq("category", category),
			)
			.first();
	},
});

export const create = mutation({
	args: {
		siteUrl: v.string(),
		name: v.string(),
		category: categoryValidator,
		subject: v.string(),
		body: v.string(),
		variables: v.optional(v.array(v.string())),
	},
	handler: async (ctx, args) => {
		await requireAuth(ctx);
		return await ctx.db.insert("emailTemplates", args);
	},
});

export const update = mutation({
	args: {
		templateId: v.id("emailTemplates"),
		siteUrl: v.string(),
		name: v.optional(v.string()),
		category: v.optional(categoryValidator),
		subject: v.optional(v.string()),
		body: v.optional(v.string()),
		variables: v.optional(v.array(v.string())),
	},
	handler: async (ctx, { templateId, siteUrl, ...updates }) => {
		await patchDocument(ctx, templateId, siteUrl, updates);
	},
});

export const remove = mutation({
	args: { templateId: v.id("emailTemplates"), siteUrl: v.string() },
	handler: async (ctx, { templateId, siteUrl }) => {
		await deleteDocument(ctx, templateId, siteUrl);
	},
});
