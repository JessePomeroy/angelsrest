/**
 * Shopping cart — reactive store (PR A of the cart stack).
 *
 * Thin Svelte 5 runes wrapper around the pure helpers in `cart.ts`.
 * Hydrates from localStorage on construction (browser only) and persists
 * after every mutation. Exported as a singleton for component use.
 *
 * Pattern matches `src/lib/stores/timeTheme.svelte.ts` — class with $state
 * fields, hydrate-on-construct guarded by `browser`, singleton export at
 * the bottom.
 *
 * The class deliberately delegates ALL state transitions to the pure
 * helpers in `cart.ts` rather than reimplementing them inline. That way
 * the unit tests against `cart.ts` cover the actual mutation logic, and
 * this file's bug surface is just "did localStorage hydration / persistence
 * work?" — which is essentially a try/catch wrapper.
 */

import { browser } from "$app/environment";
import {
	addItemToCart,
	type CartItem,
	type CartState,
	cartItemCount,
	cartTotalCents,
	clearCart,
	emptyCart,
	isCartExpired,
	removeItemFromCart,
	STORAGE_KEY,
	updateItemQuantity,
} from "./cart";

class CartStore {
	#state = $state<CartState>(emptyCart());

	/**
	 * Set to true once a stale cart was cleared on hydrate. The CartDrawer
	 * (PR B) reads this to show a one-time "we cleared your old cart" toast.
	 * Reset to false after the UI consumes it.
	 */
	cartWasExpiredOnLoad = $state(false);

	constructor() {
		if (browser) {
			this.#hydrate();
		}
	}

	#hydrate() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return;
			const parsed = JSON.parse(raw) as CartState;
			// Sanity-check the shape — corrupted localStorage should not
			// crash the entire app on first paint.
			if (!parsed || !Array.isArray(parsed.items)) {
				this.#reset();
				return;
			}
			if (isCartExpired(parsed)) {
				this.#reset();
				this.cartWasExpiredOnLoad = true;
				return;
			}
			this.#state = parsed;
		} catch {
			// JSON parse error or localStorage access denied — start fresh.
			this.#reset();
		}
	}

	#reset() {
		this.#state = emptyCart();
		this.#persist();
	}

	#persist() {
		if (!browser) return;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.#state));
		} catch {
			// localStorage quota exceeded or disabled (e.g., Safari private
			// mode in older versions) — silently degrade. Cart still works
			// in-memory for the current page session.
		}
	}

	// ─── Public API (matches the pure helpers, but mutates this.#state) ───

	add(item: Omit<CartItem, "id">) {
		this.#state = addItemToCart(this.#state, item);
		this.#persist();
	}

	updateQuantity(itemId: string, quantity: number) {
		this.#state = updateItemQuantity(this.#state, itemId, quantity);
		this.#persist();
	}

	remove(itemId: string) {
		this.#state = removeItemFromCart(this.#state, itemId);
		this.#persist();
	}

	clear() {
		this.#state = clearCart();
		this.#persist();
	}

	// ─── Reactive getters (consumed by components via $derived) ───

	get items(): CartItem[] {
		return this.#state.items;
	}

	get totalCents(): number {
		return cartTotalCents(this.#state);
	}

	get itemCount(): number {
		return cartItemCount(this.#state);
	}

	get isEmpty(): boolean {
		return this.#state.items.length === 0;
	}

	get updatedAt(): string {
		return this.#state.updatedAt;
	}
}

/** Singleton — import this in components, not `new CartStore()`. */
export const cart = new CartStore();
