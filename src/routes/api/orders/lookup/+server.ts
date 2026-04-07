import { json } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { env as publicEnv } from "$env/dynamic/public";
import { api } from "../../../../../convex/_generated/api";

const convex = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL!);

export async function GET({ url }) {
	const email = url.searchParams.get("email");
	const orderNumber = url.searchParams.get("order");

	if (!email || !orderNumber) {
		return json({ error: "Email and order number required" }, { status: 400 });
	}

	try {
		const order = await convex.query(api.orders.lookup, {
			siteUrl: "angelsrest.online",
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
