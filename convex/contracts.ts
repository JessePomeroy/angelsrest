import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
	args: {
		siteUrl: v.string(),
		status: v.optional(v.string()),
	},
	handler: async (ctx, { siteUrl, status }) => {
		const all = await ctx.db
			.query("contracts")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.collect();

		const withClients = await Promise.all(
			all.map(async (contract) => {
				const client = await ctx.db.get(contract.clientId);
				return { ...contract, clientName: client?.name ?? "unknown" };
			}),
		);

		if (status) return withClients.filter((c) => c.status === status);
		return withClients;
	},
});

export const get = query({
	args: { contractId: v.id("contracts") },
	handler: async (ctx, { contractId }) => {
		const contract = await ctx.db.get(contractId);
		if (!contract) return null;
		const client = await ctx.db.get(contract.clientId);
		return {
			...contract,
			clientName: client?.name ?? "unknown",
			clientEmail: client?.email,
		};
	},
});

export const create = mutation({
	args: {
		siteUrl: v.string(),
		title: v.string(),
		clientId: v.id("photographyClients"),
		category: v.optional(v.union(v.literal("photography"), v.literal("web"))),
		templateId: v.optional(v.id("contractTemplates")),
		body: v.string(),
		eventDate: v.optional(v.string()),
		eventLocation: v.optional(v.string()),
		totalPrice: v.optional(v.number()),
		depositAmount: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert("contracts", {
			...args,
			status: "draft",
		});
	},
});

export const update = mutation({
	args: {
		contractId: v.id("contracts"),
		title: v.optional(v.string()),
		body: v.optional(v.string()),
		eventDate: v.optional(v.string()),
		eventLocation: v.optional(v.string()),
		totalPrice: v.optional(v.number()),
		depositAmount: v.optional(v.number()),
		status: v.optional(v.string()),
	},
	handler: async (ctx, { contractId, ...updates }) => {
		const patch: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(updates)) {
			if (val !== undefined) patch[key] = val;
		}
		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(contractId, patch);
		}
	},
});

export const markSent = mutation({
	args: { contractId: v.id("contracts") },
	handler: async (ctx, { contractId }) => {
		await ctx.db.patch(contractId, { status: "sent", sentAt: Date.now() });
	},
});

export const markSigned = mutation({
	args: { contractId: v.id("contracts") },
	handler: async (ctx, { contractId }) => {
		await ctx.db.patch(contractId, { status: "signed", signedAt: Date.now() });
	},
});

export const sign = mutation({
	args: {
		contractId: v.id("contracts"),
		signedByName: v.string(),
		signedByEmail: v.optional(v.string()),
		signatureData: v.optional(v.string()),
	},
	handler: async (ctx, { contractId, ...signData }) => {
		await ctx.db.patch(contractId, {
			...signData,
			status: "signed",
			signedAt: Date.now(),
		});
	},
});

export const remove = mutation({
	args: { contractId: v.id("contracts") },
	handler: async (ctx, { contractId }) => {
		await ctx.db.delete(contractId);
	},
});

// Contract templates
export const listTemplates = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		return await ctx.db
			.query("contractTemplates")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.collect();
	},
});

export const createTemplate = mutation({
	args: {
		siteUrl: v.string(),
		name: v.string(),
		body: v.string(),
		variables: v.optional(v.array(v.string())),
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert("contractTemplates", args);
	},
});

export const updateTemplate = mutation({
	args: {
		templateId: v.id("contractTemplates"),
		name: v.optional(v.string()),
		body: v.optional(v.string()),
		variables: v.optional(v.array(v.string())),
	},
	handler: async (ctx, { templateId, ...updates }) => {
		const patch: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(updates)) {
			if (val !== undefined) patch[key] = val;
		}
		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(templateId, patch);
		}
	},
});

export const removeTemplate = mutation({
	args: { templateId: v.id("contractTemplates") },
	handler: async (ctx, { templateId }) => {
		await ctx.db.delete(templateId);
	},
});
