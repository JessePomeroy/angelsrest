import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./authHelpers";

export const listTags = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		return await ctx.db
			.query("clientTags")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.take(200);
	},
});

export const getClientTags = query({
	args: { clientId: v.id("photographyClients") },
	handler: async (ctx, { clientId }) => {
		const assignments = await ctx.db
			.query("clientTagAssignments")
			.withIndex("by_clientId", (q) => q.eq("clientId", clientId))
			.take(50);

		const tags = [];
		for (const assignment of assignments) {
			const tag = await ctx.db.get(assignment.tagId);
			if (tag) {
				tags.push(tag);
			}
		}
		return tags;
	},
});

export const createTag = mutation({
	args: {
		siteUrl: v.string(),
		name: v.string(),
		color: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		await requireAuth(ctx);
		return await ctx.db.insert("clientTags", args);
	},
});

export const deleteTag = mutation({
	args: { tagId: v.id("clientTags") },
	handler: async (ctx, { tagId }) => {
		await requireAuth(ctx);
		// Delete all assignments for this tag
		const assignments = await ctx.db
			.query("clientTagAssignments")
			.withIndex("by_tagId", (q) => q.eq("tagId", tagId))
			.take(500);

		for (const assignment of assignments) {
			await ctx.db.delete(assignment._id);
		}

		await ctx.db.delete(tagId);
	},
});

export const assignTag = mutation({
	args: {
		siteUrl: v.string(),
		clientId: v.id("photographyClients"),
		tagId: v.id("clientTags"),
	},
	handler: async (ctx, args) => {
		await requireAuth(ctx);
		// Check if already assigned
		const existing = await ctx.db
			.query("clientTagAssignments")
			.withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
			.take(100);

		const alreadyAssigned = existing.find((a) => a.tagId === args.tagId);
		if (alreadyAssigned) return alreadyAssigned._id;

		const id = await ctx.db.insert("clientTagAssignments", args);

		const tag = await ctx.db.get(args.tagId);
		const client = await ctx.db.get(args.clientId);
		if (tag && client) {
			await ctx.runMutation(internal.activityLog.logActivity, {
				siteUrl: args.siteUrl,
				clientId: args.clientId,
				action: "tag_added",
				description: `tag "${tag.name}" added`,
			});
		}

		return id;
	},
});

export const removeTag = mutation({
	args: {
		siteUrl: v.string(),
		clientId: v.id("photographyClients"),
		tagId: v.id("clientTags"),
	},
	handler: async (ctx, args) => {
		await requireAuth(ctx);
		const assignments = await ctx.db
			.query("clientTagAssignments")
			.withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
			.take(100);

		const toRemove = assignments.find((a) => a.tagId === args.tagId);
		if (toRemove) {
			await ctx.db.delete(toRemove._id);

			const tag = await ctx.db.get(args.tagId);
			if (tag) {
				await ctx.runMutation(internal.activityLog.logActivity, {
					siteUrl: args.siteUrl,
					clientId: args.clientId,
					action: "tag_removed",
					description: `tag "${tag.name}" removed`,
				});
			}
		}
	},
});
