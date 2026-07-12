import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	query,
	type QueryCtx,
} from "./_generated/server";
import { requirePlatformAdmin, requireSiteAdmin } from "./authHelpers";
import { BULK_SCAN_LIMIT } from "./helpers/limits";

async function getUnreadSummary(ctx: QueryCtx, siteUrl: string) {
	const unreadRows = await ctx.db
		.query("platformMessages")
		.withIndex("by_siteUrl_sender_unread", (q) =>
			q.eq("siteUrl", siteUrl).eq("sender", "client").eq("read", false),
		)
		.take(BULK_SCAN_LIMIT + 1);

	return {
		unreadCount: Math.min(unreadRows.length, BULK_SCAN_LIMIT),
		unreadCountIsTruncated: unreadRows.length > BULK_SCAN_LIMIT,
	};
}

async function markReadBatch(ctx: MutationCtx, siteUrl: string) {
	const unread = await ctx.db
		.query("platformMessages")
		.withIndex("by_siteUrl_unread", (q) =>
			q.eq("siteUrl", siteUrl).eq("read", false),
		)
		.take(BULK_SCAN_LIMIT);

	for (const message of unread) {
		await ctx.db.patch(message._id, { read: true });
	}

	return unread.length === BULK_SCAN_LIMIT;
}

export const list = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl);
		return await ctx.db
			.query("platformMessages")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("asc")
			.take(BULK_SCAN_LIMIT);
	},
});

/**
 * Return one page of a site's messages, newest first.
 *
 * Consumers should append each page to their loaded results, then reverse the
 * accumulated list when rendering a chronological conversation. Starting from
 * the newest message means the initial page always contains the active end of
 * the thread instead of the oldest rows returned by the legacy capped query.
 */
export const listPaginated = query({
	args: {
		siteUrl: v.string(),
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, { siteUrl, paginationOpts }) => {
		await requireSiteAdmin(ctx, siteUrl);
		return await ctx.db
			.query("platformMessages")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.paginate(paginationOpts);
	},
});

export const send = mutation({
	args: {
		siteUrl: v.string(),
		sender: v.union(v.literal("client"), v.literal("creator")),
		content: v.string(),
	},
	handler: async (ctx, args) => {
		await requireSiteAdmin(ctx, args.siteUrl);
		return await ctx.db.insert("platformMessages", {
			...args,
			read: false,
		});
	},
});

export const markRead = mutation({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl);
		const hasMore = await markReadBatch(ctx, siteUrl);
		if (hasMore) {
			await ctx.scheduler.runAfter(0, internal.messages._markReadBatch, {
				siteUrl,
			});
		}
	},
});

/** Continue a tenant-authorized mark-read operation in bounded transactions. */
export const _markReadBatch = internalMutation({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const hasMore = await markReadBatch(ctx, siteUrl);
		if (hasMore) {
			await ctx.scheduler.runAfter(0, internal.messages._markReadBatch, {
				siteUrl,
			});
		}
	},
});

/**
 * Return one row per tenant: the latest message on that thread plus
 * the count of unread client→creator messages.
 *
 * Audit H17: the old implementation did `.query("platformMessages")
 * .order("desc").take(5000)` and grouped in memory. Once total message
 * volume exceeded 5000 across all tenants, the oldest threads silently
 * dropped out of the admin inbox — tenants whose latest message happened
 * to be outside the 5000-row window disappeared.
 *
 * Now we drive the query from platformClients and fetch each client's latest +
 * unread-count through indexed queries. Cost is O(clients) lookups rather than
 * O(messages). The client scan is still bounded by `BULK_SCAN_LIMIT`; add
 * pagination before platform-client count can exceed that bound.
 */
export const allThreads = query({
	handler: async (ctx) => {
		await requirePlatformAdmin(ctx);

		const clients = await ctx.db.query("platformClients").take(BULK_SCAN_LIMIT);

		const threads = await Promise.all(
			clients.map(async (client) => {
				// Latest message on this thread (asc index is cheap to reverse).
				const latestMessage = await ctx.db
					.query("platformMessages")
					.withIndex("by_siteUrl", (q) => q.eq("siteUrl", client.siteUrl))
					.order("desc")
					.first();

				const unreadSummary = await getUnreadSummary(ctx, client.siteUrl);

				return { client, latestMessage, ...unreadSummary };
			}),
		);

		// Only return threads that have at least one message.
		return threads.filter((t) => t.latestMessage !== null);
	},
});

/**
 * Cursor-paginated replacement for `allThreads`.
 *
 * The cursor advances over platform clients, so the amount of work in one
 * query is bounded by the requested page size. Clients without messages are
 * omitted from the returned page while the original pagination cursor and
 * completion state are preserved.
 */
export const allThreadsPaginated = query({
	args: { paginationOpts: paginationOptsValidator },
	handler: async (ctx, { paginationOpts }) => {
		await requirePlatformAdmin(ctx);

		const clientsPage = await ctx.db
			.query("platformClients")
			.order("desc")
			.paginate(paginationOpts);

		const threads = await Promise.all(
			clientsPage.page.map(async (client) => {
				const latestMessage = await ctx.db
					.query("platformMessages")
					.withIndex("by_siteUrl", (q) => q.eq("siteUrl", client.siteUrl))
					.order("desc")
					.first();

				const unreadSummary = await getUnreadSummary(ctx, client.siteUrl);

				return { client, latestMessage, ...unreadSummary };
			}),
		);

		return {
			...clientsPage,
			page: threads.filter((thread) => thread.latestMessage !== null),
		};
	},
});
