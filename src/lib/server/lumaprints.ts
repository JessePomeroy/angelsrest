// LumaPrints API client — server-only.
// See LUMAPRINTS.md for full spec and known issues.
//
// Ported from reflecting-pool's cleaner implementation per audit #22, with
// two upgrades over both the original angelsrest client and reflecting-pool:
//   - Uses $env/dynamic/private (not static) to match angelsrest's existing
//     env access pattern and test mocking setup.
//   - Sandbox switch is driven by an explicit LUMAPRINTS_USE_SANDBOX env var
//     instead of NODE_ENV or import.meta.env.DEV. Those build-mode flags are
//     both true only for `pnpm dev` and leave Vercel preview deployments
//     pointing at production LumaPrints — a silent footgun for any PR that
//     touches checkout. An explicit var lets each Vercel target (local,
//     preview, production) be configured independently.

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

/** Submit an order to LumaPrints */
export async function createOrder(order: LumaPrintsOrder): Promise<LumaPrintsOrderResponse> {
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
export async function getShipping(orderNumber: string): Promise<LumaPrintsShipment[]> {
	const res = await fetch(`${BASE_URL}/api/v1/orders/${orderNumber}/shipments`, {
		headers: getHeaders(),
	});
	if (!res.ok) {
		throw new LumaPrintsError(`Failed to get shipments for ${orderNumber}`);
	}
	return res.json();
}

/**
 * Pre-validate an image against a subcategory + desired print dimensions.
 * Called at checkout time to catch images that can't print cleanly BEFORE
 * the customer pays, instead of failing mid-webhook after payment.
 *
 * LumaPrints returns `{ valid: true }` when the image is suitable, or
 * `{ valid: false, message, recommendedWidth, recommendedHeight, expectedAspectRatio }`
 * when the image will be rejected (low resolution, wrong aspect ratio, etc.).
 *
 * Throws `LumaPrintsError` for network/server errors; these are transient
 * and should NOT block checkout (degrade gracefully — return { valid: true }
 * from the callsite if the API is down so checkout stays usable).
 */
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
	const res = await fetch(`${BASE_URL}/api/v1/images/checkImageConfig`, {
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

/**
 * Shipping method returned by LumaPrints' pricing endpoint. Multiple methods
 * are returned per quote (USPS ground/priority/express, FedEx ground/2-day/
 * overnight, etc.); the frontend picks one or shows all.
 */
export interface LumaPrintsShippingMethod {
	carrier: string;
	method: string;
	cost: number;
}

/**
 * Get shipping price estimates for a given basket + destination.
 * Returns all available shipping methods with their costs in USD.
 *
 * Called at checkout to show the customer real-time shipping costs before
 * they pay. If the call fails (network issue, LumaPrints 5xx), the caller
 * should fall back to a flat-rate shipping configured elsewhere — the
 * checkout flow must never be blocked on LumaPrints availability.
 *
 * Items use LumaPrints subcategoryIds and physical dimensions in inches.
 * Options arrays (e.g. `[39]` for No Bleed) match the ones used in
 * `buildLumaPrintsOrder()`.
 */
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
	const res = await fetch(`${BASE_URL}/api/v1/pricing/shipping`, {
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

/**
 * Build a LumaPrints order payload from our domain types.
 * Pure function — no network, no side effects. Testable in isolation.
 *
 * CRITICAL constraints:
 * - prepareSanityUrlForPrint() strips existing query params and appends
 *   `?max=8000&q=100` for maximum print quality. The default Sanity CDN
 *   URL serves a ~q80 compressed version that's noticeably below print
 *   quality, and the previous behavior here (just stripping params via
 *   cleanImageUrl) inherited that compression. See lumaprintsUrls.ts and
 *   memory `project_print_quality_q100` for the full decision context.
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
		orderItems: items.map((item, i) => {
			const isCanvas = typeof item.canvasSubcategoryId === "number" && item.canvasSubcategoryId > 0;
			const isFramed = typeof item.frameSubcategoryId === "number" && item.frameSubcategoryId > 0;
			// Priority: canvas > frame > paper subcategory
			const subcategoryId = isCanvas
				? item.canvasSubcategoryId!
				: isFramed
					? item.frameSubcategoryId!
					: item.paperSubcategoryId;
			// For bordered prints that were Sharp-composited, the imageUrl is
			// already an R2 URL — don't run it through prepareSanityUrlForPrint.
			const isBordered = typeof item.borderWidth === "number" && item.borderWidth > 0;
			const imageUrl = isBordered ? item.imageUrl : prepareSanityUrlForPrint(item.imageUrl);
			const options: number[] = [];
			if (isCanvas) {
				options.push(3); // Solid Color wrap (black)
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
			};
		}),
	};
}
