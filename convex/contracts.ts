import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireAuth, requireSiteAdmin } from "./authHelpers";
import { deleteDocument } from "./helpers/deleting";
import { DEFAULT_LIST_LIMIT } from "./helpers/limits";
import { markDocumentSent } from "./helpers/marking";
import { patchDocument } from "./helpers/patching";
import { queryBySiteUrl } from "./helpers/querying";
import { categoryValidator } from "./helpers/validators";

// Keep in sync with the `contracts.status` union in schema.ts. Widening to
// v.string() here lets nonsense values through arg validation and only fails
// later at patch time (audit H22).
const statusValidator = v.union(
	v.literal("draft"),
	v.literal("sent"),
	v.literal("signed"),
	v.literal("expired"),
);

export const list = query({
	args: {
		siteUrl: v.string(),
		status: v.optional(v.string()),
	},
	handler: async (ctx, { siteUrl, status }) => {
		await requireAuth(ctx);
		const all = await queryBySiteUrl(ctx, "contracts", siteUrl, { status });
		return all.map((contract) => ({
			...contract,
			clientName: contract.clientName ?? "unknown",
		}));
	},
});

export const get = query({
	args: { contractId: v.id("contracts") },
	handler: async (ctx, { contractId }) => {
		await requireAuth(ctx);
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
		category: v.optional(categoryValidator),
		templateId: v.optional(v.id("contractTemplates")),
		body: v.string(),
		eventDate: v.optional(v.string()),
		eventLocation: v.optional(v.string()),
		totalPrice: v.optional(v.number()),
		depositAmount: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		await requireAuth(ctx);
		const client = await ctx.db.get(args.clientId);
		const contractId = await ctx.db.insert("contracts", {
			...args,
			clientName: client?.name ?? "unknown",
			status: "draft",
		});

		await ctx.runMutation(internal.activityLog.logActivity, {
			siteUrl: args.siteUrl,
			clientId: args.clientId,
			action: "contract_created",
			description: `contract "${args.title}" created`,
			metadata: JSON.stringify({ docType: "contract", docId: contractId }),
		});

		return contractId;
	},
});

export const update = mutation({
	args: {
		contractId: v.id("contracts"),
		siteUrl: v.string(),
		title: v.optional(v.string()),
		body: v.optional(v.string()),
		eventDate: v.optional(v.string()),
		eventLocation: v.optional(v.string()),
		totalPrice: v.optional(v.number()),
		depositAmount: v.optional(v.number()),
		status: v.optional(statusValidator),
	},
	handler: async (ctx, { contractId, siteUrl, ...updates }) => {
		await patchDocument(ctx, contractId, siteUrl, updates);
	},
});

export const markSent = mutation({
	args: { contractId: v.id("contracts"), siteUrl: v.string() },
	handler: async (ctx, { contractId, siteUrl }) => {
		await markDocumentSent(
			ctx,
			contractId,
			siteUrl,
			"contract_sent",
			"contract",
			(contract) => `contract "${contract.title}" sent`,
		);
	},
});

export const markSigned = mutation({
	args: { contractId: v.id("contracts"), siteUrl: v.string() },
	handler: async (ctx, { contractId, siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl);
		const contract = await ctx.db.get(contractId);
		if (!contract || contract.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		await ctx.db.patch(contractId, { status: "signed", signedAt: Date.now() });

		await ctx.runMutation(internal.activityLog.logActivity, {
			siteUrl: contract.siteUrl,
			clientId: contract.clientId,
			action: "contract_signed",
			description: `contract "${contract.title}" signed`,
			metadata: JSON.stringify({ docType: "contract", docId: contractId }),
		});
	},
});

export const remove = mutation({
	args: { contractId: v.id("contracts"), siteUrl: v.string() },
	handler: async (ctx, { contractId, siteUrl }) => {
		await deleteDocument(ctx, contractId, siteUrl);
	},
});

// Contract templates
export const listTemplates = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireAuth(ctx);
		return await ctx.db
			.query("contractTemplates")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.take(DEFAULT_LIST_LIMIT);
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
		await requireAuth(ctx);
		return await ctx.db.insert("contractTemplates", args);
	},
});

export const updateTemplate = mutation({
	args: {
		templateId: v.id("contractTemplates"),
		siteUrl: v.string(),
		name: v.optional(v.string()),
		body: v.optional(v.string()),
		variables: v.optional(v.array(v.string())),
	},
	handler: async (ctx, { templateId, siteUrl, ...updates }) => {
		await patchDocument(ctx, templateId, siteUrl, updates);
	},
});

export const removeTemplate = mutation({
	args: { templateId: v.id("contractTemplates"), siteUrl: v.string() },
	handler: async (ctx, { templateId, siteUrl }) => {
		await deleteDocument(ctx, templateId, siteUrl);
	},
});
