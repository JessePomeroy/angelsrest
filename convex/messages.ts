import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./authHelpers";

export const list = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireAuth(ctx);
		return await ctx.db
			.query("platformMessages")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("asc")
			.take(500);
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
			.take(500);

		for (const msg of unread) {
			await ctx.db.patch(msg._id, { read: true });
		}
	},
});

export const allThreads = query({
	handler: async (ctx) => {
		await requireAuth(ctx);
		// Fetch all messages once instead of per-client
		const allMessages = await ctx.db
			.query("platformMessages")
			.order("desc")
			.take(5000);

		// Group by siteUrl: track latest message and unread count
		const threadMap = new Map<
			string,
			{ latestMessage: (typeof allMessages)[0] | null; unreadCount: number }
		>();

		for (const msg of allMessages) {
			const existing = threadMap.get(msg.siteUrl);
			if (!existing) {
				threadMap.set(msg.siteUrl, {
					latestMessage: msg,
					unreadCount: !msg.read && msg.sender === "client" ? 1 : 0,
				});
			} else {
				if (!msg.read && msg.sender === "client") {
					existing.unreadCount += 1;
				}
			}
		}

		// Look up client info for each unique siteUrl
		const threads = [];
		for (const [siteUrl, data] of threadMap) {
			const client = await ctx.db
				.query("platformClients")
				.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
				.first();

			if (client) {
				threads.push({
					client,
					unreadCount: data.unreadCount,
					latestMessage: data.latestMessage,
				});
			}
		}

		return threads;
	},
});
