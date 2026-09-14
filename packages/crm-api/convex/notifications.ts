import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireSiteAdmin } from "./authHelpers";

const TRACKED_PAGES = [
	"orders",
	"inquiries",
	"messages",
	"crm",
	"quotes",
	"invoices",
	"contracts",
] as const;

type PageKey = (typeof TRACKED_PAGES)[number];

// Notification read state is shared by authorized admins of a site.

export const getUnreadFlags = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl);
		const userId = siteUrl;

		// Get all lastSeen records for this user+site
		const lastSeenRecords = await ctx.db
			.query("adminLastSeen")
			.withIndex("by_siteUrl_and_userId", (q) => q.eq("siteUrl", siteUrl).eq("userId", userId))
			.collect();

		const lastSeenMap = new Map<string, number>();
		for (const record of lastSeenRecords) {
			lastSeenMap.set(record.page, record.lastSeenAt);
		}

		const flags: Record<PageKey, boolean> = {
			orders: false,
			inquiries: false,
			messages: false,
			crm: false,
			quotes: false,
			invoices: false,
			contracts: false,
		};

		// Orders: any new order since last seen
		const ordersLastSeen = lastSeenMap.get("orders") ?? 0;
		const newOrder = await ctx.db
			.query("orders")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(1);
		if (newOrder[0] && newOrder[0]._creationTime > ordersLastSeen) {
			flags.orders = true;
		}

		// Inquiries: any new inquiry since last seen
		const inquiriesLastSeen = lastSeenMap.get("inquiries") ?? 0;
		const newInquiry = await ctx.db
			.query("inquiries")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(1);
		if (newInquiry[0] && newInquiry[0]._creationTime > inquiriesLastSeen) {
			flags.inquiries = true;
		}

		// Messages: any new message since last seen
		const messagesLastSeen = lastSeenMap.get("messages") ?? 0;
		const newMsg = await ctx.db
			.query("platformMessages")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(1);
		if (newMsg[0] && newMsg[0]._creationTime > messagesLastSeen) {
			flags.messages = true;
		}

		// CRM: any new lead since last seen
		const crmLastSeen = lastSeenMap.get("crm") ?? 0;
		const newLead = await ctx.db
			.query("photographyClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(1);
		if (newLead[0] && newLead[0]._creationTime > crmLastSeen) {
			flags.crm = true;
		}

		// Select transitions by their timestamps, regardless of document creation order.
		// Legacy records without a transition timestamp retain the creation-time fallback.
		const quotesLastSeen = lastSeenMap.get("quotes") ?? 0;
		flags.quotes = Boolean(
			(await ctx.db
				.query("quotes")
				.withIndex("by_siteUrl_and_status_and_acceptedAt", (q) =>
					q.eq("siteUrl", siteUrl).eq("status", "accepted").gt("acceptedAt", quotesLastSeen),
				)
				.first()) ||
				(await ctx.db
					.query("quotes")
					.withIndex("by_siteUrl_and_status_and_acceptedAt", (q) =>
						q
							.eq("siteUrl", siteUrl)
							.eq("status", "accepted")
							.eq("acceptedAt", undefined)
							.gt("_creationTime", quotesLastSeen),
					)
					.first()) ||
				(await ctx.db
					.query("quotes")
					.withIndex("by_siteUrl_and_status_and_declinedAt", (q) =>
						q.eq("siteUrl", siteUrl).eq("status", "declined").gt("declinedAt", quotesLastSeen),
					)
					.first()) ||
				(await ctx.db
					.query("quotes")
					.withIndex("by_siteUrl_and_status_and_declinedAt", (q) =>
						q
							.eq("siteUrl", siteUrl)
							.eq("status", "declined")
							.eq("declinedAt", undefined)
							.gt("_creationTime", quotesLastSeen),
					)
					.first()),
		);

		const invoicesLastSeen = lastSeenMap.get("invoices") ?? 0;
		flags.invoices = Boolean(
			(await ctx.db
				.query("invoices")
				.withIndex("by_siteUrl_and_status_and_paidAt", (q) =>
					q.eq("siteUrl", siteUrl).eq("status", "paid").gt("paidAt", invoicesLastSeen),
				)
				.first()) ||
				(await ctx.db
					.query("invoices")
					.withIndex("by_siteUrl_and_status_and_paidAt", (q) =>
						q
							.eq("siteUrl", siteUrl)
							.eq("status", "paid")
							.eq("paidAt", undefined)
							.gt("_creationTime", invoicesLastSeen),
					)
					.first()) ||
				(await ctx.db
					.query("invoices")
					.withIndex("by_siteUrl_and_status_and_overdueAt", (q) =>
						q.eq("siteUrl", siteUrl).eq("status", "overdue").gt("overdueAt", invoicesLastSeen),
					)
					.first()) ||
				(await ctx.db
					.query("invoices")
					.withIndex("by_siteUrl_and_status_and_overdueAt", (q) =>
						q
							.eq("siteUrl", siteUrl)
							.eq("status", "overdue")
							.eq("overdueAt", undefined)
							.gt("_creationTime", invoicesLastSeen),
					)
					.first()),
		);

		const contractsLastSeen = lastSeenMap.get("contracts") ?? 0;
		flags.contracts = Boolean(
			(await ctx.db
				.query("contracts")
				.withIndex("by_siteUrl_and_status_and_signedAt", (q) =>
					q.eq("siteUrl", siteUrl).eq("status", "signed").gt("signedAt", contractsLastSeen),
				)
				.first()) ||
				(await ctx.db
					.query("contracts")
					.withIndex("by_siteUrl_and_status_and_signedAt", (q) =>
						q
							.eq("siteUrl", siteUrl)
							.eq("status", "signed")
							.eq("signedAt", undefined)
							.gt("_creationTime", contractsLastSeen),
					)
					.first()),
		);

		return flags;
	},
});

export const markSeen = mutation({
	args: {
		siteUrl: v.string(),
		page: v.string(),
	},
	handler: async (ctx, { siteUrl, page }) => {
		await requireSiteAdmin(ctx, siteUrl);
		const userId = siteUrl;
		const now = Date.now();

		const existing = await ctx.db
			.query("adminLastSeen")
			.withIndex("by_siteUrl_and_userId_and_page", (q) =>
				q.eq("siteUrl", siteUrl).eq("userId", userId).eq("page", page),
			)
			.unique();

		if (existing) {
			await ctx.db.patch(existing._id, { lastSeenAt: now });
		} else {
			await ctx.db.insert("adminLastSeen", {
				siteUrl,
				userId,
				page,
				lastSeenAt: now,
			});
		}
	},
});
