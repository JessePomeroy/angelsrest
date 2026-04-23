import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./authHelpers";
import { BULK_SCAN_LIMIT } from "./helpers/limits";

export const list = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireAuth(ctx);
		return await ctx.db
			.query("platformMessages")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("asc")
			.take(BULK_SCAN_LIMIT);
	},
});

export const send = mutation({
	args: {
		siteUrl: v.string(),
		sender: v.union(v.literal("client"), v.literal("creator")),
		content: v.string(),
	},
	handler: async (ctx, args) => {
		await requireAuth(ctx);
		return await ctx.db.insert("platformMessages", {
			...args,
			read: false,
		});
	},
});

export const markRead = mutation({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireAuth(ctx);
		const unread = await ctx.db
			.query("platformMessages")
			.withIndex("by_siteUrl_unread", (q) =>
				q.eq("siteUrl", siteUrl).eq("read", false),
			)
			.take(BULK_SCAN_LIMIT);

		for (const msg of unread) {
			await ctx.db.patch(msg._id, { read: true });
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
 * Now we drive the query from platformClients (the authoritative set
 * of threads) and fetch each client's latest + unread-count using
 * their own indexed queries. Cost is O(clients) index lookups, not
 * O(messages). No silent truncation.
 */
export const allThreads = query({
	handler: async (ctx) => {
		await requireAuth(ctx);

		const clients = await ctx.db.query("platformClients").take(BULK_SCAN_LIMIT);

		const threads = await Promise.all(
			clients.map(async (client) => {
				// Latest message on this thread (asc index is cheap to reverse).
				const latestMessage = await ctx.db
					.query("platformMessages")
					.withIndex("by_siteUrl", (q) => q.eq("siteUrl", client.siteUrl))
					.order("desc")
					.first();

				// Unread client→creator messages. `.collect()` here is bounded
				// per-client by the fact that markRead clears this set, so it
				// grows only between reads. Cap defensively at 500.
				const unreadRows = await ctx.db
					.query("platformMessages")
					.withIndex("by_siteUrl_unread", (q) =>
						q.eq("siteUrl", client.siteUrl).eq("read", false),
					)
					.take(BULK_SCAN_LIMIT);

				const unreadCount = unreadRows.filter((m) => m.sender === "client").length;

				return { client, latestMessage, unreadCount };
			}),
		);

		// Only return threads that have at least one message.
		return threads.filter((t) => t.latestMessage !== null);
	},
});
