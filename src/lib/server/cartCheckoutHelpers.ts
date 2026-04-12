/**
 * Cart checkout pure helpers (cart PR C of the cart stack, extended in PR
 * D for non-print merch and PR E for print sets).
 *
 * Lives in its own module rather than inside `routes/api/cart/checkout/+server.ts`
 * because SvelteKit's `+server.ts` files only allow specific named exports
 * (HTTP method handlers + underscore-prefixed names). Putting the pure
 * validation and metadata-encoding helpers here keeps the test file
 * importing from a normal module while the endpoint stays a thin shell.
 *
 * The metadata contract encoded by `buildCartMetadata` is paired with
 * the cart-shape decoder in `routes/api/webhooks/stripe/+server.ts`
 * (`buildOrderItemsFromSession`). Any change here MUST be matched there.
 */

import type { CartItem } from "$lib/shop/cart";

/** Stripe metadata per-value limit. */
const STRIPE_METADATA_VALUE_MAX = 500;

/**
 * Safety margin for the cart item value size — leaves room for any future
 * fields without bumping us against Stripe's hard 500-char per-value cap.
 * Sets that pack many full-resolution image URLs into the `i` array will
 * be rejected by `validateCart` if their encoded payload exceeds this.
 */
export const CART_ITEM_PAYLOAD_MAX = 480;

/**
 * Build the compact per-item metadata payload that the webhook will
 * decode. Stripe metadata constraints relevant here:
 *
 *  - 50 keys max per metadata object
 *  - 500 char max per value
 *  - Each key string ≤ 40 chars
 *
 * To stay under those limits with realistic Sanity CDN URLs (~90 chars),
 * each cart item gets its own metadata key `cartItem_{n}` containing a
 * compact JSON object with abbreviated keys:
 *
 *   { u: imageUrl, q: quantity, s?: subcategoryId, w?: width, h?: height, i?: imageUrls[] }
 *
 * Field semantics:
 *  - `u` is the cover image used by the cart UI thumbnail
 *  - `q` is the cart line quantity (multiplied through to LumaPrints)
 *  - `s/w/h` are present for LumaPrints prints, omitted for self-fulfilled
 *    merch (tapestries etc.) — the webhook decoder uses the absence of `s`
 *    as the signal to skip LumaPrints submission for that line
 *  - `i` is present for print sets — the full array of image URLs to
 *    submit to LumaPrints, with one OrderItem per image at quantity `q`
 *
 * Reserving ~10 keys for non-cart metadata leaves ~40 cart-item slots —
 * enforced by the 40-item cap in `validateCart`.
 */
export function buildCartMetadata(items: CartItem[]): Record<string, string> {
	const meta: Record<string, string> = {
		isCart: "true",
		cartItemCount: String(items.length),
	};
	items.forEach((item, i) => {
		const payload: Record<string, unknown> = {
			u: item.imageUrl,
			q: item.quantity,
		};
		if (typeof item.paperSubcategoryId === "number") {
			payload.s = item.paperSubcategoryId;
			payload.w = item.paperWidth;
			payload.h = item.paperHeight;
		}
		if (typeof item.borderWidth === "number" && item.borderWidth > 0) {
			payload.b = item.borderWidth;
		}
		if (
			typeof item.frameSubcategoryId === "number" &&
			item.frameSubcategoryId > 0
		) {
			payload.f = item.frameSubcategoryId;
		}
		if (
			typeof item.canvasSubcategoryId === "number" &&
			item.canvasSubcategoryId > 0
		) {
			payload.c = item.canvasSubcategoryId;
		}
		if (item.type === "set" && item.imageUrls && item.imageUrls.length > 0) {
			payload.i = item.imageUrls;
		}
		meta[`cartItem_${i}`] = JSON.stringify(payload);
	});
	return meta;
}

/**
 * Validate the incoming cart payload. Returns an error message string
 * on validation failure, or null when the cart is shippable.
 *
 * Runs at the trust boundary, so it has to defend against shapes that
 * the TS types claim can't happen — clients can send anything.
 *
 * Paper fields are validated only when present. Non-print merch
 * (tapestries etc.) is identified by the absence of `paperSubcategoryId`
 * and skips the paper-shape checks. Print items must still provide a
 * complete and consistent paper config or they're rejected.
 *
 * Print sets (`type: "set"`) require a non-empty `imageUrls` array. The
 * encoded metadata payload size is checked against Stripe's 500-char
 * per-value cap because sets with many full-resolution image URLs can
 * blow past it — for those, the only supported path right now is the
 * legacy single-set Buy Now flow, which encodes the same data into
 * top-level metadata keys instead of one cart-item value.
 */
export function validateCart(items: unknown): string | null {
	if (!Array.isArray(items)) return "items must be an array";
	if (items.length === 0) return "cart is empty";
	if (items.length > 40) {
		// Stripe metadata limit guard — see `buildCartMetadata` comment.
		return "cart is too large (max 40 items per checkout)";
	}
	for (const item of items as CartItem[]) {
		if (!item || typeof item !== "object") return "invalid cart item";
		if (item.type !== "print" && item.type !== "set") {
			return "invalid cart item type";
		}
		if (typeof item.imageUrl !== "string" || !item.imageUrl) {
			return "cart item missing imageUrl";
		}
		if (item.type === "set") {
			if (!Array.isArray(item.imageUrls) || item.imageUrls.length === 0) {
				return "set cart item missing imageUrls";
			}
			for (const url of item.imageUrls) {
				if (typeof url !== "string" || !url) {
					return "set cart item has invalid imageUrls entry";
				}
			}
		}
		// Paper fields are optional, but if any are present they must ALL
		// be present and well-formed — partial paper config is a bug.
		const hasPaperSubcategory = typeof item.paperSubcategoryId === "number";
		const hasPaperWidth = typeof item.paperWidth === "number";
		const hasPaperHeight = typeof item.paperHeight === "number";
		const anyPaper = hasPaperSubcategory || hasPaperWidth || hasPaperHeight;
		const allPaper = hasPaperSubcategory && hasPaperWidth && hasPaperHeight;
		if (anyPaper && !allPaper) {
			return "cart item has incomplete paper config";
		}
		if (hasPaperWidth && (item.paperWidth as number) <= 0) {
			return "cart item has invalid paperWidth";
		}
		if (hasPaperHeight && (item.paperHeight as number) <= 0) {
			return "cart item has invalid paperHeight";
		}
		if (
			typeof item.quantity !== "number" ||
			item.quantity < 1 ||
			!Number.isInteger(item.quantity)
		) {
			return "cart item quantity must be a positive integer";
		}
		if (
			typeof item.unitPriceCents !== "number" ||
			item.unitPriceCents < 0 ||
			!Number.isInteger(item.unitPriceCents)
		) {
			return "cart item unitPriceCents must be a non-negative integer";
		}
	}
	// After per-item validation, size-check the encoded metadata payload.
	// Sets with many full-resolution image URLs can blow past Stripe's
	// 500-char per-value cap — reject early with a clear message instead
	// of letting the Stripe API reject the whole checkout call later.
	const meta = buildCartMetadata(items as CartItem[]);
	for (const [key, value] of Object.entries(meta)) {
		if (key.startsWith("cartItem_") && value.length > CART_ITEM_PAYLOAD_MAX) {
			return "set has too many images for cart checkout — please use Buy Now";
		}
		if (value.length > STRIPE_METADATA_VALUE_MAX) {
			return "cart item payload exceeds Stripe metadata limit";
		}
	}
	return null;
}
