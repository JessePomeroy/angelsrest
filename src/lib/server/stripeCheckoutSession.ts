import type Stripe from "stripe";
import type { TenantStripeCheckoutOptions } from "$lib/server/stripeConnect";

type AllowedCountry = NonNullable<
	Stripe.Checkout.SessionCreateParams["shipping_address_collection"]
>["allowed_countries"][number];

export interface CheckoutLineItemInput {
	name: string;
	description?: string;
	imageUrl?: string;
	unitAmountCents: number;
	quantity?: number;
}

export interface CreatePaymentCheckoutSessionOptions {
	stripe: Stripe;
	lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
	successUrl: string;
	cancelUrl: string;
	metadata: Stripe.MetadataParam;
	shippingAllowedCountries?: AllowedCountry[];
	tenantCheckout?: TenantStripeCheckoutOptions;
}

export interface PaymentCheckoutSessionResult {
	sessionId: string;
	url: string | null;
}

export function buildCheckoutLineItem({
	name,
	description,
	imageUrl,
	unitAmountCents,
	quantity = 1,
}: CheckoutLineItemInput): Stripe.Checkout.SessionCreateParams.LineItem {
	const productData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData.ProductData = {
		name,
		images: imageUrl ? [imageUrl] : [],
	};
	if (description) {
		productData.description = description;
	}

	return {
		price_data: {
			currency: "usd",
			product_data: productData,
			unit_amount: unitAmountCents,
		},
		quantity,
	};
}

export async function createPaymentCheckoutSession({
	stripe,
	lineItems,
	successUrl,
	cancelUrl,
	metadata,
	shippingAllowedCountries,
	tenantCheckout,
}: CreatePaymentCheckoutSessionOptions): Promise<PaymentCheckoutSessionResult> {
	const session = await stripe.checkout.sessions.create(
		{
			payment_method_types: ["card"],
			...(shippingAllowedCountries
				? {
						shipping_address_collection: {
							allowed_countries: shippingAllowedCountries,
						},
					}
				: {}),
			line_items: lineItems,
			mode: "payment",
			success_url: successUrl,
			cancel_url: cancelUrl,
			metadata,
			...(tenantCheckout?.session ?? {}),
		},
		tenantCheckout?.requestOptions,
	);

	return { sessionId: session.id, url: session.url };
}
