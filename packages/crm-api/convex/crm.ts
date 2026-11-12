import { logActivity } from "./activityLog";
import { readClientTags } from "./tags";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
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

const clearableClientField = v.union(
	v.literal("email"),
	v.literal("phone"),
	v.literal("type"),
	v.literal("source"),
	v.literal("notes"),
	v.literal("siteUrl_client"),
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
		await requireSiteAdmin(ctx, args.siteUrl, "crm");
		return await clientsByFilter(ctx, args).order("desc").take(BULK_SCAN_LIMIT);
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
		await requireSiteAdmin(ctx, args.siteUrl, "crm");
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

/** Matching rows from one bounded candidate batch; empty pages can still continue. */
export const scanClientsWithTags = query({
	args: {
		siteUrl: v.string(),
		paginationOpts: paginationOptsValidator,
		category: v.optional(categoryValidator),
		status: v.optional(statusValidator),
		search: v.optional(v.string()),
		tagId: v.optional(v.id("clientTags")),
	},
	handler: async (ctx, args) => {
		await requireSiteAdmin(ctx, args.siteUrl, "crm");
		if (
			!Number.isInteger(args.paginationOpts.numItems) ||
			args.paginationOpts.numItems < 1 ||
			args.paginationOpts.numItems > 50
		) {
			throw new Error("Client filter batches must contain 1 to 50 candidates");
		}
		if (args.search !== undefined && args.search.length > 200) {
			throw new Error("Client search must contain at most 200 characters");
		}
		const tagId = args.tagId;
		if (tagId) {
			const tag = await ctx.db.get(tagId);
			if (!tag || tag.siteUrl !== args.siteUrl) throw new Error("Not found");
		}
		const result = await clientsByFilter(ctx, args)
			.order("desc")
			.paginate({
				...args.paginationOpts,
				maximumRowsRead: 50,
				maximumBytesRead: 1_000_000,
			});
		const search = args.search?.toLowerCase() ?? "";
		const matches: Doc<"photographyClients">[] = [];
		for (const client of result.page) {
			if (
				search &&
				!client.name.toLowerCase().includes(search) &&
				!client.email?.toLowerCase().includes(search)
			)
				continue;
			if (tagId) {
				// The displayed tag projection is capped; membership needs a point lookup.
				const assignment = await ctx.db
					.query("clientTagAssignments")
					.withIndex("by_clientId_and_tagId", (q) =>
						q.eq("clientId", client._id).eq("tagId", tagId),
					)
					.unique();
				if (!assignment || assignment.siteUrl !== args.siteUrl) continue;
			}
			matches.push(client);
		}
		return {
			...result,
			scannedCount: result.page.length,
			page: await Promise.all(
				matches.map(async (client) => ({
					...client,
					tags: await readClientTags(ctx, client._id, args.siteUrl),
				})),
			),
		};
	},
});

export const getClient = query({
	args: { clientId: v.id("photographyClients") },
	handler: async (ctx, { clientId }) => {
		return await requireDocumentSiteAdmin(ctx, "photographyClients", clientId, "crm");
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
		await requireSiteAdmin(ctx, args.siteUrl, "crm");
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

		await logActivity(ctx, {
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
		clearFields: v.optional(v.array(clearableClientField)),
	},
	handler: async (ctx, { clientId, siteUrl, clearFields = [], ...updates }) => {
		if (clearFields.length > 6) throw new Error("Too many fields to clear");
		const clearPatch: Partial<Doc<"photographyClients">> = {};
		for (const field of clearFields) {
			if (updates[field] !== undefined) {
				throw new Error(`Cannot set and clear ${field} in the same update`);
			}
			clearPatch[field] = undefined;
		}
		const existing = await patchDocument(ctx, clientId, siteUrl, updates, "crm");
		// Ordinary omitted values remain unchanged; only explicit intent removes fields.
		if (clearFields.length > 0) await ctx.db.patch(clientId, clearPatch);

		// Log status changes
		if (updates.status && updates.status !== existing.status) {
			await logActivity(ctx, {
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
		const target = await requireDocumentSiteAdmin(ctx, "photographyClients", clientId, "crm");
		if (target.siteUrl !== siteUrl) throw new Error("Not found");
		if (await ctx.db.query("gmailConversations").withIndex("by_clientId", q => q.eq("clientId", clientId)).first())
			throw new Error("Delete this client's imported Gmail conversations before deleting the client");
		await deleteDocument(ctx, clientId, siteUrl, "crm");
	},
});

export const getStats = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl, "crm");
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
