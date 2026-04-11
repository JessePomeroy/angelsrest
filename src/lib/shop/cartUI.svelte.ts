/**
 * Cart UI store — drawer open/close state (cart PR B).
 *
 * Separate from `cart.svelte.ts` (which holds the actual line items + totals)
 * because drawer visibility is purely a UI concern with no need to persist
 * across reloads. Splitting it keeps the data store unaware of presentation.
 *
 * Pattern matches the singleton convention of `cart.svelte.ts` and
 * `timeTheme.svelte.ts` — class with $state fields, exported singleton at
 * the bottom of the file. Components import `cartUI` and call `cartUI.open()`
 * / `cartUI.close()` / `cartUI.toggle()` and read `cartUI.isOpen`.
 *
 * The store is intentionally minimal — adding more flags here (e.g., a
 * "just-added" pulse, a coupon-input visibility flag) is fine, but keep it
 * UI-only. Anything that needs to live across reloads belongs in
 * `cart.svelte.ts` instead.
 */

class CartUIStore {
	#isOpen = $state(false);

	get isOpen() {
		return this.#isOpen;
	}

	open() {
		this.#isOpen = true;
	}

	close() {
		this.#isOpen = false;
	}

	toggle() {
		this.#isOpen = !this.#isOpen;
	}
}

export const cartUI = new CartUIStore();
