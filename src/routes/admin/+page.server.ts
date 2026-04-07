import { client } from "$lib/sanity/client";

export async function load() {
	const orders = await client.fetch(`
		*[_type == "order"] | order(createdAt desc) {
			_id, orderNumber, createdAt, customerEmail, customerName, total, stripeFees, status
		}
	`);

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

		const orderDate = new Date(order.createdAt);
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

	const recentOrders = orders.slice(0, 10);

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
	};
}
