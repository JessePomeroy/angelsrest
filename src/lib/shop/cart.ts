/**
 * Shopping cart — pure logic (PR A of the cart stack).
 *
 * This module contains ONLY pure functions and type definitions. No DOM
 * access, no localStorage, no Svelte runes. The reactive store that wraps
 * these helpers and persists to localStorage lives in `cart.svelte.ts`.
 *
 * Splitting it this way means:
 *   - Every operation is trivially unit-testable without a DOM, browser
 *     globals, or Svelte's reactive runtime.
 *   - The reactive layer (`cart.svelte.ts`) is a thin shell over these
 *     helpers, so its bug surface is small.
 *
 * Cart shape is versioned via the storage key (`angelsrest:cart:v1`) so
 * we can migrate the schema later without confusing customers whose
 * browsers still hold the old shape — old keys are simply ignored, the
 * new key starts empty.
 *
 * Quantity is clamped to [1, MAX_QUANTITY_PER_LINE] inside every mutation
 * helper rather than at the UI layer so we can't get bad data into the
 * cart from any code path. LumaPrints can choke on huge single-line
 * quantities; 20 is a safe default and easy to revisit.
 */

/** Whether a cart entry is a single print or a multi-image print set. */
export type CartItemType = "print" | "set";

/**
 * A line item in the shopping cart.
 *
 * Paper fields are OPTIONAL. They are present for LumaPrints prints (where
 * the photographer picked a specific paper × size variant) and absent for
 * self-fulfilled merch like tapestries, where the product is a single SKU
 * with a fixed price. The presence of `paperSubcategoryId` is the canonical
 * signal used by `buildOrderItemsFromSession` in the Stripe webhook to
 * decide whether the line gets submitted to LumaPrints or treated as
 * self-fulfilled.
 */
export interface CartItem {
	/** Stable identity assigned at add-time. UUID-shaped. */
	id: string;
	/** Sanity product slug — matches the existing /shop/[slug] URL space. */
	productSlug: string;
	/** Determines render shape and the eventual checkout payload. */
	type: CartItemType;
	/** Display title for cart UI. Captured at add-time so renames don't surprise the customer mid-cart. */
	title: string;
	/** Primary thumbnail URL for cart UI. */
	imageUrl: string;
	/** For print sets: all images in the set. Undefined for single prints. */
	imageUrls?: string[];
	/** Display name for the selected paper. Absent for non-print merch. */
	paperName?: string;
	/** LumaPrints subcategory ID for the selected paper. Absent for non-print merch. */
	paperSubcategoryId?: number;
	/** Print width in inches. Absent for non-print merch. */
	paperWidth?: number;
	/** Print height in inches. Absent for non-print merch. */
	paperHeight?: number;
	/** Border width in inches (0.25, 0.5, 1). Absent means no border. */
	borderWidth?: number;
	/** LumaPrints frame subcategory ID (105001-105007). Absent means unframed. */
	frameSubcategoryId?: number;
	/** LumaPrints canvas subcategory ID (101001-101005). Absent means not canvas. */
	canvasSubcategoryId?: number;
	/** Always in [1, MAX_QUANTITY_PER_LINE]. */
	quantity: number;
	/**
	 * Unit price captured at add-time, in cents. We snapshot this so a
	 * retail-price change in Sanity doesn't silently change what the
	 * customer sees in their cart between add and checkout.
	 */
	unitPriceCents: number;
}

/** Top-level cart state. Persisted under `angelsrest:cart:v1` in localStorage. */
export interface CartState {
	items: CartItem[];
	/** ISO timestamp of the last mutation. Used to expire stale carts. */
	updatedAt: string;
}

export const STORAGE_KEY = "angelsrest:cart:v1";
export const CART_EXPIRY_DAYS = 30;
export const MAX_QUANTITY_PER_LINE = 20;

/** Build a fresh empty cart. */
export function emptyCart(now: Date = new Date()): CartState {
	return { items: [], updatedAt: now.toISOString() };
}

/**
 * Stable identity key for matching cart items. Two adds with the same
 * product + type + paper + size + image set merge into a single line
 * with a quantity bump rather than appearing twice. Same product with a
 * different paper or size produces a separate line — that's the explicit
 * UX choice (per the cart scoping discussion 2026-04-11).
 *
 * For non-print merch (no paper info), the key collapses to slug + type +
 * image, so two adds of the same tapestry merge into one line. Distinct
 * tapestries still produce distinct lines because the image differs.
 */
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
		| "imageUrl"
		| "imageUrls"
	>,
): string {
	return [
		item.productSlug,
		item.type,
		// Paper fields stringified — `undefined` becomes the literal string
		// "undefined", which is fine because every non-print merch item gets
		// the same suffix and the slug+image still differentiates them.
		String(item.paperSubcategoryId),
		String(item.paperWidth),
		String(item.paperHeight),
		String(item.borderWidth),
		String(item.frameSubcategoryId),
		String(item.canvasSubcategoryId),
		// Print sets have multiple images; single prints have one. Joining
		// the array gives a stable comparison key for sets, while single
		// prints (and non-print merch) fall through to the imageUrl.
		item.imageUrls ? item.imageUrls.join(",") : item.imageUrl,
	].join("|");
}

/**
 * Add an item to the cart. If a matching item (same productSlug + type +
 * paper + size + images) already exists, its quantity is bumped instead
 * of a new line being added. Quantity is clamped to MAX_QUANTITY_PER_LINE.
 *
 * Returns a NEW CartState — never mutates the input. The reactive store
 * uses this immutable shape to drive Svelte's runes correctly.
 */
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

/**
 * Set a line item's quantity. Quantities ≤ 0 remove the item entirely
 * (matches the UX of holding minus until the line disappears).
 */
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

/** Remove a single line item by id. No-op if the id doesn't exist. */
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

/** Replace the cart with an empty one. */
export function clearCart(now: Date = new Date()): CartState {
	return emptyCart(now);
}

/** Sum of all line items × their quantities, in cents. */
export function cartTotalCents(cart: CartState): number {
	return cart.items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
}

/** Total quantity across all line items — used for the nav badge. */
export function cartItemCount(cart: CartState): number {
	return cart.items.reduce((sum, i) => sum + i.quantity, 0);
}

/**
 * True if the cart's last update was more than CART_EXPIRY_DAYS ago.
 * The reactive store uses this on hydrate to throw out stale carts and
 * show a "we cleared your old cart" toast.
 */
export function isCartExpired(cart: CartState, now: Date = new Date()): boolean {
	const updated = new Date(cart.updatedAt);
	const ageMs = now.getTime() - updated.getTime();
	const expiryMs = CART_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
	return ageMs > expiryMs;
}

function clampQuantity(qty: number): number {
	return Math.max(1, Math.min(MAX_QUANTITY_PER_LINE, Math.floor(qty)));
}

/**
 * Generate a stable identity for a new cart item. Prefers crypto.randomUUID
 * (widely available in modern browsers + Node 19+) and falls back to a
 * timestamp+random string for very old environments. Cart IDs don't need
 * cryptographic strength — they only need to be unique within one cart.
 */
function generateId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
