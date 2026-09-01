export type CartItemType = "print" | "set";

export interface CartItem {
	id: string;
	productSlug: string;
	type: CartItemType;
	title: string;
	imageUrl: string;
	imageUrls?: string[];
	paperName?: string;
	paperSubcategoryId?: number;
	paperWidth?: number;
	paperHeight?: number;
	borderWidth?: number;
	frameSubcategoryId?: number;
	canvasSubcategoryId?: number;
	canvasWrapHex?: string;
	paperSlug?: string;
	sizeSlug?: string;
	paperIndex?: number;
	borderWidthValue?: string;
	frameValue?: string;
	quantity: number;
	unitPriceCents: number;
}

export interface CartState {
	items: CartItem[];
	updatedAt: string;
}

export const STORAGE_KEY = "angelsrest:cart:v3";
export const CART_EXPIRY_DAYS = 30;
export const MAX_QUANTITY_PER_LINE = 20;

export function emptyCart(now: Date = new Date()): CartState {
	return { items: [], updatedAt: now.toISOString() };
}

export function itemMatchKey(
	item: Pick<
		CartItem,
		| "productSlug"
		| "type"
		| "paperSubcategoryId"
		| "paperWidth"
		| "paperHeight"
		| "borderWidth"
		| "frameSubcategoryId"
		| "canvasSubcategoryId"
		| "canvasWrapHex"
		| "imageUrl"
		| "imageUrls"
	>,
): string {
	return [
		item.productSlug,
		item.type,
		String(item.paperSubcategoryId),
		String(item.paperWidth),
		String(item.paperHeight),
		String(item.borderWidth),
		String(item.frameSubcategoryId),
		String(item.canvasSubcategoryId),
		String(item.canvasWrapHex),
		item.imageUrls ? item.imageUrls.join(",") : item.imageUrl,
	].join("|");
}

export function addItemToCart(
	cart: CartState,
	newItem: Omit<CartItem, "id">,
	idGenerator: () => string = generateId,
	now: Date = new Date(),
): CartState {
	const newKey = itemMatchKey(newItem);
	const existingIndex = cart.items.findIndex((i) => itemMatchKey(i) === newKey);

	if (existingIndex >= 0) {
		const existing = cart.items[existingIndex];
		const merged = clampQuantity(existing.quantity + newItem.quantity);
		const items = cart.items.map((i, idx) =>
			idx === existingIndex ? { ...i, quantity: merged } : i,
		);
		return { items, updatedAt: now.toISOString() };
	}

	return {
		items: [
			...cart.items,
			{
				...newItem,
				id: idGenerator(),
				quantity: clampQuantity(newItem.quantity),
			},
		],
		updatedAt: now.toISOString(),
	};
}

export function updateItemQuantity(
	cart: CartState,
	itemId: string,
	quantity: number,
	now: Date = new Date(),
): CartState {
	if (quantity <= 0) return removeItemFromCart(cart, itemId, now);
	return {
		items: cart.items.map((i) =>
			i.id === itemId ? { ...i, quantity: clampQuantity(quantity) } : i,
		),
		updatedAt: now.toISOString(),
	};
}

export function removeItemFromCart(
	cart: CartState,
	itemId: string,
	now: Date = new Date(),
): CartState {
	return {
		items: cart.items.filter((i) => i.id !== itemId),
		updatedAt: now.toISOString(),
	};
}

export function clearCart(now: Date = new Date()): CartState {
	return emptyCart(now);
}

export function cartTotalCents(cart: CartState): number {
	return cart.items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
}

export function cartItemCount(cart: CartState): number {
	return cart.items.reduce((sum, i) => sum + i.quantity, 0);
}

export function isCartExpired(cart: CartState, now: Date = new Date()): boolean {
	const updated = new Date(cart.updatedAt);
	const ageMs = now.getTime() - updated.getTime();
	const expiryMs = CART_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
	return ageMs > expiryMs;
}

function clampQuantity(qty: number): number {
	return Math.max(1, Math.min(MAX_QUANTITY_PER_LINE, Math.floor(qty)));
}

function generateId(): string {
	return crypto.randomUUID();
}
