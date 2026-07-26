import type { CartItem } from "$lib/shop/cart";
import {
	CheckoutAttemptTracker,
	checkoutError,
	checkoutTenantIntent,
	postCheckoutWithChallenge,
} from "$lib/utils/checkoutAttempt";

const attemptTracker = new CheckoutAttemptTracker();

export async function createCartCheckout(items: CartItem[]): Promise<string> {
	const intent = items.map((item) => ({
		productSlug: item.productSlug,
		type: item.type,
		quantity: item.quantity,
		paperSlug: item.paperSlug,
		sizeSlug: item.sizeSlug,
		paperIndex: item.paperIndex,
		borderWidthValue: item.borderWidthValue,
		frameValue: item.frameValue,
	}));
	const result = await postCheckoutWithChallenge(
		"/api/cart/checkout",
		{ items },
		{ tenant: checkoutTenantIntent(), items: intent },
		attemptTracker,
	);
	if (typeof result.url !== "string") throw new Error(checkoutError(result, "checkout failed"));
	return result.url;
}
