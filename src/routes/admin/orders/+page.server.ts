import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function load() {
	const rawOrders = await convex.query(api.orders.list, {
		siteUrl: SITE_DOMAIN,
	});

	// Map Convex format to match what the orders page expects
	const orders = rawOrders.map((order) => ({
		_id: order._id,
		orderNumber: order.orderNumber,
		createdAt: new Date(order._creationTime).toISOString(),
		customerEmail: order.customerEmail,
		customerName: order.customerName || "",
		total: order.total,
		stripeFees: order.stripeFees || 0,
		status: order.status,
		currency: "usd",
		items: order.items,
		shippingAddress: order.shippingAddress || null,
		notes: order.notes || "",
	}));

	return { orders };
}
