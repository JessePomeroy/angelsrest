import type { CartItem } from "$lib/shop/cart";

export const CART_METADATA_KEYS = {
	isCart: "isCart",
	itemCount: "cartItemCount",
	item: (index: number) => `cartItem_${index}`,
} as const;

export const CART_ITEM_PAYLOAD_MAX = 480;

export type CartItemMetadataPayload = {
	u: string;
	q: number;
	s?: number;
	w?: number;
	h?: number;
	i?: string[];
	b?: number;
	f?: number;
	c?: number;
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
		const parsed = JSON.parse(raw) as Partial<CartItemMetadataPayload>;
		const hasRequiredCartFields = typeof parsed.u === "string" && typeof parsed.q === "number";
		const hasPaper =
			typeof parsed.s === "number" && typeof parsed.w === "number" && typeof parsed.h === "number";
		if (!hasRequiredCartFields || !hasPaper) {
			return null;
		}
		return parsed as LumaPrintsCartItemPayload;
	} catch {
		return null;
	}
}
