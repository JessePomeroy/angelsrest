import type { CartItem } from "$lib/shop/cart";
import { CheckoutAttemptTracker, checkoutTenantIntent } from "$lib/utils/checkoutAttempt";

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
	const attempt = attemptTracker.forIntent({ tenant: checkoutTenantIntent(), items: intent });
	const response = await fetch("/api/cart/checkout", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ items, ...attempt }),
	});

	const result = await response.json();

	if (!result.url) {
		throw new Error(result.error || result.message || "checkout failed");
	}

	attemptTracker.confirm(attempt.attempt);
	return result.url;
}
