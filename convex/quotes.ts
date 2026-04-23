import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireAuth, requireSiteAdmin } from "./authHelpers";
import { deleteDocument } from "./helpers/deleting";
import { markDocumentSent } from "./helpers/marking";
import { getNextSequentialNumber } from "./helpers/numbering";
import { patchDocument } from "./helpers/patching";
import { queryBySiteUrl } from "./helpers/querying";
import { categoryValidator } from "./helpers/validators";

// Keep in sync with the `quotes.status` union in schema.ts. Widening to
// v.string() here lets nonsense values through arg validation and only fails
// later at patch time (audit H22).
const statusValidator = v.union(
	v.literal("draft"),
	v.literal("sent"),
	v.literal("accepted"),
	v.literal("declined"),
	v.literal("expired"),
);

export const list = query({
	args: {
		siteUrl: v.string(),
		status: v.optional(v.string()),
	},
	handler: async (ctx, { siteUrl, status }) => {
		await requireAuth(ctx);
		const all = await queryBySiteUrl(ctx, "quotes", siteUrl, { status });
		return all.map((quote) => ({
			...quote,
			clientName: quote.clientName ?? "unknown",
		}));
	},
});

export const get = query({
	args: { quoteId: v.id("quotes") },
	handler: async (ctx, { quoteId }) => {
		await requireAuth(ctx);
		const quote = await ctx.db.get(quoteId);
		if (!quote) return null;
		const client = await ctx.db.get(quote.clientId);
		return {
			...quote,
			clientName: client?.name ?? "unknown",
			clientEmail: client?.email,
		};
	},
});

export const create = mutation({
	args: {
		siteUrl: v.string(),
		quoteNumber: v.string(),
		clientId: v.id("photographyClients"),
		category: v.optional(categoryValidator),
		packages: v.array(
			v.object({
				name: v.string(),
				description: v.optional(v.string()),
				price: v.number(),
				included: v.optional(v.array(v.string())),
			}),
		),
		validUntil: v.optional(v.string()),
		notes: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		await requireAuth(ctx);
		const client = await ctx.db.get(args.clientId);
		const quoteId = await ctx.db.insert("quotes", {
			...args,
			clientName: client?.name ?? "unknown",
			status: "draft",
		});

		await ctx.runMutation(internal.activityLog.logActivity, {
			siteUrl: args.siteUrl,
			clientId: args.clientId,
			action: "quote_created",
			description: `quote ${args.quoteNumber} created`,
			metadata: JSON.stringify({ docType: "quote", docId: quoteId }),
		});

		return quoteId;
	},
});

export const update = mutation({
	args: {
		quoteId: v.id("quotes"),
		siteUrl: v.string(),
		packages: v.optional(
			v.array(
				v.object({
					name: v.string(),
					description: v.optional(v.string()),
					price: v.number(),
					included: v.optional(v.array(v.string())),
				}),
			),
		),
		validUntil: v.optional(v.string()),
		notes: v.optional(v.string()),
		status: v.optional(statusValidator),
	},
	handler: async (ctx, { quoteId, siteUrl, ...updates }) => {
		await patchDocument(ctx, quoteId, siteUrl, updates);
	},
});

export const markSent = mutation({
	args: { quoteId: v.id("quotes"), siteUrl: v.string() },
	handler: async (ctx, { quoteId, siteUrl }) => {
		await markDocumentSent(
			ctx,
			quoteId,
			siteUrl,
			"quote_sent",
			"quote",
			(quote) => `quote ${quote.quoteNumber} sent`,
		);
	},
});

/**
 * Creator-side mutation: admin clicks "mark accepted" in the CRM UI.
 * For the client-side portal flow, use `portal.acceptQuote` (token-authorized,
 * atomic).
 */
