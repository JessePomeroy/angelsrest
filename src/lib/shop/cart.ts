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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isCartItem(value: unknown): value is CartItem {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		value.id.trim().length > 0 &&
		typeof value.productSlug === "string" &&
		value.productSlug.trim().length > 0 &&
		(value.type === "print" || value.type === "set") &&
		typeof value.title === "string" &&
		typeof value.imageUrl === "string" &&
		isNonnegativeInteger(value.quantity) &&
		value.quantity >= 1 &&
		value.quantity <= MAX_QUANTITY_PER_LINE &&
		isNonnegativeInteger(value.unitPriceCents) &&
		(value.imageUrls === undefined ||
			(Array.isArray(value.imageUrls) &&
				value.imageUrls.every((url) => typeof url === "string"))) &&
		["paperName", "canvasWrapHex", "paperSlug", "sizeSlug", "borderWidthValue", "frameValue"].every(
			(field) => value[field] === undefined || typeof value[field] === "string",
		) &&
		["paperSubcategoryId", "frameSubcategoryId", "canvasSubcategoryId"].every(
			(field) =>
				value[field] === undefined || (isNonnegativeInteger(value[field]) && value[field] > 0),
		) &&
		["paperWidth", "paperHeight"].every(
			(field) =>
				value[field] === undefined ||
				(typeof value[field] === "number" && Number.isFinite(value[field]) && value[field] > 0),
		) &&
		(value.paperIndex === undefined || isNonnegativeInteger(value.paperIndex)) &&
		(value.borderWidth === undefined ||
			(typeof value.borderWidth === "number" &&
				Number.isFinite(value.borderWidth) &&
				value.borderWidth >= 0))
	);
}

/** Saved cart data is untrusted; only adopt entries safe for rendering and totals. */
export function parseCartState(value: unknown): CartState | null {
	if (
		!isRecord(value) ||
		!Array.isArray(value.items) ||
		typeof value.updatedAt !== "string" ||
		!Number.isFinite(Date.parse(value.updatedAt))
	)
		return null;
	const items: CartItem[] = [];
	const ids = new Set<string>();
	let totalCents = 0;
	for (const item of value.items) {
		if (!isCartItem(item) || ids.has(item.id)) return null;
		totalCents += item.quantity * item.unitPriceCents;
		if (!Number.isSafeInteger(totalCents)) return null;
		ids.add(item.id);
		items.push(item);
	}
	return { items, updatedAt: value.updatedAt };
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
