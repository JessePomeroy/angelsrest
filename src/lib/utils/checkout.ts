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

import type { ParsedPaper } from "$lib/types/shop";

export interface CheckoutParams {
	productId: string;
	title: string;
	price: number;
	image: string | null;
	paper: ParsedPaper | null;
	coupon: string | null;
	isPrintSet?: boolean;
	images?: string[];
}

/**
 * Create a Stripe checkout session and return the redirect URL.
 * Throws on error so the calling component can handle it.
 */
export async function createCheckout(params: CheckoutParams): Promise<string> {
	const checkoutData = {
		productId: params.productId,
		title: params.title,
		price: params.price,
		image: params.image,
		paper: params.paper
			? {
					name: params.paper.name,
					subcategoryId: params.paper.subcategoryId,
					width: params.paper.width,
					height: params.paper.height,
				}
			: null,
		coupon: params.coupon,
		isPrintSet: params.isPrintSet || false,
		images: params.images || [],
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
