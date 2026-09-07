import { readClientTags } from "./tags";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireDocumentSiteAdmin, requireSiteAdmin } from "./authHelpers";
import { deleteDocument } from "./helpers/deleting";
import { BULK_SCAN_LIMIT, LARGE_SCAN_LIMIT } from "./helpers/limits";
import { patchDocument } from "./helpers/patching";
import { categoryValidator } from "./helpers/validators";

// Keep in sync with the `photographyClients.status` union in schema.ts.
// Widening to v.string() here lets nonsense values through arg validation
// and only fails later at patch time (audit H22).
const statusValidator = v.union(
	v.literal("lead"),
	v.literal("booked"),
	v.literal("in-progress"),
	v.literal("completed"),
	v.literal("archived"),
);

function clientsByFilter(
	ctx: QueryCtx,
	{
		siteUrl,
		category,
		status,
	}: {
		siteUrl: string;
		category?: Doc<"photographyClients">["category"];
		status?: Doc<"photographyClients">["status"];
	},
) {
	const clients = ctx.db.query("photographyClients");
	if (category && status)
		return clients.withIndex("by_siteUrl_and_category_and_status", (q) =>
			q.eq("siteUrl", siteUrl).eq("category", category).eq("status", status),
		);
	if (status)
		return clients.withIndex("by_siteUrl_status", (q) =>
			q.eq("siteUrl", siteUrl).eq("status", status),
		);
	if (category)
		return clients.withIndex("by_siteUrl_category", (q) =>
			q.eq("siteUrl", siteUrl).eq("category", category),
		);
	return clients.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl));
}

export const listClients = query({
	args: {
		siteUrl: v.string(),
		category: v.optional(categoryValidator),
		status: v.optional(statusValidator),
	},
	handler: async (ctx, args) => {
		await requireSiteAdmin(ctx, args.siteUrl);
		return await clientsByFilter(ctx, args).order("desc").take(BULK_SCAN_LIMIT);
	},
});

export const listClientsPaginated = query({
	args: {
		siteUrl: v.string(),
		paginationOpts: paginationOptsValidator,
		category: v.optional(categoryValidator),
		status: v.optional(statusValidator),
	},
	handler: async (ctx, args) => {
		await requireSiteAdmin(ctx, args.siteUrl);
		return await clientsByFilter(ctx, args).order("desc").paginate(args.paginationOpts);
	},
});

/** Fresh snapshot pages keep the tag join below the transaction row budget. */
export const listClientsWithTags = query({
	args: {
		siteUrl: v.string(),
		paginationOpts: paginationOptsValidator,
		category: v.optional(categoryValidator),
		status: v.optional(statusValidator),
	},
	handler: async (ctx, args) => {
		await requireSiteAdmin(ctx, args.siteUrl);
		const result = await clientsByFilter(ctx, args).order("desc").paginate({
			...args.paginationOpts,
			numItems: Math.min(args.paginationOpts.numItems, 50),
			maximumRowsRead: 50,
		});
		return {
			...result,
			page: await Promise.all(result.page.map(async (client) => ({
				...client,
				tags: await readClientTags(ctx, client._id, args.siteUrl),
			}))),
		};
	},
});

export const getClient = query({
	args: { clientId: v.id("photographyClients") },
	handler: async (ctx, { clientId }) => {
		return await requireDocumentSiteAdmin(ctx, "photographyClients", clientId);
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
		await requireSiteAdmin(ctx, args.siteUrl);
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
		status: v.optional(statusValidator),
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
		await requireSiteAdmin(ctx, siteUrl);
		const rows = await ctx.db
			.query("photographyClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.take(LARGE_SCAN_LIMIT + 1);
		const all = rows.slice(0, LARGE_SCAN_LIMIT);

		return {
			truncated: rows.length > LARGE_SCAN_LIMIT,
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
