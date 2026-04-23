import { json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

/**
 * Shared lookup logic for both GET (legacy) and POST (preferred).
 *
 * Audit H34: centralize the verification + convex query so both
 * handlers apply identical input validation and error responses.
 */
async function lookupOrder(email: unknown, orderNumber: unknown) {
	// Audit H34: reject obviously malformed input before hitting the
	// backend. Email must at minimum contain "@"; both fields required.
	if (typeof email !== "string" || typeof orderNumber !== "string") {
		return json({ error: "Email and order number required" }, { status: 400 });
	}
	if (!email || !orderNumber) {
		return json({ error: "Email and order number required" }, { status: 400 });
	}
	if (!email.includes("@")) {
		return json({ error: "Invalid email" }, { status: 400 });
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

/**
 * @deprecated Audit H34: email in the query string lands in access logs.
 * Prefer POST with a JSON body. This handler is kept for backward
 * compatibility with any already-deployed links but delegates to the
 * shared lookup function.
 */
export async function GET({ url }) {
	const email = url.searchParams.get("email");
	const orderNumber = url.searchParams.get("order");
	return lookupOrder(email, orderNumber);
}

export async function POST({ request }) {
	// Audit H34: POST body so email/orderNumber are not in access logs.
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: "Invalid JSON body" }, { status: 400 });
	}
	const b = (body ?? {}) as Record<string, unknown>;
	return lookupOrder(b.email, b.orderNumber);
}
