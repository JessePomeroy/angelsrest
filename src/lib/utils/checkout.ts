import { CheckoutAttemptTracker, checkoutTenantIntent } from "$lib/utils/checkoutAttempt";

const attemptTracker = new CheckoutAttemptTracker();

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

	const attempt = attemptTracker.forIntent({ tenant: checkoutTenantIntent(), ...checkoutData });
	const response = await fetch("/api/checkout", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...checkoutData, ...attempt }),
	});

	const result = await response.json();

	if (!result.url) {
		throw new Error(result.error || "checkout failed");
	}

	attemptTracker.confirm(attempt.attempt);
	return result.url;
}