export const markAccepted = mutation({
	args: { quoteId: v.id("quotes"), siteUrl: v.string() },
	handler: async (ctx, { quoteId, siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl);
		const quote = await ctx.db.get(quoteId);
		if (!quote || quote.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		await ctx.db.patch(quoteId, { status: "accepted", acceptedAt: Date.now() });

		await ctx.runMutation(internal.activityLog.logActivity, {
			siteUrl: quote.siteUrl,
			clientId: quote.clientId,
			action: "quote_accepted",
			description: `quote ${quote.quoteNumber} accepted`,
			metadata: JSON.stringify({ docType: "quote", docId: quoteId }),
		});
	},
});

export const convertToInvoice = mutation({
	args: {
		quoteId: v.id("quotes"),
		siteUrl: v.string(),
		invoiceNumber: v.string(),
		invoiceType: v.union(
			v.literal("one-time"),
			v.literal("recurring"),
			v.literal("deposit"),
			v.literal("package"),
			v.literal("milestone"),
		),
		dueDate: v.optional(v.string()),
		notes: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ quoteId, siteUrl, invoiceNumber, invoiceType, dueDate, notes },
	) => {
		await requireSiteAdmin(ctx, siteUrl);
		const quote = await ctx.db.get(quoteId);
		if (!quote || quote.siteUrl !== siteUrl) throw new Error("Not found");

		// Convert packages to invoice line items
		const items = quote.packages.map((pkg) => ({
			description:
				pkg.name + (pkg.description ? ` \u2014 ${pkg.description}` : ""),
			quantity: 1,
			unitPrice: pkg.price,
		}));

		// Create the invoice
		const client = await ctx.db.get(quote.clientId);
		const invoiceId = await ctx.db.insert("invoices", {
			siteUrl: quote.siteUrl,
			invoiceNumber,
			clientId: quote.clientId,
			clientName: client?.name ?? quote.clientName ?? "unknown",
			invoiceType,
			status: "draft",
			items,
			dueDate,
			notes: notes || quote.notes || undefined,
		});

		// Link the quote to the invoice
		await ctx.db.patch(quoteId, { convertedToInvoice: invoiceId });

		// Audit M27: observability for the conversion so the client activity
		// feed reflects both quote and invoice lifecycle in one place.
		await ctx.runMutation(internal.activityLog.logActivity, {
			siteUrl: quote.siteUrl,
			clientId: quote.clientId,
			action: "quote_converted_to_invoice",
			description: `quote ${quote.quoteNumber} converted to invoice ${invoiceNumber}`,
			metadata: JSON.stringify({ quoteId, invoiceId }),
		});

		return invoiceId;
	},
});

/**
 * Creator-side mutation. For portal flow use `portal.declineQuote`.
 */
export const markDeclined = mutation({
	args: { quoteId: v.id("quotes"), siteUrl: v.string() },
	handler: async (ctx, { quoteId, siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl);
		const doc = await ctx.db.get(quoteId);
		if (!doc || doc.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		await ctx.db.patch(quoteId, { status: "declined" });
	},
});

export const remove = mutation({
	args: { quoteId: v.id("quotes"), siteUrl: v.string() },
	handler: async (ctx, { quoteId, siteUrl }) => {
		await deleteDocument(ctx, quoteId, siteUrl);
	},
});

// Quote presets
export const listPresets = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireAuth(ctx);
		return await ctx.db
			.query("quotePresets")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.take(100);
	},
});

export const createPreset = mutation({
	args: {
		siteUrl: v.string(),
		name: v.string(),
		category: v.optional(categoryValidator),
		packages: v.array(
			v.object({
				name: v.string(),
				description: v.optional(v.string()),
				price: v.number(),
				included: v.optional(v.array(v.string())),
			}),
		),
	},
	handler: async (ctx, args) => {
		await requireAuth(ctx);
		return await ctx.db.insert("quotePresets", args);
	},
});

export const updatePreset = mutation({
	args: {
		presetId: v.id("quotePresets"),
		siteUrl: v.string(),
		name: v.optional(v.string()),
		category: v.optional(categoryValidator),
		packages: v.optional(
			v.array(
				v.object({
					name: v.string(),
					description: v.optional(v.string()),
					price: v.number(),
					included: v.optional(v.array(v.string())),
				}),
			),
		),
	},
	handler: async (ctx, { presetId, siteUrl, ...updates }) => {
		await patchDocument(ctx, presetId, siteUrl, updates);
	},
});

export const removePreset = mutation({
	args: { presetId: v.id("quotePresets"), siteUrl: v.string() },
	handler: async (ctx, { presetId, siteUrl }) => {
		await deleteDocument(ctx, presetId, siteUrl);
	},
});

export const getNextNumber = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireAuth(ctx);
		return getNextSequentialNumber(
			ctx,
			"quotes",
			siteUrl,
			"quoteNumber",
			"QT-",
		);
	},
});
