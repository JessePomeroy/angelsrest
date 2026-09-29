import { createCartCheckout } from "$lib/utils/cartCheckout";
import type { CartItem } from "./cart";

/** Each mounted cart surface owns its own pending and error state. */
export function createCartCheckoutState(
	createCheckout: (items: CartItem[]) => Promise<string> = createCartCheckout,
	navigate: (url: string) => void = (url) => {
		window.location.href = url;
	},
) {
	let isCheckingOut = $state(false);
	let error = $state<string | null>(null);

	async function checkout(items: CartItem[]) {
		if (items.length === 0 || isCheckingOut) return;
		isCheckingOut = true;
		error = null;
		try {
			const url = await createCheckout(items);
			navigate(url);
		} catch (cause) {
			console.error("Cart checkout error:", cause);
			error = cause instanceof Error ? cause.message : "checkout failed. please try again.";
			isCheckingOut = false;
		}
	}

	return {
		get isCheckingOut() {
			return isCheckingOut;
		},
		get error() {
			return error;
		},
		checkout,
	};
}
