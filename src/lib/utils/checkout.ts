/**
 * Checkout Utility
 *
 * Shared checkout logic used by both the product detail page
 * and the print set detail page. Handles the API call to create
 * a Stripe checkout session and returns the redirect URL.
 *
 * UI concerns (loading state, redirects, error display) stay
 * in the page components. This function just does the fetch.
 */

export interface CheckoutParams {
	productId: string;
	coupon: string | null;
	isPrintSet?: boolean;
	paperSlug?: string;
	sizeSlug?: string;
	paperIndex?: number;
	borderWidth?: string;
	frame?: string;
}

/**
 * Create a Stripe checkout session and return the redirect URL.
 * Throws on error so the calling component can handle it.
 */
export async function createCheckout(params: CheckoutParams): Promise<string> {
	const checkoutData = {
		productId: params.productId,
		coupon: params.coupon,
		isPrintSet: params.isPrintSet || false,
		paperSlug: params.paperSlug,
		sizeSlug: params.sizeSlug,
		paperIndex: params.paperIndex,
		borderWidth: params.borderWidth,
		frame: params.frame,
	};

	const response = await fetch("/api/checkout", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(checkoutData),
	});

	const result = await response.json();

	if (!result.url) {
		throw new Error(result.error || "checkout failed");
	}

	return result.url;
}
