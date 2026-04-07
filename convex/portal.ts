import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";

export const createToken = mutation({
	args: {
		siteUrl: v.string(),
		type: v.union(
			v.literal("invoice"),
			v.literal("quote"),
			v.literal("contract"),
		),
		documentId: v.string(),
		clientId: v.id("photographyClients"),
		expiresAt: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const token = crypto.randomUUID();
		await ctx.db.insert("portalTokens", {
			token,
			siteUrl: args.siteUrl,
			type: args.type,
			documentId: args.documentId,
			clientId: args.clientId,
			expiresAt: args.expiresAt,
			used: false,
		});
		return token;
	},
});

export const markUsed = mutation({
	args: {
		token: v.string(),
	},
	handler: async (ctx, { token }) => {
		const tokenDoc = await ctx.db
			.query("portalTokens")
			.withIndex("by_token", (q) => q.eq("token", token))
			.unique();
		if (!tokenDoc) throw new Error("Token not found");
		await ctx.db.patch(tokenDoc._id, { used: true });
	},
});

export const getByToken = query({
	args: {
		token: v.string(),
	},
	handler: async (ctx, { token }) => {
		const tokenDoc = await ctx.db
			.query("portalTokens")
			.withIndex("by_token", (q) => q.eq("token", token))
			.unique();
		if (!tokenDoc) return null;

		// Check expiry
		if (tokenDoc.expiresAt && Date.now() > tokenDoc.expiresAt) {
			return { expired: true as const };
		}

		// Fetch client
		const client = await ctx.db.get(tokenDoc.clientId);

		// Fetch the related document
		let document = null;
		if (tokenDoc.type === "invoice") {
			document = await ctx.db.get(tokenDoc.documentId as Id<"invoices">);
		} else if (tokenDoc.type === "quote") {
			document = await ctx.db.get(tokenDoc.documentId as Id<"quotes">);
		} else if (tokenDoc.type === "contract") {
			document = await ctx.db.get(tokenDoc.documentId as Id<"contracts">);
		}

		if (!document) return null;

		return {
			expired: false as const,
			token: tokenDoc,
			document,
			client: client ? { name: client.name, email: client.email } : null,
		};
	},
});

export const listTokens = query({
	args: {
		siteUrl: v.string(),
	},
	handler: async (ctx, { siteUrl }) => {
		return await ctx.db
			.query("portalTokens")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(100);
	},
});
