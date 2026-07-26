import {
	CART_ITEM_PAYLOAD_MAX,
	CART_METADATA_KEYS,
	encodeCartItemPayload,
} from "$lib/server/cartMetadataCodec";
import { buildTenantCheckoutOptions, type StripeTenantAccount } from "$lib/server/stripeConnect";
import { type CartItem, MAX_QUANTITY_PER_LINE } from "$lib/shop/cart";

export interface HandleCartIntent {
	productSlug: string;
	type: "print" | "set";
	quantity: number;
	paperSlug?: string;
	sizeSlug?: string;
	paperIndex?: number;
	borderWidthValue?: string;
	frameValue?: string;
}

export { CART_ITEM_PAYLOAD_MAX } from "$lib/server/cartMetadataCodec";

const STRIPE_METADATA_VALUE_MAX = 500;

export function calculateCartPrintSubtotalCents(items: CartItem[]): number {
	return items.reduce((total, item) => {
		const isPrintLine = typeof item.paperSubcategoryId === "number";
		if (!isPrintLine) return total;
		return total + item.unitPriceCents * item.quantity;
	}, 0);
}

export function buildCartTenantCheckoutOptions({
	items,
	tenant,
}: {
	items: CartItem[];
	tenant: StripeTenantAccount;
}) {
	return buildTenantCheckoutOptions({
		tenant,
		kind: "print",
		subtotalCents: calculateCartPrintSubtotalCents(items),
	});
}

export function buildCartMetadata(items: CartItem[]): Record<string, string> {
	const meta: Record<string, string> = {
		[CART_METADATA_KEYS.isCart]: "true",
		[CART_METADATA_KEYS.itemCount]: String(items.length),
	};
	items.forEach((item, i) => {
		meta[CART_METADATA_KEYS.item(i)] = JSON.stringify(encodeCartItemPayload(item));
	});
	return meta;
}

export function parseHandleCartIntent(items: unknown): HandleCartIntent[] | null {
	if (!Array.isArray(items) || items.length < 1 || items.length > 40) return null;
	const parsed: HandleCartIntent[] = [];
	for (const value of items) {
		if (!value || typeof value !== "object" || Array.isArray(value)) return null;
		const item = value as Record<string, unknown>;
		if (
			typeof item.productSlug !== "string" ||
			!item.productSlug.trim() ||
			(item.type !== "print" && item.type !== "set") ||
			!Number.isInteger(item.quantity) ||
			Number(item.quantity) < 1 ||
			Number(item.quantity) > MAX_QUANTITY_PER_LINE
		)
			return null;
		const intent: HandleCartIntent = {
			productSlug: item.productSlug.trim(),
			type: item.type,
			quantity: Number(item.quantity),
		};
		for (const key of ["paperSlug", "sizeSlug", "borderWidthValue", "frameValue"] as const) {
			const candidate = item[key];
			if (candidate !== undefined) {
				if (typeof candidate !== "string" || !candidate) return null;
				intent[key] = candidate;
			}
		}
		if (item.paperIndex !== undefined) {
			if (!Number.isInteger(item.paperIndex) || Number(item.paperIndex) < 0) return null;
			intent.paperIndex = Number(item.paperIndex);
		}
		parsed.push(intent);
	}
	return parsed;
}

export function validateCart(items: unknown): string | null {
	if (!Array.isArray(items)) return "items must be an array";
	if (items.length === 0) return "cart is empty";
	if (items.length > 40) return "cart is too large (max 40 items per checkout)";
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
