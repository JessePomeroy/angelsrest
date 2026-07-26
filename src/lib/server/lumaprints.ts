// Server-only LumaPrints client; see LUMAPRINTS.md for integration constraints.

import { env } from "$env/dynamic/private";
import { prepareSanityUrlForPrint } from "$lib/shop/lumaprintsUrls";
import type {
	LumaPrintsOrder,
	LumaPrintsOrderResponse,
	LumaPrintsShipment,
	OrderItem,
	Recipient,
} from "$lib/shop/types";

const BASE_URL =
	env.LUMAPRINTS_USE_SANDBOX === "true"
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

const LUMAPRINTS_REQUEST_TIMEOUT_MS = 15_000;

async function fetchLumaPrints(path: string, init: RequestInit = {}): Promise<Response> {
	try {
		return await fetch(`${BASE_URL}${path}`, {
			...init,
			signal: AbortSignal.timeout(LUMAPRINTS_REQUEST_TIMEOUT_MS),
		});
	} catch (error) {
		const cause = error instanceof Error ? error.name : typeof error;
		const kind = cause === "TimeoutError" || cause === "AbortError" ? "timeout" : "network";
		throw new LumaPrintsError(
			kind === "timeout"
				? `LumaPrints request timed out after ${LUMAPRINTS_REQUEST_TIMEOUT_MS}ms`
				: "LumaPrints network request failed",
			{ kind, timeoutMs: LUMAPRINTS_REQUEST_TIMEOUT_MS, cause },
		);
	}
}

