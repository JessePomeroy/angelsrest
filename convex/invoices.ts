import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";

export const list = query({
	args: {
		siteUrl: v.string(),
		status: v.optional(v.string()),
	},
	handler: async (ctx, { siteUrl, status }) => {
		const all = await ctx.db
			.query("invoices")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.collect();

		const results = all.map((invoice) => ({
			...invoice,
			clientName: invoice.clientName ?? "unknown",
		}));

		if (status) {
			return results.filter((inv) => inv.status === status);
		}
		return results;
	},
});

export const get = query({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, { invoiceId }) => {
		const invoice = await ctx.db.get(invoiceId);
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
		const client = await ctx.db.get(args.clientId);
		const invoiceId = await ctx.db.insert("invoices", {
			...args,
			clientName: client?.name ?? "unknown",
			status: "draft",
		});

		await ctx.runMutation(internal.activityLog.logActivity, {
			siteUrl: args.siteUrl,
			clientId: args.clientId,
			action: "invoice_created",
			description: `invoice ${args.invoiceNumber} created`,
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
		status: v.optional(v.string()),
	},
	handler: async (ctx, { invoiceId, siteUrl, ...updates }) => {
		const doc = await ctx.db.get(invoiceId);
		if (!doc || doc.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		const patch: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(updates)) {
			if (val !== undefined) patch[key] = val;
		}
		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(invoiceId, patch);
		}
	},
});

export const markSent = mutation({
	args: { invoiceId: v.id("invoices"), siteUrl: v.string() },
	handler: async (ctx, { invoiceId, siteUrl }) => {
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice || invoice.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		await ctx.db.patch(invoiceId, {
			status: "sent",
			sentAt: Date.now(),
		});

		await ctx.runMutation(internal.activityLog.logActivity, {
			siteUrl: invoice.siteUrl,
			clientId: invoice.clientId,
			action: "invoice_sent",
			description: `invoice ${invoice.invoiceNumber} sent`,
		});
	},
});

export const markPaid = mutation({
	args: { invoiceId: v.id("invoices"), siteUrl: v.string() },
	handler: async (ctx, { invoiceId, siteUrl }) => {
		const invoice = await ctx.db.get(invoiceId);
		if (!invoice || invoice.siteUrl !== siteUrl) {
			throw new Error("Not found");
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
		});
	},
});

export const remove = mutation({
	args: { invoiceId: v.id("invoices"), siteUrl: v.string() },
	handler: async (ctx, { invoiceId, siteUrl }) => {
		const doc = await ctx.db.get(invoiceId);
		if (!doc || doc.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		await ctx.db.delete(invoiceId);
	},
});

export const getNextNumber = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const invoices = await ctx.db
			.query("invoices")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(1);

		const latest = invoices[0];
		if (!latest) return "INV-001";

		const num = Number.parseInt(latest.invoiceNumber.replace("INV-", ""), 10);
		return `INV-${String(num + 1).padStart(3, "0")}`;
	},
});
