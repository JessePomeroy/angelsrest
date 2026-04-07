import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { client as sanityClient } from "$lib/sanity/client";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function load() {
	const [orders, crmStats, invoices, quotes, newInquiryCount] =
		await Promise.all([
			convex.query(api.orders.list, { siteUrl: SITE_DOMAIN }),
			convex.query(api.crm.getStats, { siteUrl: SITE_DOMAIN }),
			convex.query(api.invoices.list, { siteUrl: SITE_DOMAIN }),
			convex.query(api.quotes.list, { siteUrl: SITE_DOMAIN }),
			sanityClient.fetch<number>(
				'count(*[_type == "inquiry" && status == "new"])',
			),
		]);

	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const weekStart = new Date(todayStart);
	weekStart.setDate(todayStart.getDate() - todayStart.getDay());
	const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

	let todayRevenue = 0;
	let weekRevenue = 0;
	let monthRevenue = 0;
	let allTimeRevenue = 0;

	// Build daily revenue map for last 30 days
	const dailyRevenueMap = new Map<string, number>();
	for (let i = 29; i >= 0; i--) {
		const d = new Date(todayStart);
		d.setDate(d.getDate() - i);
		dailyRevenueMap.set(d.toISOString().split("T")[0], 0);
	}

	for (const order of orders) {
		const total = order.total || 0;
		allTimeRevenue += total;

		const orderDate = new Date(order._creationTime);
		if (orderDate >= todayStart) todayRevenue += total;
		if (orderDate >= weekStart) weekRevenue += total;
		if (orderDate >= monthStart) monthRevenue += total;

		const dateKey = orderDate.toISOString().split("T")[0];
		if (dailyRevenueMap.has(dateKey)) {
			dailyRevenueMap.set(dateKey, (dailyRevenueMap.get(dateKey) || 0) + total);
		}
	}

	const dailyRevenue = Array.from(dailyRevenueMap.entries()).map(
		([date, amount]) => ({
			date,
			amount,
		}),
	);

	const recentOrders = orders.slice(0, 10).map((order) => ({
		_id: order._id,
		orderNumber: order.orderNumber,
		createdAt: new Date(order._creationTime).toISOString(),
		customerEmail: order.customerEmail,
		customerName: order.customerName || "",
		total: order.total,
		stripeFees: order.stripeFees || 0,
		status: order.status,
	}));

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

	const recentOrderItems = orders.slice(0, 5).map((o) => ({
		type: "order" as const,
		description: `${o.orderNumber} — ${o.customerName || o.customerEmail}`,
		createdAt: new Date(o._creationTime).toISOString(),
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
		stats: {
			todayRevenue,
			weekRevenue,
			monthRevenue,
			allTimeRevenue,
			totalOrders: orders.length,
		},
		dailyRevenue,
		recentOrders,
		crmStats,
		invoiceStats,
		pendingInvoiceAmount,
		quoteStats,
		newInquiryCount,
		activityFeed,
	};
}
