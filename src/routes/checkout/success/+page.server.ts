/**
 * Success Page Data Loader
 *
 * Fetches order details from Stripe to display shipping info and order summary.
 * This runs server-side, so we can safely use the Stripe secret key.
 *
 * Audit H30: we used to return customer PII (name, email, shipping address)
 * keyed only on the `session_id` URL param. Anyone who saw a session_id in a
 * log, referrer header, or over a shoulder could view those details. Now
 * we require an httpOnly binding cookie that the checkout endpoint sets at
 * session creation time — without the cookie match we return a minimal
 * "thank you" state with no PII.
 */

import Stripe from "stripe";
import { STRIPE_SECRET_KEY } from "$env/static/private";
import { isCheckoutSessionOwner } from "$lib/server/checkoutBinding";

const stripe = new Stripe(STRIPE_SECRET_KEY);

export async function load({ url, cookies }) {
	const sessionId = url.searchParams.get("session_id");
	const emailParam = url.searchParams.get("email")?.toLowerCase();

	// If no session ID, just show basic success page
	if (!sessionId) {
		return {
			orderDetails: null,
		};
	}

	// Audit H30 — two accepted proofs of ownership for this session:
	//   1. The cookie set at checkout creation (the buyer's own browser,
	//      within 1h of completing checkout).
	//   2. An `email` query param matching the Stripe customer email (the
	//      buyer clicking their confirmation email from any device).
	// Neither path → show the minimal "unverified" state with a pointer
	// to /orders lookup; no PII is returned.

	const cookieOwner = isCheckoutSessionOwner(cookies, sessionId);

	// Fetch the session early if the cookie didn't match; we need the
	// customer email to verify the email-match path. (When the cookie
	// matches we already know the caller is the buyer, so the fetch is
	// strictly for rendering order details.)
	let session: Stripe.Checkout.Session;
	try {
		session = await stripe.checkout.sessions.retrieve(sessionId, {
			expand: ["line_items", "customer_details", "shipping_cost"],
		});
	} catch (err) {
		console.error("Error fetching order details:", err);
		return {
			orderDetails: null,
			error: "Could not load order details",
		};
	}

	if (!cookieOwner) {
		const sessionEmail = session.customer_details?.email?.toLowerCase();
		if (!emailParam || !sessionEmail || emailParam !== sessionEmail) {
			return {
				orderDetails: null,
				unverified: true,
			};
		}
	}

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
}
