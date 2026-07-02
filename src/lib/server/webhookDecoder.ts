/**
 * Session decoding helpers for the Stripe webhook.
 *
 * Pure functions that extract structured order data from Stripe checkout
 * session metadata. No network calls, no Convex, no side effects.
 */

import type Stripe from "stripe";
import type { OrderItem, Recipient } from "$lib/shop/types";
import type { ShippingDetails } from "./webhookEmails";

type StripeMetadata = Record<string, unknown>;

type CartItemPayload = {
	u?: string;
	s?: number;
	w?: number;
	h?: number;
	q?: number;
	i?: string[];
	b?: number;
	f?: number;
	c?: number;
	cw?: string;
};

type PrintOptions = Pick<
	OrderItem,
	| "paperSubcategoryId"
	| "width"
	| "height"
	| "borderWidth"
	| "frameSubcategoryId"
	| "canvasSubcategoryId"
	| "canvasWrapHex"
>;

/**
 * Build the list of LumaPrints order items from Stripe checkout metadata.
 *
 * Handles three shapes of order:
 *   - **Cart** (added cart PR C): `metadata.isCart === "true"` with one
 *     `cartItem_{n}` JSON entry per line. Each cart item carries its own
 *     paper/size, so this branch ignores the top-level paper metadata.
 *     Encoding contract is shared with `buildCartMetadata` in
 *     `src/routes/api/cart/checkout/+server.ts` — keep them in sync.
 *   - **Print set:** `metadata.isPrintSet === "true"` with an `imageUrls`
 *     JSON array, one LumaPrints item per image, same paper/size for
 *     every image. Reads paper from top-level metadata.
 *   - **Single print:** one item built from `metadata.imageUrl` + the
 *     first line item for the quantity. Reads paper from top-level metadata.
 *
 * Returns an empty array when there's nothing to fulfill (no LumaPrints
 * items in the order, e.g. digital-only or invoice payments). Caller
 * treats that as a short-circuit.
 *
 * Pure-ish: no network, no Convex, no fetch. Testable in isolation once
 * the session/lineItems shapes are known.
 */
export function buildOrderItemsFromSession(
	session: Stripe.Checkout.Session,
	lineItems: Stripe.LineItem[],
): OrderItem[] {
	const meta = (session.metadata ?? {}) as StripeMetadata;

	// ─── Path 1: Cart (multi-item, per-line paper/size) ───────────────────
	if (meta.isCart === "true") {
		return buildCartOrderItems(meta);
	}

	// ─── Existing paths use top-level paperSubcategoryId ──────────────────
	const printOptions = buildTopLevelPrintOptions(meta);
	if (!printOptions) return [];

	const isPrintSet = meta.isPrintSet === "true";
	if (isPrintSet) {
		return buildPrintSetOrderItems(meta, printOptions);
	}

	return buildSinglePrintOrderItems(meta, lineItems, printOptions);
}

function buildCartOrderItems(meta: StripeMetadata): OrderItem[] {
	const count = Number.parseInt(String(meta.cartItemCount ?? "0"), 10);
	if (!Number.isFinite(count) || count <= 0) return [];

	const items: OrderItem[] = [];
	for (let i = 0; i < count; i++) {
		const parsed = parseCartItemPayload(meta[`cartItem_${i}`]);
		if (!parsed) continue;

		if (Array.isArray(parsed.i) && parsed.i.length > 0) {
			for (const url of parsed.i) {
				if (typeof url !== "string" || !url) continue;
				items.push(buildCartOrderItem(parsed, url));
			}
			continue;
		}

		items.push(buildCartOrderItem(parsed, parsed.u));
	}
	return items;
}

function parseCartItemPayload(
	raw: unknown,
): (Required<Pick<CartItemPayload, "u" | "s" | "w" | "h" | "q">> & CartItemPayload) | null {
	if (typeof raw !== "string" || !raw) return null;
	try {
		// Compact representation from buildCartMetadata. Field semantics:
		//  - `u` always present: cover image (cart UI thumbnail)
		//  - `q` always present: cart line quantity
		//  - `s/w/h` for LumaPrints prints; absent → self-fulfilled merch,
		//    skip the line entirely
		//  - `i` for print sets: array of image URLs to expand into one
		//    OrderItem per image, multiplied through by `q`
		const parsed = JSON.parse(raw) as CartItemPayload;
		const hasRequiredCartFields = typeof parsed.u === "string" && typeof parsed.q === "number";
		const hasPaper =
			typeof parsed.s === "number" && typeof parsed.w === "number" && typeof parsed.h === "number";
		if (!hasRequiredCartFields || !hasPaper) {
			// Self-fulfilled merch — skip LumaPrints submission entirely.
			return null;
		}
		return parsed as Required<Pick<CartItemPayload, "u" | "s" | "w" | "h" | "q">> & CartItemPayload;
	} catch {
		// Skip malformed entries — partial fulfillment is better than
		// throwing the entire order on the floor for one bad row.
		return null;
	}
}

