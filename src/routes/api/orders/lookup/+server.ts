import { json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function GET({ url }) {
	const email = url.searchParams.get("email");
	const orderNumber = url.searchParams.get("order");

	if (!email || !orderNumber) {
		return json({ error: "Email and order number required" }, { status: 400 });
	}

	try {
		const order = await convex.query(api.orders.lookup, {
			siteUrl: SITE_DOMAIN,
			email,
			orderNumber,
		});

		if (!order) {
			return json({ error: "Order not found" }, { status: 404 });
		}

		return json({ order });
	} catch (err) {
		console.error("Order lookup error:", err);
		return json({ error: "Failed to look up order" }, { status: 500 });
	}
}
