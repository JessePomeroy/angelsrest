import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { client as sanityClient } from "$lib/sanity/client";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function load() {
	const [orderStats, crmStats, invoices, quotes, newInquiryCount] =
		await Promise.all([
			convex.query(api.orders.getStats, { siteUrl: SITE_DOMAIN }),
			convex.query(api.crm.getStats, { siteUrl: SITE_DOMAIN }),
			convex.query(api.invoices.list, { siteUrl: SITE_DOMAIN }),
			convex.query(api.quotes.list, { siteUrl: SITE_DOMAIN }),
			sanityClient.fetch<number>(
				'count(*[_type == "inquiry" && status == "new"])',
			),
		]);

	// Invoice stats by status
	const invoiceStats = {
		draft: invoices.filter((i) => i.status === "draft").length,
		sent: invoices.filter((i) => i.status === "sent").length,
		paid: invoices.filter((i) => i.status === "paid").length,
		overdue: invoices.filter((i) => i.status === "overdue").length,
	};

	// Pending amount: draft + sent invoices
	const pendingInvoiceAmount = invoices
		.filter((i) => i.status === "draft" || i.status === "sent")
		.reduce((sum, inv) => {
			const invoiceTotal = inv.items.reduce(
				(t, item) => t + item.quantity * item.unitPrice,
				0,
			);
			return sum + invoiceTotal;
		}, 0);

	// Quote stats by status
	const quoteStats = {
		draft: quotes.filter((q) => q.status === "draft").length,
		sent: quotes.filter((q) => q.status === "sent").length,
		accepted: quotes.filter((q) => q.status === "accepted").length,
		declined: quotes.filter((q) => q.status === "declined").length,
	};

	// Activity feed: combine recent orders, invoices, quotes and take top 5
	const recentInvoices = invoices.slice(0, 5).map((inv) => ({
		type: "invoice" as const,
		description: `${inv.invoiceNumber} — ${inv.clientName}`,
		createdAt: new Date(inv._creationTime).toISOString(),
		status: inv.status,
	}));

	const recentQuoteItems = quotes.slice(0, 5).map((q) => ({
		type: "quote" as const,
		description: `${q.quoteNumber} — ${q.clientName}`,
		createdAt: new Date(q._creationTime).toISOString(),
		status: q.status,
	}));

	const recentOrderItems = orderStats.recentOrders.slice(0, 5).map((o) => ({
		type: "order" as const,
		description: `${o.orderNumber} — ${o.customerName || o.customerEmail}`,
		createdAt: o.createdAt,
		status: o.status,
	}));

	const activityFeed = [
		...recentOrderItems,
		...recentInvoices,
		...recentQuoteItems,
	]
		.sort(
			(a, b) =>
				new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
		)
		.slice(0, 5);

	return {
		stats: orderStats.stats,
		dailyRevenue: orderStats.dailyRevenue,
		recentOrders: orderStats.recentOrders,
		crmStats,
		invoiceStats,
		pendingInvoiceAmount,
		quoteStats,
		newInquiryCount,
		activityFeed,
	};
}
