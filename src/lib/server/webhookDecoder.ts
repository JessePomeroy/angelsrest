/**
 * Session decoding helpers for the Stripe webhook.
 *
 * Pure functions that extract structured order data from Stripe checkout
 * session metadata. No network calls, no Convex, no side effects.
 */

import type Stripe from "stripe";
import type { OrderItem, Recipient } from "$lib/shop/types";
import type { ShippingDetails } from "./webhookEmails";

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
	const meta = (session.metadata ?? {}) as Record<string, any>;

	// ─── Path 1: Cart (multi-item, per-line paper/size) ───────────────────
	if (meta.isCart === "true") {
		const count = Number.parseInt(meta.cartItemCount ?? "0", 10);
		if (!Number.isFinite(count) || count <= 0) return [];

		const items: OrderItem[] = [];
		for (let i = 0; i < count; i++) {
			const raw = meta[`cartItem_${i}`];
			if (typeof raw !== "string" || !raw) continue;
			try {
				// Compact representation from buildCartMetadata. Field semantics:
				//  - `u` always present: cover image (cart UI thumbnail)
				//  - `q` always present: cart line quantity
				//  - `s/w/h` for LumaPrints prints; absent → self-fulfilled merch,
				//    skip the line entirely
				//  - `i` for print sets: array of image URLs to expand into one
				//    OrderItem per image, multiplied through by `q`
				const parsed = JSON.parse(raw) as {
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
				if (typeof parsed.u !== "string" || typeof parsed.q !== "number") {
					continue;
				}
				const hasPaper =
					typeof parsed.s === "number" &&
					typeof parsed.w === "number" &&
					typeof parsed.h === "number";
				if (!hasPaper) {
					// Self-fulfilled merch — skip LumaPrints submission entirely.
					continue;
				}
				const border = typeof parsed.b === "number" && parsed.b > 0 ? parsed.b : undefined;
				const frame = typeof parsed.f === "number" && parsed.f > 0 ? parsed.f : undefined;
				const canvas = typeof parsed.c === "number" && parsed.c > 0 ? parsed.c : undefined;
				const canvasWrapHex = typeof parsed.cw === "string" ? parsed.cw : undefined;
				if (Array.isArray(parsed.i) && parsed.i.length > 0) {
					for (const url of parsed.i) {
						if (typeof url !== "string" || !url) continue;
						items.push({
							imageUrl: url,
							paperSubcategoryId: parsed.s as number,
							width: parsed.w as number,
							height: parsed.h as number,
							quantity: parsed.q,
							borderWidth: border,
							frameSubcategoryId: frame,
							canvasSubcategoryId: canvas,
							canvasWrapHex,
						});
					}
					continue;
				}
				items.push({
					imageUrl: parsed.u,
					paperSubcategoryId: parsed.s as number,
					width: parsed.w as number,
					height: parsed.h as number,
					quantity: parsed.q,
					borderWidth: border,
					frameSubcategoryId: frame,
					canvasSubcategoryId: canvas,
					canvasWrapHex,
				});
			} catch {
				// Skip malformed entries — partial fulfillment is better than
				// throwing the entire order on the floor for one bad row.
			}
		}
		return items;
	}

	// ─── Existing paths use top-level paperSubcategoryId ──────────────────
	const paperSubcategoryId = Number.parseInt(meta.paperSubcategoryId ?? "", 10);
	if (!paperSubcategoryId) return [];

	// Audit H37: throw instead of silently defaulting to 8×10. The
	// classify-and-refund path (audit #23 PR #3) will surface this to
	// the admin via email + auto-refund rather than printing the wrong
	// size. Only throws when this session has a paperSubcategoryId
	// (i.e. we're committed to a LumaPrints submission) — the
	// no-paperSubcategoryId early return above still handles the
	// digital/invoice/merch cases.
	const widthParsed = Number.parseInt(meta.paperWidth ?? "", 10);
	const heightParsed = Number.parseInt(meta.paperHeight ?? "", 10);
	if (!Number.isFinite(widthParsed) || widthParsed <= 0) {
		throw new Error(
			`Malformed paper dimensions in Stripe session metadata: paperWidth=${JSON.stringify(meta.paperWidth)}`,
		);
	}
	if (!Number.isFinite(heightParsed) || heightParsed <= 0) {
		throw new Error(
			`Malformed paper dimensions in Stripe session metadata: paperHeight=${JSON.stringify(meta.paperHeight)}`,
		);
	}
	const width = widthParsed;
	const height = heightParsed;

	const isPrintSet = meta.isPrintSet === "true";
	if (isPrintSet) {
		let imageUrls: string[] = [];
		try {
			imageUrls = JSON.parse(meta.imageUrls ?? "[]");
		} catch {
			imageUrls = [];
		}
		return imageUrls.map((imageUrl) => ({
			imageUrl,
			paperSubcategoryId,
			width,
			height,
			quantity: 1,
		}));
	}

	const imageUrl = meta.imageUrl ?? "";
	if (!imageUrl) return [];
	return [
		{
			imageUrl,
			paperSubcategoryId,
			width,
			height,
			quantity: lineItems[0]?.quantity ?? 1,
		},
	];
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
