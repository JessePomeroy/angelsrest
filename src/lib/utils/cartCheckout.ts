/**
 * Cart Checkout Client Helper (cart PR C of the cart stack).
 *
 * Companion to `src/lib/utils/checkout.ts` (which handles single-item
 * "Buy Now") for multi-item shopping cart purchases. The cart drawer +
 * /cart page (PR B/D) call this when the customer clicks "Checkout".
 *
 * Just a thin fetch wrapper — all the validation, Stripe session
 * creation, and metadata encoding lives server-side in
 * /api/cart/checkout/+server.ts.
 */

import type { CartItem } from "$lib/shop/cart";

/**
 * POST the cart to /api/cart/checkout and return the Stripe redirect URL.
 * Throws on validation or network error so the caller can show an
 * appropriate error UI (toast in the drawer, banner on the cart page).
 */
export async function createCartCheckout(items: CartItem[]): Promise<string> {
	const response = await fetch("/api/cart/checkout", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ items }),
	});

	const result = await response.json();

	if (!result.url) {
		throw new Error(result.error || result.message || "checkout failed");
	}

	return result.url;
}
