import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./authHelpers";

export const checkTier = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const client = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.first();

		if (!client) {
			return { tier: "basic" as const, subscriptionStatus: "none" as const };
		}

		return {
			tier: client.tier,
			subscriptionStatus: client.subscriptionStatus,
		};
	},
});

export const listAll = query({
	handler: async (ctx) => {
		await requireAuth(ctx);
		return await ctx.db.query("platformClients").order("desc").collect();
	},
});

export const getBySubscriptionId = query({
	args: { subscriptionId: v.string() },
	handler: async (ctx, { subscriptionId }) => {
		return await ctx.db
			.query("platformClients")
			.withIndex("by_stripeSubscriptionId", (q) =>
				q.eq("stripeSubscriptionId", subscriptionId),
			)
			.first();
	},
});

export const createClient = mutation({
	args: {
		name: v.string(),
		email: v.string(),
		siteUrl: v.string(),
		sanityProjectId: v.optional(v.string()),
		tier: v.union(v.literal("basic"), v.literal("full")),
		subscriptionStatus: v.union(
			v.literal("active"),
			v.literal("canceled"),
			v.literal("past_due"),
			v.literal("none"),
		),
		adminEmails: v.array(v.string()),
		notes: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		await requireAuth(ctx);
		return await ctx.db.insert("platformClients", args);
	},
});

export const updateSubscription = mutation({
	args: {
		siteUrl: v.string(),
		tier: v.union(v.literal("basic"), v.literal("full")),
		subscriptionStatus: v.union(
			v.literal("active"),
			v.literal("canceled"),
			v.literal("past_due"),
			v.literal("none"),
		),
		stripeCustomerId: v.optional(v.string()),
		stripeSubscriptionId: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const client = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", args.siteUrl))
			.first();

		if (!client) return;

		const patch: Record<string, unknown> = {
			tier: args.tier,
			subscriptionStatus: args.subscriptionStatus,
		};
		if (args.stripeCustomerId) patch.stripeCustomerId = args.stripeCustomerId;
		if (args.stripeSubscriptionId)
			patch.stripeSubscriptionId = args.stripeSubscriptionId;

		await ctx.db.patch(client._id, patch);
	},
});

export const updateClient = mutation({
	args: {
		clientId: v.id("platformClients"),
		name: v.optional(v.string()),
		email: v.optional(v.string()),
		siteUrl: v.optional(v.string()),
		sanityProjectId: v.optional(v.string()),
		tier: v.optional(v.union(v.literal("basic"), v.literal("full"))),
		subscriptionStatus: v.optional(
			v.union(
				v.literal("active"),
				v.literal("canceled"),
				v.literal("past_due"),
				v.literal("none"),
			),
		),
		notes: v.optional(v.string()),
	},
	handler: async (ctx, { clientId, ...updates }) => {
		await requireAuth(ctx);
		const patch: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(updates)) {
			if (val !== undefined) patch[key] = val;
		}
		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(clientId, patch);
		}
	},
});
