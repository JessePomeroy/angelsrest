/**
 * Checkout-time shipping price endpoint.
 *
 * Called by the shop configurator after the customer enters a shipping
 * address. Calls LumaPrints' `/pricing/shipping` endpoint to
 * get real-time shipping method options + costs for the specific basket
 * and destination, then returns them to the frontend.
 *
 * Returns `{ shippingMethods: [{ carrier, method, cost }, ...] }` when
 * LumaPrints responds. If the upstream quote is unavailable, returns HTTP 503
 * so the frontend can show an honest retry state instead of inventing a price.
 */

import { error, json } from "@sveltejs/kit";
import { logStructured } from "$lib/server/logger";
import { getShippingPrice, LumaPrintsError } from "$lib/server/lumaprints";
import type { Recipient } from "$lib/shop/types";
import type { RequestHandler } from "./$types";

interface ShippingPriceRequest {
	items: Array<{
		subcategoryId: number;
		width: number;
		height: number;
		quantity: number;
		orderItemOptions?: number[];
	}>;
	recipient: Recipient;
}

function isValidRequest(body: unknown): body is ShippingPriceRequest {
	if (!body || typeof body !== "object") return false;
	const b = body as Record<string, unknown>;

	if (!Array.isArray(b.items) || b.items.length === 0) return false;
	for (const item of b.items) {
		if (!item || typeof item !== "object") return false;
		const i = item as Record<string, unknown>;
		if (
			typeof i.subcategoryId !== "number" ||
			typeof i.width !== "number" ||
			typeof i.height !== "number" ||
			typeof i.quantity !== "number" ||
			i.quantity < 1
		) {
			return false;
		}
	}

	if (!b.recipient || typeof b.recipient !== "object") return false;
	const r = b.recipient as Record<string, unknown>;
	return (
		typeof r.firstName === "string" &&
		typeof r.lastName === "string" &&
		typeof r.address1 === "string" &&
		typeof r.city === "string" &&
		typeof r.state === "string" &&
		typeof r.zip === "string" &&
		typeof r.country === "string"
	);
}

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, "Invalid JSON body");
	}

	if (!isValidRequest(body)) {
		throw error(
			400,
			"Missing or invalid fields: items (non-empty array with subcategoryId/width/height/quantity) + recipient (firstName/lastName/address1/city/state/zip/country)",
		);
	}

	try {
		const result = await getShippingPrice({
			items: body.items,
			recipient: body.recipient,
		});
		return json(result);
	} catch (err) {
		// Do not silently fall back to a flat rate: that hides the pricing delta.
		// Surface a 503 so the customer can retry an honest upstream quote.
		logStructured({
			event: "shipping_price.upstream_failed",
			stage: "lumaprints_shipping",
			level: "error",
			error: err,
			meta: {
				kind: err instanceof LumaPrintsError ? "lumaprints" : "unknown",
				details: err instanceof LumaPrintsError ? err.details : undefined,
			},
		});
		throw error(503, "Shipping price unavailable; please try again in a minute.");
	}
};
