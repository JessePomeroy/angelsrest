import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
	args: {
		siteUrl: v.string(),
		status: v.optional(v.string()),
	},
	handler: async (ctx, { siteUrl, status }) => {
		const all = await ctx.db
			.query("quotes")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.collect();

		const withClients = await Promise.all(
			all.map(async (quote) => {
				const client = await ctx.db.get(quote.clientId);
				return { ...quote, clientName: client?.name ?? "unknown" };
			}),
		);

		if (status) return withClients.filter((q) => q.status === status);
		return withClients;
	},
});

export const get = query({
	args: { quoteId: v.id("quotes") },
	handler: async (ctx, { quoteId }) => {
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
		category: v.optional(v.union(v.literal("photography"), v.literal("web"))),
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
		return await ctx.db.insert("quotes", {
			...args,
			status: "draft",
		});
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
		status: v.optional(v.string()),
	},
	handler: async (ctx, { quoteId, siteUrl, ...updates }) => {
		const doc = await ctx.db.get(quoteId);
		if (!doc || doc.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		const patch: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(updates)) {
			if (val !== undefined) patch[key] = val;
		}
		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(quoteId, patch);
		}
	},
});

export const markSent = mutation({
	args: { quoteId: v.id("quotes"), siteUrl: v.string() },
	handler: async (ctx, { quoteId, siteUrl }) => {
		const doc = await ctx.db.get(quoteId);
		if (!doc || doc.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		await ctx.db.patch(quoteId, { status: "sent", sentAt: Date.now() });
	},
});

export const markAccepted = mutation({
	args: { quoteId: v.id("quotes"), siteUrl: v.string() },
	handler: async (ctx, { quoteId, siteUrl }) => {
		const doc = await ctx.db.get(quoteId);
		if (!doc || doc.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		await ctx.db.patch(quoteId, { status: "accepted", acceptedAt: Date.now() });
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
		const quote = await ctx.db.get(quoteId);
		if (!quote || quote.siteUrl !== siteUrl) throw new Error("Not found");

		// Convert packages to invoice line items
		const items = quote.packages.map((pkg) => ({
			description: pkg.name + (pkg.description ? ` \u2014 ${pkg.description}` : ""),
			quantity: 1,
			unitPrice: pkg.price,
		}));

		// Create the invoice
		const invoiceId = await ctx.db.insert("invoices", {
			siteUrl: quote.siteUrl,
			invoiceNumber,
			clientId: quote.clientId,
			invoiceType,
			status: "draft",
			items,
			dueDate,
			notes: notes || quote.notes || undefined,
		});

		// Link the quote to the invoice
		await ctx.db.patch(quoteId, { convertedToInvoice: invoiceId });

		return invoiceId;
	},
});

export const markDeclined = mutation({
	args: { quoteId: v.id("quotes"), siteUrl: v.string() },
	handler: async (ctx, { quoteId, siteUrl }) => {
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
		const doc = await ctx.db.get(quoteId);
		if (!doc || doc.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		await ctx.db.delete(quoteId);
	},
});

// Quote presets
export const listPresets = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		return await ctx.db
			.query("quotePresets")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.collect();
	},
});

export const createPreset = mutation({
	args: {
		siteUrl: v.string(),
		name: v.string(),
		category: v.optional(v.union(v.literal("photography"), v.literal("web"))),
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
		return await ctx.db.insert("quotePresets", args);
	},
});

export const updatePreset = mutation({
	args: {
		presetId: v.id("quotePresets"),
		siteUrl: v.string(),
		name: v.optional(v.string()),
		category: v.optional(v.union(v.literal("photography"), v.literal("web"))),
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
		const doc = await ctx.db.get(presetId);
		if (!doc || doc.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		const patch: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(updates)) {
			if (val !== undefined) patch[key] = val;
		}
		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(presetId, patch);
		}
	},
});

export const removePreset = mutation({
	args: { presetId: v.id("quotePresets"), siteUrl: v.string() },
	handler: async (ctx, { presetId, siteUrl }) => {
		const doc = await ctx.db.get(presetId);
		if (!doc || doc.siteUrl !== siteUrl) {
			throw new Error("Not found");
		}
		await ctx.db.delete(presetId);
	},
});

export const getNextNumber = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const quotes = await ctx.db
			.query("quotes")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(1);

		const latest = quotes[0];
		if (!latest) return "QT-001";

		const num = Number.parseInt(latest.quoteNumber.replace("QT-", ""), 10);
		return `QT-${String(num + 1).padStart(3, "0")}`;
	},
});
