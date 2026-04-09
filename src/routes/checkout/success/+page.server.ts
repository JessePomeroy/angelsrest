/**
 * Success Page Data Loader
 *
 * Fetches order details from Stripe to display shipping info and order summary.
 * This runs server-side, so we can safely use the Stripe secret key.
 */

import Stripe from "stripe";
import { STRIPE_SECRET_KEY } from "$env/static/private";

const stripe = new Stripe(STRIPE_SECRET_KEY);

export async function load({ url }) {
	const sessionId = url.searchParams.get("session_id");

	// If no session ID, just show basic success page
	if (!sessionId) {
		return {
			orderDetails: null,
		};
	}

	try {
		// Fetch the checkout session with expanded data
		// Note: shipping_details cannot be expanded — use collected_information instead
		const session = await stripe.checkout.sessions.retrieve(sessionId, {
			expand: ["line_items", "customer_details", "shipping_cost"],
		});

		const shippingDetails = session.collected_information?.shipping_details;

		// Transform Stripe data into our format
		const orderDetails = {
			sessionId: session.id,
			customerEmail: session.customer_details?.email,
			amountTotal: session.amount_total ?? 0,
			currency: session.currency,
			paymentStatus: session.payment_status,

			// Shipping information
			shippingAddress: shippingDetails?.address
				? {
						name: shippingDetails.name,
						line1: shippingDetails.address.line1,
						line2: shippingDetails.address.line2,
						city: shippingDetails.address.city,
						state: shippingDetails.address.state,
						postalCode: shippingDetails.address.postal_code,
						country: shippingDetails.address.country,
					}
				: null,

			// Line items (what they bought)
			items:
				session.line_items?.data.map((item) => ({
					description: item.description,
					quantity: item.quantity,
					amount: item.amount_total,
				})) || [],

			// Metadata
			productId: session.metadata?.productId,
			productSlug: session.metadata?.productSlug || "",
			isDigital: session.metadata?.isDigital === "true",
		};

		return {
			orderDetails,
		};
	} catch (err) {
		console.error("Error fetching order details:", err);
		// Don't break the success page if Stripe lookup fails
		return {
			orderDetails: null,
			error: "Could not load order details",
		};
	}
}
