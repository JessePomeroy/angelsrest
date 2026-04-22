import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./authHelpers";
import { deleteDocument } from "./helpers/deleting";
import { patchDocument } from "./helpers/patching";
import { categoryValidator } from "./helpers/validators";

export const listClients = query({
	args: {
		siteUrl: v.string(),
		category: v.optional(categoryValidator),
		status: v.optional(v.string()),
	},
	handler: async (ctx, { siteUrl, category, status }) => {
		await requireAuth(ctx);
		if (category) {
			const results = await ctx.db
				.query("photographyClients")
				.withIndex("by_siteUrl_category", (q) =>
					q.eq("siteUrl", siteUrl).eq("category", category),
				)
				.order("desc")
				.take(500);
			if (status) {
				return results.filter((c) => c.status === status);
			}
			return results;
		}
		const results = await ctx.db
			.query("photographyClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(500);
		if (status) {
			return results.filter((c) => c.status === status);
		}
		return results;
	},
});

export const listClientsPaginated = query({
	args: {
		siteUrl: v.string(),
		paginationOpts: paginationOptsValidator,
		category: v.optional(categoryValidator),
	},
	handler: async (ctx, { siteUrl, paginationOpts, category }) => {
		await requireAuth(ctx);
		if (category) {
			return await ctx.db
				.query("photographyClients")
				.withIndex("by_siteUrl_category", (q) =>
					q.eq("siteUrl", siteUrl).eq("category", category),
				)
				.order("desc")
				.paginate(paginationOpts);
		}
		return await ctx.db
			.query("photographyClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.paginate(paginationOpts);
	},
});

export const getClient = query({
	args: { clientId: v.id("photographyClients") },
	handler: async (ctx, { clientId }) => {
		await requireAuth(ctx);
		return await ctx.db.get(clientId);
	},
});

export const createClient = mutation({
	args: {
		siteUrl: v.string(),
		name: v.string(),
		email: v.optional(v.string()),
		phone: v.optional(v.string()),
		category: categoryValidator,
		type: v.optional(v.string()),
		source: v.optional(v.string()),
		notes: v.optional(v.string()),
		siteUrl_client: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		await requireAuth(ctx);
		const clientId = await ctx.db.insert("photographyClients", {
			...args,
			type:
				(args.type as
					| "wedding"
					| "portrait"
					| "family"
					| "commercial"
					| "event"
					| "website"
					| "redesign"
					| "maintenance"
					| "other"
					| undefined) || undefined,
			status: "lead",
		});

		await ctx.runMutation(internal.activityLog.logActivity, {
			siteUrl: args.siteUrl,
			clientId,
			action: "client_created",
			description: `client "${args.name}" created`,
		});

		return clientId;
	},
});

export const updateClient = mutation({
	args: {
		clientId: v.id("photographyClients"),
		siteUrl: v.string(),
		name: v.optional(v.string()),
		email: v.optional(v.string()),
		phone: v.optional(v.string()),
		category: v.optional(categoryValidator),
		type: v.optional(v.string()),
		status: v.optional(v.string()),
		source: v.optional(v.string()),
		notes: v.optional(v.string()),
		siteUrl_client: v.optional(v.string()),
	},
	handler: async (ctx, { clientId, siteUrl, ...updates }) => {
		const existing = await patchDocument(ctx, clientId, siteUrl, updates);

		// Log status changes
		if (updates.status && updates.status !== existing.status) {
			await ctx.runMutation(internal.activityLog.logActivity, {
				siteUrl: existing.siteUrl,
				clientId,
				action: "status_changed",
				description: `status changed to ${updates.status}`,
			});
		}
	},
});

export const deleteClient = mutation({
	args: { clientId: v.id("photographyClients"), siteUrl: v.string() },
	handler: async (ctx, { clientId, siteUrl }) => {
		await deleteDocument(ctx, clientId, siteUrl);
	},
});

export const getStats = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireAuth(ctx);
		const all = await ctx.db
			.query("photographyClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.take(1000);

		return {
			total: all.length,
			leads: all.filter((c) => c.status === "lead").length,
			booked: all.filter((c) => c.status === "booked").length,
			inProgress: all.filter((c) => c.status === "in-progress").length,
			completed: all.filter((c) => c.status === "completed").length,
			photography: all.filter((c) => c.category === "photography").length,
			web: all.filter((c) => c.category === "web").length,
		};
	},
});
