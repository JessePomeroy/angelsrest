/**
 * Cart checkout pure helpers (cart PR C of the cart stack).
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
 *   { u: imageUrl, s: subcategoryId, w: widthInches, h: heightInches, q: quantity }
 *
 * Paper fields (`s`, `w`, `h`) are omitted for non-print merch (tapestries,
 * etc.) — the webhook decoder uses the absence of `s` as the signal to
 * skip LumaPrints submission for that line.
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
		if (item.type === "set") {
			return "print sets in cart are not yet supported (cart PR E)";
		}
		if (item.type !== "print") return "invalid cart item type";
		if (typeof item.imageUrl !== "string" || !item.imageUrl) {
			return "cart item missing imageUrl";
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
	return null;
}
