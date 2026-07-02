import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import {
	requireDocumentSiteAdmin,
	requireSiteAdmin,
	requireWebhookCallerOrAuth,
} from "./authHelpers";
import { deleteDocument } from "./helpers/deleting";
import { markDocumentSent } from "./helpers/marking";
import { getNextSequentialNumber } from "./helpers/numbering";
import { patchDocument } from "./helpers/patching";
import { queryBySiteUrl } from "./helpers/querying";

// Keep in sync with the `invoices.status` union in schema.ts. Widening to
// v.string() here lets nonsense values through arg validation and only fails
// later at patch time (audit H22).
const statusValidator = v.union(
	v.literal("draft"),
	v.literal("sent"),
	v.literal("paid"),
	v.literal("partial"),
	v.literal("overdue"),
	v.literal("canceled"),
);

export const list = query({
	args: {
		siteUrl: v.string(),
		status: v.optional(v.string()),
	},
	handler: async (ctx, { siteUrl, status }) => {
		await requireSiteAdmin(ctx, siteUrl);
		const all = await queryBySiteUrl(ctx, "invoices", siteUrl, { status });
		return all.map((invoice) => ({
			...invoice,
			clientName: invoice.clientName ?? "unknown",
		}));
	},
});

export const get = query({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, { invoiceId }) => {
		const invoice = await requireDocumentSiteAdmin(ctx, "invoices", invoiceId);
		if (!invoice) return null;
		const client = await ctx.db.get(invoice.clientId);
		return {
			...invoice,
			clientName: client?.name ?? "unknown",
			clientEmail: client?.email,
		};
	},
});

export const create = mutation({
	args: {
		siteUrl: v.string(),
		invoiceNumber: v.string(),
		clientId: v.id("photographyClients"),
		invoiceType: v.union(
			v.literal("one-time"),
			v.literal("recurring"),
			v.literal("deposit"),
			v.literal("package"),
			v.literal("milestone"),
		),
		items: v.array(
			v.object({
				description: v.string(),
				quantity: v.number(),
				unitPrice: v.number(),
			}),
		),
		taxPercent: v.optional(v.number()),
		notes: v.optional(v.string()),
		dueDate: v.optional(v.string()),
		recurring: v.optional(
			v.object({
				interval: v.union(
					v.literal("weekly"),
					v.literal("monthly"),
					v.literal("quarterly"),
					v.literal("yearly"),
				),
				nextDueDate: v.optional(v.string()),
				endDate: v.optional(v.string()),
			}),
		),
		depositPercent: v.optional(v.number()),
		totalProject: v.optional(v.number()),
		milestoneName: v.optional(v.string()),
		milestoneIndex: v.optional(v.number()),
		parentInvoiceId: v.optional(v.id("invoices")),
	},
	handler: async (ctx, args) => {
		await requireSiteAdmin(ctx, args.siteUrl);
		const client = await ctx.db.get(args.clientId);
		if (!client || client.siteUrl !== args.siteUrl) {
			throw new Error("Client not found");
		}
		const invoiceId = await ctx.db.insert("invoices", {
			...args,
			clientName: client.name,
			status: "draft",
		});

		await ctx.runMutation(internal.activityLog.logActivity, {
			siteUrl: args.siteUrl,
			clientId: args.clientId,
			action: "invoice_created",
			description: `invoice ${args.invoiceNumber} created`,
			metadata: JSON.stringify({ docType: "invoice", docId: invoiceId }),
		});

		return invoiceId;
	},
});

export const update = mutation({
	args: {
		invoiceId: v.id("invoices"),
		siteUrl: v.string(),
		items: v.optional(
			v.array(
				v.object({
					description: v.string(),
					quantity: v.number(),
					unitPrice: v.number(),
				}),
			),
		),
		taxPercent: v.optional(v.number()),
		notes: v.optional(v.string()),
		dueDate: v.optional(v.string()),
		status: v.optional(statusValidator),
	},
	handler: async (ctx, { invoiceId, siteUrl, ...updates }) => {
		await patchDocument(ctx, invoiceId, siteUrl, updates);
	},
});

export const markSent = mutation({
	args: { invoiceId: v.id("invoices"), siteUrl: v.string() },
	handler: async (ctx, { invoiceId, siteUrl }) => {
		await markDocumentSent(
			ctx,
			invoiceId,
			siteUrl,
			"invoice_sent",
			"invoice",
			(invoice) => `invoice ${invoice.invoiceNumber} sent`,
		);
	},
});

/**
 * Mark an invoice paid. Called by:
 *   - The Stripe webhook on `checkout.session.completed` (passes
 *     `webhookSecret`) — customer paid via the portal.
 *   - The admin UI ("mark paid" button) — uses an authenticated session.
 *
 * Audit C4 pattern: either webhook secret or admin session is required.
 */
export const markPaid = mutation({
	args: {
		invoiceId: v.id("invoices"),
		siteUrl: v.string(),
		webhookSecret: v.optional(v.string()),
	},
	handler: async (ctx, { invoiceId, siteUrl, webhookSecret }) => {
		const auth = await requireWebhookCallerOrAuth(ctx, webhookSecret);
		if (auth.via === "auth") {
			await requireSiteAdmin(ctx, siteUrl);
		}
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice || invoice.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		if (invoice.status === "paid") {
			// Idempotent — retry-safe on Stripe webhook replays.
			return;
		}
		await ctx.db.patch(invoiceId, {
			status: "paid",
			paidAt: Date.now(),
		});

		await ctx.runMutation(internal.activityLog.logActivity, {
			siteUrl: invoice.siteUrl,
			clientId: invoice.clientId,
			action: "invoice_paid",
			description: `invoice ${invoice.invoiceNumber} marked as paid`,
			metadata: JSON.stringify({ docType: "invoice", docId: invoiceId }),
		});
	},
});

export const remove = mutation({
	args: { invoiceId: v.id("invoices"), siteUrl: v.string() },
	handler: async (ctx, { invoiceId, siteUrl }) => {
		await deleteDocument(ctx, invoiceId, siteUrl);
	},
});

export const getNextNumber = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl);
		return getNextSequentialNumber(
			ctx,
			"invoices",
			siteUrl,
			"invoiceNumber",
			"INV-",
		);
	},
});
