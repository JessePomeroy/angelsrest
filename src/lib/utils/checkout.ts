import {
	CheckoutAttemptTracker,
	checkoutError,
	checkoutTenantIntent,
	postCheckoutWithChallenge,
} from "$lib/utils/checkoutAttempt";

const attemptTracker = new CheckoutAttemptTracker();

export interface CheckoutParams {
	productId: string;
	coupon: null;
	isPrintSet?: boolean;
	paperSlug?: string;
	sizeSlug?: string;
	paperIndex?: number;
	borderWidth?: string;
	frame?: string;
}

export async function createCheckout(params: CheckoutParams): Promise<string> {
	const checkoutData = {
		productId: params.productId,
		coupon: params.coupon,
		isPrintSet: params.isPrintSet || false,
		paperSlug: params.paperSlug,
		sizeSlug: params.sizeSlug,
		...(params.paperIndex === undefined ? {} : { paperIndex: params.paperIndex }),
		borderWidth: params.borderWidth,
		frame: params.frame,
	};
	const result = await postCheckoutWithChallenge(
		"/api/checkout",
		checkoutData,
		{ tenant: checkoutTenantIntent(), ...checkoutData },
		attemptTracker,
	);
	if (typeof result.url !== "string") throw new Error(checkoutError(result, "checkout failed"));
	return result.url;
}
