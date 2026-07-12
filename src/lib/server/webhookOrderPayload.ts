import type Stripe from "stripe";
import type { ShippingDetails } from "$lib/server/webhookEmails";

export type ConvexOrderCreatePayload = {
	webhookSecret: string;
	siteUrl: string;
	stripeSessionId: string;
	customerEmail: string;
	customerName?: string;
	stripePaymentIntentId?: string;
	stripeConnectedAccountId?: string;
	shippingAddress?: {
		line1: string;
		line2?: string;
		city: string;
		state: string;
		postalCode: string;
		country: string;
	};
	items: Array<{
		productName: string;
		quantity: number;
		price: number;
	}>;
	total: number;
	subtotal?: number;
	fulfillmentType: "self" | "digital";
	paperName?: string;
	paperSubcategoryId?: string;
};

export function buildConvexOrderCreatePayload({
	session,
	shippingDetails,
	lineItems,
	siteUrl,
	webhookSecret,
	stripeRequestOptions,
}: {
	session: Stripe.Checkout.Session;
	shippingDetails: ShippingDetails;
	lineItems: Stripe.LineItem[];
	siteUrl: string;
	webhookSecret: string;
	stripeRequestOptions?: Stripe.RequestOptions;
}): ConvexOrderCreatePayload {
	const rawPaymentIntent = session.payment_intent;
	const stripePaymentIntentId =
		typeof rawPaymentIntent === "string" ? rawPaymentIntent : rawPaymentIntent?.id;
	const isDigital = session.metadata?.isDigital === "true";

	return {
		webhookSecret,
		siteUrl,
		stripeSessionId: session.id,
		customerEmail: session.customer_details?.email || "",
		customerName: session.customer_details?.name || shippingDetails?.name || undefined,
		stripePaymentIntentId: stripePaymentIntentId || undefined,
		...(stripeRequestOptions?.stripeAccount
			? { stripeConnectedAccountId: stripeRequestOptions.stripeAccount }
			: {}),
		shippingAddress: shippingDetails?.address
			? {
					line1: shippingDetails.address.line1 || "",
					line2: shippingDetails.address.line2 || undefined,
					city: shippingDetails.address.city || "",
					state: shippingDetails.address.state || "",
					postalCode: shippingDetails.address.postal_code || "",
					country: shippingDetails.address.country || "",
				}
			: undefined,
		items: lineItems.map((item) => ({
			productName: item.description || "Unknown Product",
			quantity: item.quantity || 1,
			price: item.amount_total || item.price?.unit_amount || 0,
		})),
		total: session.amount_total || 0,
		subtotal: session.amount_subtotal || undefined,
		fulfillmentType: isDigital ? "digital" : "self",
		paperName: session.metadata?.paperName || undefined,
		paperSubcategoryId: session.metadata?.paperSubcategoryId || undefined,
	};
}
