import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { requireDocumentSiteAdmin, requireSiteAdmin } from "./authHelpers";
import { BULK_SCAN_LIMIT, COMPACT_LIST_LIMIT, LOOKUP_LIMIT } from "./helpers/limits";

export const listTags = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl);
		return await ctx.db
			.query("clientTags")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.take(LOOKUP_LIMIT);
	},
});

export async function readClientTags(ctx: QueryCtx, clientId: Id<"photographyClients">, siteUrl: string) {
	const assignments = await ctx.db.query("clientTagAssignments")
		.withIndex("by_clientId", (q) => q.eq("clientId", clientId))
		.take(COMPACT_LIST_LIMIT);
	const tags = await Promise.all(assignments.map((assignment) => ctx.db.get(assignment.tagId)));
	return tags.filter((tag): tag is NonNullable<typeof tag> => tag !== null && tag.siteUrl === siteUrl);
}

export const getClientTags = query({
	args: { clientId: v.id("photographyClients") },
	handler: async (ctx, { clientId }) => {
		const client = await requireDocumentSiteAdmin(ctx, "photographyClients", clientId);
		return await readClientTags(ctx, clientId, client.siteUrl);
	},
});

export const createTag = mutation({
	args: {
		siteUrl: v.string(),
		name: v.string(),
		color: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		await requireSiteAdmin(ctx, args.siteUrl);
		return await ctx.db.insert("clientTags", args);
	},
});

export const deleteTagAssignments = internalMutation({
	args: { tagId: v.id("clientTags") },
	handler: async (ctx, { tagId }): Promise<null> => {
		const assignments = await ctx.db
			.query("clientTagAssignments")
			.withIndex("by_tagId", (q) => q.eq("tagId", tagId))
			.take(BULK_SCAN_LIMIT);

		for (const assignment of assignments) {
			await ctx.db.delete(assignment._id);
		}

		if (assignments.length === BULK_SCAN_LIMIT) {
			await ctx.scheduler.runAfter(0, internal.tags.deleteTagAssignments, { tagId });
		}
		return null;
	},
});

export const deleteTag = mutation({
	args: { tagId: v.id("clientTags") },
	handler: async (ctx, { tagId }) => {
		await requireDocumentSiteAdmin(ctx, "clientTags", tagId);
		await ctx.runMutation(internal.tags.deleteTagAssignments, { tagId });
		// Deleting the parent also prevents assignments from being added between batches.
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
		await requireSiteAdmin(ctx, args.siteUrl);
		const client = await ctx.db.get(args.clientId);
		const tag = await ctx.db.get(args.tagId);
		if (
			!client ||
			client.siteUrl !== args.siteUrl ||
			!tag ||
			tag.siteUrl !== args.siteUrl
		) {
			throw new Error("Not found");
		}
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
		await requireSiteAdmin(ctx, args.siteUrl);
		const client = await ctx.db.get(args.clientId);
		const tag = await ctx.db.get(args.tagId);
		if (
			!client ||
			client.siteUrl !== args.siteUrl ||
			!tag ||
			tag.siteUrl !== args.siteUrl
		) {
			throw new Error("Not found");
		}
		// Audit M22: compound index lookup, same motivation as assignTag.
		const toRemove = await ctx.db
			.query("clientTagAssignments")
			.withIndex("by_clientId_and_tagId", (q) =>
				q.eq("clientId", args.clientId).eq("tagId", args.tagId),
			)
			.unique();

		if (toRemove) {
			await ctx.db.delete(toRemove._id);

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
