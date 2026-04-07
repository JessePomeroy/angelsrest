import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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
		return await ctx.db.insert("photographyClients", {
			...args,
			type: (args.type as any) || undefined,
			status: "lead",
		});
	},
});

export const updateClient = mutation({
	args: {
		clientId: v.id("photographyClients"),
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
	handler: async (ctx, { clientId, ...updates }) => {
		const patch: Record<string, any> = {};
		for (const [key, val] of Object.entries(updates)) {
			if (val !== undefined) patch[key] = val;
		}
		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(clientId, patch);
		}
	},
});

export const deleteClient = mutation({
	args: { clientId: v.id("photographyClients") },
	handler: async (ctx, { clientId }) => {
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
