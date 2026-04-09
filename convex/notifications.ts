import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./authHelpers";

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

export const getUnreadFlags = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return {
				orders: false,
				inquiries: false,
				messages: false,
				crm: false,
				quotes: false,
				invoices: false,
				contracts: false,
			};
		}

		const userId = identity.tokenIdentifier;

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

		// Messages: any unread client messages
		const unreadMsg = await ctx.db
			.query("platformMessages")
			.withIndex("by_siteUrl_unread", (q) =>
				q.eq("siteUrl", siteUrl).eq("read", false),
			)
			.take(1);
		if (unreadMsg.length > 0) {
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
			if (
				(q.status === "accepted" || q.status === "declined") &&
				q._creationTime > quotesLastSeen
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
			if (
				(inv.status === "paid" || inv.status === "overdue") &&
				inv._creationTime > invoicesLastSeen
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
			if (c.status === "signed" && c._creationTime > contractsLastSeen) {
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
		await requireAuth(ctx);
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) return;

		const userId = identity.tokenIdentifier;
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