/** Submit an order to LumaPrints */
export async function createOrder(order: LumaPrintsOrder): Promise<LumaPrintsOrderResponse> {
	const res = await fetchLumaPrints("/api/v1/orders", {
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

/** Reconcile an uncertain submit by its stable external ID. */
export async function findOrderByExternalId(
	externalId: string,
): Promise<LumaPrintsOrderResponse | null> {
	const query = new URLSearchParams({ externalId, limit: "100" });
	const res = await fetchLumaPrints(`/api/v1/orders?${query}`, { headers: getHeaders() });
	if (!res.ok) throw new LumaPrintsError("Order reconciliation failed", { statusCode: res.status });
	const body = (await res.json()) as unknown;
	const rows = Array.isArray(body)
		? body
		: body && typeof body === "object"
			? ([(body as { orders?: unknown }).orders, (body as { data?: unknown }).data].find(
					(value): value is unknown[] => Array.isArray(value),
				) ?? null)
			: null;
	if (!rows) throw new LumaPrintsError("Order reconciliation response was malformed");
	const matches = rows.filter(
		(value): value is LumaPrintsOrderResponse & { externalId: string } =>
			Boolean(value) &&
			typeof value === "object" &&
			(value as { externalId?: unknown }).externalId === externalId &&
			typeof (value as { orderNumber?: unknown }).orderNumber === "string",
	);
	if (matches.length > 1) throw new LumaPrintsError("Order reconciliation was ambiguous");
	return matches[0] ?? null;
}

/** Get order status from LumaPrints */
export async function getOrder(
	orderNumber: string,
): Promise<{ orderNumber: string; status: string }> {
	const res = await fetchLumaPrints(`/api/v1/orders/${orderNumber}`, {
		headers: getHeaders(),
	});
	if (!res.ok) {
		throw new LumaPrintsError(`Failed to get order ${orderNumber}`);
	}
	return res.json();
}

/** Get shipment tracking for an order */
export async function getShipping(orderNumber: string): Promise<LumaPrintsShipment[]> {
	const res = await fetchLumaPrints(`/api/v1/orders/${orderNumber}/shipments`, {
		headers: getHeaders(),
	});
	if (!res.ok) {
		throw new LumaPrintsError(`Failed to get shipments for ${orderNumber}`);
	}
	return res.json();
}

/** Pre-validates a print image at checkout; provider failures remain typed. */
export async function checkImageConfig(input: {
	imageUrl: string;
	subcategoryId: number;
	width: number;
	height: number;
}): Promise<{
	valid: boolean;
	message?: string;
	recommendedWidth?: number;
	recommendedHeight?: number;
	expectedAspectRatio?: number;
}> {
	const res = await fetchLumaPrints("/api/v1/images/checkImageConfig", {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify({
			imageUrl: cleanImageUrl(input.imageUrl),
			subcategoryId: input.subcategoryId,
			width: input.width,
			height: input.height,
		}),
	});

	if (!res.ok) {
		const details = await res.json().catch(() => ({
			message: res.statusText,
		}));
		throw new LumaPrintsError("Image validation request failed", details);
	}

	return res.json();
}

/** Shipping method returned by the provider pricing endpoint. */
export interface LumaPrintsShippingMethod {
	carrier: string;
	method: string;
	cost: number;
}

/** Returns provider shipping prices; callers fail closed rather than inventing a fallback. */
export async function getShippingPrice(input: {
	items: Array<{
		subcategoryId: number;
		width: number;
		height: number;
		quantity: number;
		orderItemOptions?: number[];
	}>;
	recipient: Recipient;
}): Promise<{
	shippingMethods: LumaPrintsShippingMethod[];
}> {
	const res = await fetchLumaPrints("/api/v1/pricing/shipping", {
		method: "POST",
		headers: getHeaders(),
		body: JSON.stringify({
			storeId: Number(env.LUMAPRINTS_STORE_ID ?? 0),
			shippingMethod: "default",
			recipient: {
				firstName: input.recipient.firstName,
				lastName: input.recipient.lastName,
				addressLine1: input.recipient.address1,
				addressLine2: input.recipient.address2 || "",
				city: input.recipient.city,
				state: input.recipient.state,
				zipCode: input.recipient.zip,
				country: input.recipient.country,
				phone: input.recipient.phone || "",
			},
			orderItems: input.items.map((item) => ({
				subcategoryId: item.subcategoryId,
				quantity: item.quantity,
				width: item.width,
				height: item.height,
				orderItemOptions: item.orderItemOptions ?? [39],
			})),
		}),
	});

	if (!res.ok) {
		const details = await res.json().catch(() => ({
			message: res.statusText,
		}));
		throw new LumaPrintsError("Shipping price request failed", details);
	}

	return res.json();
}

/** Pure payload builder. Sanity sources retain print-quality transforms;
 * paper prints always use no-bleed option 39. See LUMAPRINTS.md. */
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
		orderItems: items.map((item, i) => {
			const isCanvas = typeof item.canvasSubcategoryId === "number" && item.canvasSubcategoryId > 0;
			const isFramed = typeof item.frameSubcategoryId === "number" && item.frameSubcategoryId > 0;
			// Priority: canvas > frame > paper subcategory
			const subcategoryId = isCanvas
				? (item.canvasSubcategoryId as number)
				: isFramed
					? (item.frameSubcategoryId as number)
					: item.paperSubcategoryId;
			const imageUrl =
				item.sourcePolicy === "sanity_cdn"
					? prepareSanityUrlForPrint(item.imageUrl)
					: item.imageUrl;
			const options: number[] = [];
			let solidColorHexCode: string | undefined;
			if (isCanvas) {
				options.push(3); // Solid Color wrap
				solidColorHexCode = item.canvasWrapHex || "#000000";
			} else {
				options.push(39); // No Bleed (fine art paper)
				if (isFramed) {
					options.push(67); // Mat size: 2"
					options.push(96); // Mat color: White
				}
			}
			return {
				externalItemId: `${externalId}-item-${i + 1}`,
				subcategoryId,
				quantity: item.quantity,
				width: item.width,
				height: item.height,
				file: { imageUrl },
				orderItemOptions: options,
				...(solidColorHexCode ? { solidColorHexCode } : {}),
			};
		}),
	};
}
