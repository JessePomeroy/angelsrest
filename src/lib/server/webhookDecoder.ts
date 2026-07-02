/**
 * Session decoding helpers for the Stripe webhook.
 *
 * Pure functions that extract structured order data from Stripe checkout
 * session metadata. No network calls, no Convex, no side effects.
 */

import type Stripe from "stripe";
import {
	CART_METADATA_KEYS,
	decodeCartItemPayload,
	type LumaPrintsCartItemPayload,
} from "$lib/server/cartMetadataCodec";
import { FulfillmentValidationError } from "$lib/server/fulfillmentValidationError";
import type { OrderItem, Recipient } from "$lib/shop/types";
import type { ShippingDetails } from "./webhookEmails";

type StripeMetadata = Record<string, unknown>;

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
	if (meta[CART_METADATA_KEYS.isCart] === "true") {
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
	const count = Number.parseInt(String(meta[CART_METADATA_KEYS.itemCount] ?? "0"), 10);
	if (!Number.isFinite(count) || count <= 0) return [];

	const items: OrderItem[] = [];
	for (let i = 0; i < count; i++) {
		const parsed = decodeCartItemPayload(meta[CART_METADATA_KEYS.item(i)]);
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

function buildCartOrderItem(parsed: LumaPrintsCartItemPayload, imageUrl: string): OrderItem {
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
		throw new FulfillmentValidationError(
			`Malformed paper dimensions in Stripe session metadata: paperWidth=${JSON.stringify(meta.paperWidth)}`,
		);
	}
	if (!height) {
		throw new FulfillmentValidationError(
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
	const name = requiredString(shippingDetails?.name, "recipient.name");
	const address = shippingDetails?.address;
	const nameParts = name.split(/\s+/);
	return {
		firstName: nameParts[0] || "",
		lastName: nameParts.slice(1).join(" ") || "",
		address1: requiredString(address?.line1, "recipient.addressLine1"),
		address2: address?.line2?.trim() || "",
		city: requiredString(address?.city, "recipient.city"),
		state: requiredString(address?.state, "recipient.state"),
		zip: requiredString(address?.postal_code, "recipient.zipCode"),
		country: requiredString(address?.country, "recipient.country"),
	};
}

function requiredString(value: unknown, fieldName: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new FulfillmentValidationError(`${fieldName} is required for LumaPrints fulfillment`);
	}
	return value.trim();
}
