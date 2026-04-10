// LumaPrints API client — server-only.
// See LUMAPRINTS.md for full spec and known issues.
//
// Ported from reflecting-pool's cleaner implementation per audit #22.
// Key differences from reflecting-pool:
//   - Uses $env/dynamic/private (not static) to match angelsrest's existing
//     env access pattern and test mocking setup.
//   - Sandbox switch uses NODE_ENV at runtime instead of Vite's import.meta.

import { env } from "$env/dynamic/private";
import type {
	LumaPrintsOrder,
	LumaPrintsOrderResponse,
	LumaPrintsShipment,
	OrderItem,
	Recipient,
} from "$lib/shop/types";

const BASE_URL =
	process.env.NODE_ENV === "development"
		? "https://us.api-sandbox.lumaprints.com"
		: "https://us.api.lumaprints.com";

function getHeaders(): HeadersInit {
	const apiKey = env.LUMAPRINTS_API_KEY ?? "";
	const apiSecret = env.LUMAPRINTS_API_SECRET ?? "";
	return {
		"Content-Type": "application/json",
		Authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}`,
	};
}

/**
 * CRITICAL: Strip ALL query params from Sanity image URLs before sending
 * to LumaPrints. Query params (`?w=1200&fm=webp`) cause aspect-ratio
 * validation errors on the LumaPrints side. The raw Sanity CDN URL serves
 * JPEG by default — no format param needed. See LUMAPRINTS.md for the
 * full postmortem.
 */
export function cleanImageUrl(url: string): string {
	return url.split("?")[0];
}

/** Custom error class carrying LumaPrints API response details */
export class LumaPrintsError extends Error {
	details: unknown;
	constructor(message: string, details?: unknown) {
		super(message);
		this.name = "LumaPrintsError";
		this.details = details;
	}
}

/** Submit an order to LumaPrints */
export async function createOrder(
	order: LumaPrintsOrder,
): Promise<LumaPrintsOrderResponse> {
	const res = await fetch(`${BASE_URL}/api/v1/orders`, {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify(order),
	});

	if (!res.ok) {
		const details = await res.json().catch(() => ({ message: res.statusText }));
		throw new LumaPrintsError("Order submission failed", details);
	}

	return res.json();
}

/** Get order status from LumaPrints */
export async function getOrder(
	orderNumber: string,
): Promise<{ orderNumber: string; status: string }> {
	const res = await fetch(`${BASE_URL}/api/v1/orders/${orderNumber}`, {
		headers: getHeaders(),
	});
	if (!res.ok) {
		throw new LumaPrintsError(`Failed to get order ${orderNumber}`);
	}
	return res.json();
}

/** Get shipment tracking for an order */
export async function getShipping(
	orderNumber: string,
): Promise<LumaPrintsShipment[]> {
	const res = await fetch(
		`${BASE_URL}/api/v1/orders/${orderNumber}/shipments`,
		{ headers: getHeaders() },
	);
	if (!res.ok) {
		throw new LumaPrintsError(`Failed to get shipments for ${orderNumber}`);
	}
	return res.json();
}

/**
 * Build a LumaPrints order payload from our domain types.
 * Pure function — no network, no side effects. Testable in isolation.
 *
 * CRITICAL constraints:
 * - cleanImageUrl() strips query params from all image URLs
 * - ALWAYS uses option 39 (No Bleed) — never option 36, which triggers
 *   aspect-ratio validation errors. See LUMAPRINTS.md "Known Issues".
 */
export function buildLumaPrintsOrder(
	externalId: string,
	recipient: Recipient,
	items: OrderItem[],
): LumaPrintsOrder {
	return {
		externalId,
		storeId: Number(env.LUMAPRINTS_STORE_ID ?? 0),
		shippingMethod: "default",
		recipient: {
			firstName: recipient.firstName,
			lastName: recipient.lastName,
			addressLine1: recipient.address1,
			addressLine2: recipient.address2 || "",
			city: recipient.city,
			state: recipient.state,
			zipCode: recipient.zip,
			country: recipient.country,
			phone: recipient.phone || "",
		},
		orderItems: items.map((item, i) => ({
			externalItemId: `${externalId}-item-${i + 1}`,
			subcategoryId: item.paperSubcategoryId,
			quantity: item.quantity,
			width: item.width,
			height: item.height,
			file: {
				imageUrl: cleanImageUrl(item.imageUrl), // CRITICAL: strip query params
			},
			orderItemOptions: [39], // ALWAYS No Bleed (option 39)
		})),
	};
}
