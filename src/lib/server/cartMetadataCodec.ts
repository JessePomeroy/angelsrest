import type { CartItem } from "$lib/shop/cart";

export const CART_METADATA_KEYS = {
	isCart: "isCart",
	itemCount: "cartItemCount",
	item: (index: number) => `cartItem_${index}`,
} as const;

/**
 * Safety margin for the cart item value size — leaves room for any future
 * fields without bumping us against Stripe's hard 500-char per-value cap.
 * Sets that pack many full-resolution image URLs into the `i` array will
 * be rejected by `validateCart` if their encoded payload exceeds this.
 */
export const CART_ITEM_PAYLOAD_MAX = 480;

export type CartItemMetadataPayload = {
	/** Cover/thumbnail image URL. */
	u: string;
	/** Cart line quantity. */
	q: number;
	/** LumaPrints paper subcategory ID. Missing means self-fulfilled merch. */
	s?: number;
	/** Print width in inches. */
	w?: number;
	/** Print height in inches. */
	h?: number;
	/** Print-set image URLs. */
	i?: string[];
	/** Border width in inches. */
	b?: number;
	/** Frame subcategory ID. */
	f?: number;
	/** Canvas subcategory ID. */
	c?: number;
	/** Canvas wrap color. */
	cw?: string;
};

export type LumaPrintsCartItemPayload = CartItemMetadataPayload &
	Required<Pick<CartItemMetadataPayload, "u" | "q" | "s" | "w" | "h">>;

export function encodeCartItemPayload(item: CartItem): CartItemMetadataPayload {
	const payload: CartItemMetadataPayload = {
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
	if (typeof item.frameSubcategoryId === "number" && item.frameSubcategoryId > 0) {
		payload.f = item.frameSubcategoryId;
	}
	if (typeof item.canvasSubcategoryId === "number" && item.canvasSubcategoryId > 0) {
		payload.c = item.canvasSubcategoryId;
		if (item.canvasWrapHex) {
			payload.cw = item.canvasWrapHex;
		}
	}
	if (item.type === "set" && item.imageUrls && item.imageUrls.length > 0) {
		payload.i = item.imageUrls;
	}
	return payload;
}

export function decodeCartItemPayload(raw: unknown): LumaPrintsCartItemPayload | null {
	if (typeof raw !== "string" || !raw) return null;
	try {
		// Compact representation from buildCartMetadata. Field semantics:
		//  - `u` always present: cover image (cart UI thumbnail)
		//  - `q` always present: cart line quantity
		//  - `s/w/h` for LumaPrints prints; absent -> self-fulfilled merch,
		//    skip the line entirely
		//  - `i` for print sets: array of image URLs to expand into one
		//    OrderItem per image, multiplied through by `q`
		const parsed = JSON.parse(raw) as Partial<CartItemMetadataPayload>;
		const hasRequiredCartFields = typeof parsed.u === "string" && typeof parsed.q === "number";
		const hasPaper =
			typeof parsed.s === "number" && typeof parsed.w === "number" && typeof parsed.h === "number";
		if (!hasRequiredCartFields || !hasPaper) {
			// Self-fulfilled merch — skip LumaPrints submission entirely.
			return null;
		}
		return parsed as LumaPrintsCartItemPayload;
	} catch {
		// Skip malformed entries — partial fulfillment is better than
		// throwing the entire order on the floor for one bad row.
		return null;
	}
}
