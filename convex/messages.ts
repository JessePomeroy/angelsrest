import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		return await ctx.db
			.query("platformMessages")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("asc")
			.collect();
	},
});

export const send = mutation({
	args: {
		siteUrl: v.string(),
		sender: v.union(v.literal("client"), v.literal("creator")),
		content: v.string(),
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert("platformMessages", {
			...args,
			read: false,
		});
	},
});

export const markRead = mutation({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const unread = await ctx.db
			.query("platformMessages")
			.withIndex("by_siteUrl_unread", (q) =>
				q.eq("siteUrl", siteUrl).eq("read", false),
			)
			.collect();

		for (const msg of unread) {
			await ctx.db.patch(msg._id, { read: true });
		}
	},
});

export const allThreads = query({
	handler: async (ctx) => {
		const clients = await ctx.db.query("platformClients").collect();

		return await Promise.all(
			clients.map(async (client) => {
				const unread = await ctx.db
					.query("platformMessages")
					.withIndex("by_siteUrl_unread", (q) =>
						q.eq("siteUrl", client.siteUrl).eq("read", false),
					)
					.collect();

				const messages = await ctx.db
					.query("platformMessages")
					.withIndex("by_siteUrl", (q) => q.eq("siteUrl", client.siteUrl))
					.order("desc")
					.take(1);

				return {
					client,
					unreadCount: unread.filter((m) => m.sender === "client").length,
					latestMessage: messages[0] ?? null,
				};
			}),
		);
	},
});
