import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./authHelpers";
import { BULK_SCAN_LIMIT, COMPACT_LIST_LIMIT, LOOKUP_LIMIT } from "./helpers/limits";

export const listTags = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireAuth(ctx);
		return await ctx.db
			.query("clientTags")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.take(LOOKUP_LIMIT);
	},
});

export const getClientTags = query({
	args: { clientId: v.id("photographyClients") },
	handler: async (ctx, { clientId }) => {
		await requireAuth(ctx);
		const assignments = await ctx.db
			.query("clientTagAssignments")
			.withIndex("by_clientId", (q) => q.eq("clientId", clientId))
			.take(COMPACT_LIST_LIMIT);

		// Fan out tag reads in parallel instead of serial (N+1). See audit M25.
		const tags = await Promise.all(
			assignments.map((assignment) => ctx.db.get(assignment.tagId)),
		);
		return tags.filter((t): t is NonNullable<typeof t> => t !== null);
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
		const assignments = await ctx.db
			.query("clientTagAssignments")
			.withIndex("by_tagId", (q) => q.eq("tagId", tagId))
			.take(BULK_SCAN_LIMIT);

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
		// Audit M22: compound point-check via `by_clientId_and_tagId`
		// replaces a linear take(100) + find scan.
		const alreadyAssigned = await ctx.db
			.query("clientTagAssignments")
			.withIndex("by_clientId_and_tagId", (q) =>
				q.eq("clientId", args.clientId).eq("tagId", args.tagId),
			)
			.unique();
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
		// Audit M22: compound index lookup, same motivation as assignTag.
		const toRemove = await ctx.db
			.query("clientTagAssignments")
			.withIndex("by_clientId_and_tagId", (q) =>
				q.eq("clientId", args.clientId).eq("tagId", args.tagId),
			)
			.unique();

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