function buildCartOrderItem(
	parsed: Required<Pick<CartItemPayload, "s" | "w" | "h" | "q">> & CartItemPayload,
	imageUrl: string,
): OrderItem {
	return {
		imageUrl,
		paperSubcategoryId: parsed.s,
		width: parsed.w,
		height: parsed.h,
		quantity: parsed.q,
		borderWidth: typeof parsed.b === "number" ? positiveNumber(parsed.b) : undefined,
		frameSubcategoryId: typeof parsed.f === "number" ? positiveInteger(parsed.f) : undefined,
		canvasSubcategoryId: typeof parsed.c === "number" ? positiveInteger(parsed.c) : undefined,
		canvasWrapHex: typeof parsed.cw === "string" ? parsed.cw : undefined,
	};
}

function buildTopLevelPrintOptions(meta: StripeMetadata): PrintOptions | null {
	const paperSubcategoryId = positiveInteger(meta.paperSubcategoryId);
	if (!paperSubcategoryId) return null;

	// Audit H37: throw instead of silently defaulting to 8×10. The
	// classify-and-refund path (audit #23 PR #3) will surface this to
	// the admin via email + auto-refund rather than printing the wrong
	// size. Only throws when this session has a paperSubcategoryId
	// (i.e. we're committed to a LumaPrints submission) — the
	// no-paperSubcategoryId early return above still handles the
	// digital/invoice/merch cases.
	const width = positiveInteger(meta.paperWidth);
	const height = positiveInteger(meta.paperHeight);
	if (!width) {
		throw new Error(
			`Malformed paper dimensions in Stripe session metadata: paperWidth=${JSON.stringify(meta.paperWidth)}`,
		);
	}
	if (!height) {
		throw new Error(
			`Malformed paper dimensions in Stripe session metadata: paperHeight=${JSON.stringify(meta.paperHeight)}`,
		);
	}

	return {
		paperSubcategoryId,
		width,
		height,
		borderWidth: positiveNumber(meta.borderWidth),
		frameSubcategoryId: positiveInteger(meta.frameSubcategoryId),
		canvasSubcategoryId: positiveInteger(meta.canvasSubcategoryId),
		canvasWrapHex: typeof meta.canvasWrapHex === "string" ? meta.canvasWrapHex : undefined,
	};
}

function buildPrintSetOrderItems(meta: StripeMetadata, printOptions: PrintOptions): OrderItem[] {
	return parseImageUrls(meta.imageUrls).map((imageUrl) => ({
		imageUrl,
		...printOptions,
		quantity: 1,
	}));
}

function parseImageUrls(raw: unknown): string[] {
	try {
		const parsed = JSON.parse(typeof raw === "string" ? raw : "[]");
		return Array.isArray(parsed) ? parsed.filter((imageUrl) => typeof imageUrl === "string") : [];
	} catch {
		return [];
	}
}

function buildSinglePrintOrderItems(
	meta: StripeMetadata,
	lineItems: Stripe.LineItem[],
	printOptions: PrintOptions,
): OrderItem[] {
	const imageUrl = typeof meta.imageUrl === "string" ? meta.imageUrl : "";
	if (!imageUrl) return [];
	return [
		{
			imageUrl,
			...printOptions,
			quantity: lineItems[0]?.quantity ?? 1,
		},
	];
}

function positiveInteger(raw: unknown): number | undefined {
	const parsed = Number.parseInt(String(raw ?? ""), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function positiveNumber(raw: unknown): number | undefined {
	const parsed = Number.parseFloat(String(raw ?? ""));
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Build a LumaPrints recipient from Stripe shipping details. */
export function buildRecipientFromShipping(shippingDetails: ShippingDetails): Recipient {
	const nameParts = (shippingDetails?.name || "").split(" ");
	return {
		firstName: nameParts[0] || "",
		lastName: nameParts.slice(1).join(" ") || "",
		address1: shippingDetails?.address?.line1 || "",
		address2: shippingDetails?.address?.line2 || "",
		city: shippingDetails?.address?.city || "",
		state: shippingDetails?.address?.state || "",
		zip: shippingDetails?.address?.postal_code || "",
		country: shippingDetails?.address?.country || "US",
	};
}
