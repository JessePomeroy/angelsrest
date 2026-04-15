import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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

// Use siteUrl as the user key for notification tracking. The admin is
// single-user per site (authenticated via Better Auth session, not Convex
// identity), so siteUrl uniquely identifies the admin user. When client
// sites are onboarded with multiple admins, this will need to accept a
// userId arg from the client.

export const getUnreadFlags = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const userId = siteUrl;

		// Get all lastSeen records for this user+site
		const lastSeenRecords = await ctx.db
			.query("adminLastSeen")
			.withIndex("by_siteUrl_and_userId", (q) =>
				q.eq("siteUrl", siteUrl).eq("userId", userId),
			)
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

		// Quotes: any accepted/declined since last seen
		const quotesLastSeen = lastSeenMap.get("quotes") ?? 0;
		const recentQuotes = await ctx.db
			.query("quotes")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(10);
		for (const q of recentQuotes) {
			const actionTime = q.acceptedAt || q._creationTime;
			if (
				(q.status === "accepted" || q.status === "declined") &&
				actionTime > quotesLastSeen
			) {
				flags.quotes = true;
				break;
			}
		}

		// Invoices: any paid since last seen
		const invoicesLastSeen = lastSeenMap.get("invoices") ?? 0;
		const recentInvoices = await ctx.db
			.query("invoices")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(10);
		for (const inv of recentInvoices) {
			const actionTime = inv.paidAt || inv._creationTime;
			if (
				(inv.status === "paid" || inv.status === "overdue") &&
				actionTime > invoicesLastSeen
			) {
				flags.invoices = true;
				break;
			}
		}

		// Contracts: any signed since last seen
		const contractsLastSeen = lastSeenMap.get("contracts") ?? 0;
		const recentContracts = await ctx.db
			.query("contracts")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(10);
		for (const c of recentContracts) {
			const actionTime = c.signedAt || c._creationTime;
			if (c.status === "signed" && actionTime > contractsLastSeen) {
				flags.contracts = true;
				break;
			}
		}

		return flags;
	},
});

export const markSeen = mutation({
	args: {
		siteUrl: v.string(),
		page: v.string(),
	},
	handler: async (ctx, { siteUrl, page }) => {
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
