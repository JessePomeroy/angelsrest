import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./authHelpers";

export const listClients = query({
	args: {
		siteUrl: v.string(),
		category: v.optional(v.union(v.literal("photography"), v.literal("web"))),
		status: v.optional(v.string()),
	},
	handler: async (ctx, { siteUrl, category, status }) => {
		if (category) {
			const results = await ctx.db
				.query("photographyClients")
				.withIndex("by_siteUrl_category", (q) =>
					q.eq("siteUrl", siteUrl).eq("category", category),
				)
				.order("desc")
				.collect();
			if (status) {
				return results.filter((c) => c.status === status);
			}
			return results;
		}
		const results = await ctx.db
			.query("photographyClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.collect();
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
		category: v.optional(v.union(v.literal("photography"), v.literal("web"))),
	},
	handler: async (ctx, { siteUrl, paginationOpts, category }) => {
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
		return await ctx.db.get(clientId);
	},
});

export const createClient = mutation({
	args: {
		siteUrl: v.string(),
		name: v.string(),
		email: v.optional(v.string()),
		phone: v.optional(v.string()),
		category: v.union(v.literal("photography"), v.literal("web")),
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
		category: v.optional(v.union(v.literal("photography"), v.literal("web"))),
		type: v.optional(v.string()),
		status: v.optional(v.string()),
		source: v.optional(v.string()),
		notes: v.optional(v.string()),
		siteUrl_client: v.optional(v.string()),
	},
	handler: async (ctx, { clientId, siteUrl, ...updates }) => {
		await requireAuth(ctx);
		const existing = await ctx.db.get(clientId);
		if (!existing || existing.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		const patch: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(updates)) {
			if (val !== undefined) patch[key] = val;
		}
		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(clientId, patch);
		}

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
		await requireAuth(ctx);
		const doc = await ctx.db.get(clientId);
		if (!doc || doc.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		await ctx.db.delete(clientId);
	},
});

export const getStats = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const all = await ctx.db
			.query("photographyClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.collect();

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
