import { json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";
import { verifyTurnstileToken } from "$lib/server/turnstile";
import { validateEmail } from "$lib/server/validation";

const MAX_EMAIL_LENGTH = 254;
const MAX_ORDER_NUMBER_LENGTH = 64;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function lookupJson(body: unknown, status = 200) {
	return json(body, { status, headers: NO_STORE_HEADERS });
}

/**
 * Shared POST lookup logic.
 *
 * Audit H34: keep email out of URLs so buyer PII does not land in
 * browser history, referrers, or access logs.
 */
async function lookupOrder(
	email: unknown,
	orderNumber: unknown,
	turnstileToken: unknown,
	remoteIp: string,
) {
	// Audit H34: reject obviously malformed input before hitting the
	// backend. Email must at minimum contain "@"; both fields required.
	if (typeof email !== "string" || typeof orderNumber !== "string") {
		return lookupJson({ error: "Email and order number required" }, 400);
	}
	const normalizedEmail = email.trim().toLowerCase();
	const normalizedOrderNumber = orderNumber.trim();
	if (!normalizedEmail || !normalizedOrderNumber) {
		return lookupJson({ error: "Email and order number required" }, 400);
	}
	if (
		normalizedEmail.length > MAX_EMAIL_LENGTH ||
		normalizedOrderNumber.length > MAX_ORDER_NUMBER_LENGTH
	) {
		return lookupJson({ error: "Invalid order details" }, 400);
	}
	if (!validateEmail(normalizedEmail)) {
		return lookupJson({ error: "Invalid email" }, 400);
	}

	const verification = await verifyTurnstileToken({ token: turnstileToken, remoteIp });
	if (!verification.success) {
		return lookupJson(
			{ error: "Verification failed" },
			verification.reason === "unavailable" ? 503 : 403,
		);
	}

	const lookupSecret = env.ORDER_LOOKUP_SECRET;
	if (!lookupSecret) {
		console.error("[orders/lookup] ORDER_LOOKUP_SECRET is not configured");
		return lookupJson({ error: "Order lookup is temporarily unavailable" }, 503);
	}

	try {
		const order = await getConvex().query(api.orders.lookupForCustomer, {
			siteUrl: SITE_DOMAIN,
			email: normalizedEmail,
			orderNumber: normalizedOrderNumber,
			lookupSecret,
		});

		if (!order) {
			return lookupJson({ error: "Order not found" }, 404);
		}

		return lookupJson({ order });
	} catch (err) {
		console.error("Order lookup error:", err);
		return lookupJson({ error: "Failed to look up order" }, 500);
	}
}

export function fallback() {
	return json(
		{ error: "Use POST to look up orders" },
		{ status: 405, headers: { ...NO_STORE_HEADERS, Allow: "POST" } },
	);
}

export async function POST({ request, getClientAddress }) {
	// Audit H34: POST body so email/orderNumber are not in access logs.
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return lookupJson({ error: "Invalid JSON body" }, 400);
	}
	const b = (body ?? {}) as Record<string, unknown>;
	return lookupOrder(b.email, b.orderNumber, b["cf-turnstile-response"], getClientAddress());
}
