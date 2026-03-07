/**
 * Stripe Webhook Handler 🪝
 *
 * Receives webhook events from Stripe when purchases happen.
 *
 * Flow for a successful purchase:
 * 1. Customer completes checkout → Stripe fires checkout.session.completed
 * 2. We send confirmation emails (customer + admin)
 * 3. We create an order in Sanity CMS for tracking
 * 4. We fetch actual Stripe fees (with a short delay for availability)
 *
 * 🔒 Security: Every webhook is verified via cryptographic signature
 * 📧 Emails: Customer confirmation + admin notification via Resend
 * 📦 Orders: Stored in Sanity with sequential numbering (ORD-001, ORD-002...)
 * 💰 Fees: Actual Stripe transaction fees captured from balance_transaction
 *
 * Webhook URL: https://www.angelsrest.online/api/webhooks/stripe
 * Events handled: checkout.session.completed, payment_intent.payment_failed
 */

import { error, json } from "@sveltejs/kit";
import { Resend } from "resend";
import Stripe from "stripe";
import {
	RESEND_API_KEY,
	STRIPE_SECRET_KEY,
	STRIPE_WEBHOOK_SECRET,
} from "$env/static/private";
import {
	getNextOrderNumber,
	orderExistsForSession,
} from "$lib/orders/orderNumber";
import { adminClient } from "$lib/sanity/adminClient";

const stripe = new Stripe(STRIPE_SECRET_KEY);
const resend = new Resend(RESEND_API_KEY);

/** Format cents to USD string (e.g., 1500 → "$15.00") */
const formatCurrency = (amount: number) =>
	new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
	}).format(amount / 100);

/** Format shipping address for emails */
function formatShippingAddress(shippingDetails: any): string {
	if (!shippingDetails?.address) return "No shipping address";
	const { name, address } = shippingDetails;
	return [
		name,
		address.line1,
		address.line2,
		`${address.city}, ${address.state} ${address.postal_code}`,
		address.country,
	]
		.filter(Boolean)
		.join("\n");
}

/** Format line items for emails */
function formatLineItems(lineItems: Stripe.LineItem[]): string {
	return lineItems
		.map(
			(item) =>
				`• ${item.description} (${item.quantity}x) - ${formatCurrency(item.amount_total)}`,
		)
		.join("\n");
}

// ─── Webhook Entry Point ─────────────────────────────────────────────────────

export async function POST({ request }) {
	const body = await request.text(); // Must be raw text for signature verification
	const signature = request.headers.get("stripe-signature");

	if (!signature) {
		throw error(400, "Missing stripe-signature header");
	}

	// Verify the webhook came from Stripe (cryptographic signature check)
	let event: Stripe.Event;
	try {
		event = stripe.webhooks.constructEvent(
			body,
			signature,
			STRIPE_WEBHOOK_SECRET,
		);
	} catch (err: any) {
		console.error("Webhook signature verification failed:", err.message);
		throw error(400, `Webhook Error: ${err.message}`);
	}

	console.log(`Received webhook: ${event.type}`);

	try {
		switch (event.type) {
			case "checkout.session.completed": {
				const session = event.data.object as Stripe.Checkout.Session;
				await handleCheckoutCompleted(session);
				break;
			}

			case "payment_intent.payment_failed": {
				const paymentIntent = event.data.object as Stripe.PaymentIntent;
				console.log("Payment failed:", paymentIntent.id);
				// TODO: Could send "payment failed" email to customer
				break;
			}

			default:
				// Ignore other events (charge.succeeded, payment_intent.succeeded, etc.)
				// Fees are captured directly in handleCheckoutCompleted
				break;
		}

		return json({ received: true });
	} catch (err) {
		console.error("Error processing webhook:", err);
		throw error(500, "Webhook processing failed");
	}
}

// ─── Checkout Handler ────────────────────────────────────────────────────────

/**
 * Handle a completed checkout session.
 * Sends emails, creates order in Sanity, and captures Stripe fees.
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
	console.log("Processing completed checkout:", session.id);

	try {
		// Fetch full session data with line items and payment details
		const { fullSession, lineItems, shippingDetails } =
			await fetchSessionDetails(session);

		const customerEmail =
			fullSession.customer_details?.email || (session as any).email;

		if (!customerEmail) {
			console.error("No customer email found for session:", session.id);
			return;
		}

		// Create order first so we have the order number for the email
		const orderResult = await createOrderInSanity({
			session: fullSession,
			shippingDetails,
			lineItems,
		});

		// Send emails with the order number
		await sendCustomerConfirmation({
			session: fullSession,
			customerEmail,
			shippingDetails,
			lineItems,
			orderNumber: orderResult?.orderNumber,
		});

		await sendAdminNotification({
			session: fullSession,
			customerEmail,
			shippingDetails,
			lineItems,
			orderNumber: orderResult?.orderNumber,
		});

		console.log("Checkout processed successfully:", session.id);
	} catch (err) {
		console.error("Error in handleCheckoutCompleted:", err);
		throw err;
	}
}

/**
 * Fetch complete session data from Stripe.
 * Expands line items and payment intent for fee access.
 * Falls back to event data for test/triggered events.
 */
async function fetchSessionDetails(session: Stripe.Checkout.Session) {
	let fullSession: Stripe.Checkout.Session;
	let lineItems: Stripe.LineItem[] = [];
	let shippingDetails: any;

	try {
		fullSession = await stripe.checkout.sessions.retrieve(session.id, {
			expand: ["line_items", "customer_details"],
		});
		lineItems = fullSession.line_items?.data || [];
		shippingDetails = session.collected_information?.shipping_details;
	} catch (retrieveError) {
		// For Stripe CLI test events, the session may not exist
		console.log(
			"Session retrieval failed (likely test event), using event data",
		);
		fullSession = session;
		shippingDetails = (session as any).collected_information?.shipping_details;
	}

	return { fullSession, lineItems, shippingDetails };
}

// ─── Email Functions ─────────────────────────────────────────────────────────

/** Send order confirmation email to the customer */
async function sendCustomerConfirmation({
	session,
	customerEmail,
	shippingDetails,
	lineItems,
	orderNumber,
}: {
	session: Stripe.Checkout.Session;
	customerEmail: string;
	shippingDetails: any;
	lineItems: Stripe.LineItem[];
	orderNumber?: string;
}) {
	const emailContent = `
Hi ${shippingDetails?.name || "there"},

Thank you for your order! Your payment has been successfully processed.

ORDER DETAILS
Order ID: ${session.id}
Total: ${formatCurrency(session.amount_total || 0)}

ITEMS ORDERED
${formatLineItems(lineItems)}

SHIPPING ADDRESS
${formatShippingAddress(shippingDetails)}

TRACK YOUR ORDER
View your order status anytime: https://angelsrest.online/orders?email=${encodeURIComponent(customerEmail)}&order=${orderNumber}

WHAT'S NEXT?
• Your order will be processed within 1-2 business days
• Made-to-order prints typically ship within 2 weeks
• You'll receive tracking information once your order ships
• If you have any questions, just reply to this email

Thank you for supporting Angel's Rest!

Best regards,
Jesse Pomeroy
Angel's Rest
https://angelsrest.online
  `.trim();

	await resend.emails.send({
		from: "Angel's Rest <orders@angelsrest.online>",
		to: [customerEmail],
		subject: `Order Confirmation - ${session.id}`,
		text: emailContent,
	});
}

/** Send order notification email to admin */
async function sendAdminNotification({
	session,
	customerEmail,
	shippingDetails,
	lineItems,
	orderNumber,
}: {
	session: Stripe.Checkout.Session;
	customerEmail: string;
	shippingDetails: any;
	lineItems: Stripe.LineItem[];
	orderNumber?: string;
}) {
	const emailContent = `
🎉 NEW ORDER RECEIVED!

ORDER DETAILS
Order ID: ${session.id}
Customer: ${customerEmail}
Total: ${formatCurrency(session.amount_total || 0)}
Payment Status: ${session.payment_status}

ITEMS TO FULFILL
${formatLineItems(lineItems)}

SHIP TO
${formatShippingAddress(shippingDetails)}

STRIPE DASHBOARD
View full details: https://dashboard.stripe.com/payments/${session.payment_intent}

---
This order was automatically processed through your Angel's Rest website.
  `.trim();

	await resend.emails.send({
		from: "Angel's Rest Orders <orders@angelsrest.online>",
		to: ["thinkingofview@gmail.com"],
		subject: orderNumber 
			? `🛒 New Order ${orderNumber}: ${formatCurrency(session.amount_total || 0)} from ${shippingDetails?.name || customerEmail}`
			: `🛒 New Order: ${formatCurrency(session.amount_total || 0)} from ${shippingDetails?.name || customerEmail}`,
		text: emailContent,
	});
}

// ─── Order Creation ──────────────────────────────────────────────────────────

/**
 * Create an order document in Sanity CMS.
 *
 * After creating the order, waits 3 seconds then fetches actual Stripe fees
 * from the balance_transaction (which isn't available immediately at checkout time).
 */
async function createOrderInSanity({
	session,
	shippingDetails,
	lineItems,
}: {
	session: Stripe.Checkout.Session;
	shippingDetails: any;
	lineItems: Stripe.LineItem[];
}) {
	try {
		// Idempotency check — don't create duplicate orders
		const alreadyExists = await orderExistsForSession(session.id);
		if (alreadyExists) {
			console.log("Order already exists for session:", session.id);
			return;
		}

		const orderNumber = await getNextOrderNumber();

		// Extract payment intent ID (could be string or expanded object)
		const rawPaymentIntent = (session as any).payment_intent;
		const stripePaymentIntentId =
			typeof rawPaymentIntent === "string"
				? rawPaymentIntent
				: rawPaymentIntent?.id;

		const items = lineItems.map((item) => ({
			_key: crypto.randomUUID(),
			productName: item.description || "Unknown Product",
			quantity: item.quantity || 1,
			price: item.amount_total || item.price?.unit_amount || 0,
		}));

		const orderDoc = {
			_type: "order",
			orderNumber,
			stripeSessionId: session.id,
			stripePaymentIntentId,
			customerEmail: session.customer_details?.email || "",
			customerName:
				session.customer_details?.name || shippingDetails?.name || "",
			shippingAddress: shippingDetails?.address
				? {
						line1: shippingDetails.address.line1 || "",
						line2: shippingDetails.address.line2 || "",
						city: shippingDetails.address.city || "",
						state: shippingDetails.address.state || "",
						postalCode: shippingDetails.address.postal_code || "",
						country: shippingDetails.address.country || "",
					}
				: undefined,
			items,
			subtotal: session.amount_subtotal || 0,
			total: session.amount_total || 0,
			currency: session.currency || "usd",
			status: "new",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const result = await adminClient.create(orderDoc);
		console.log("Created order in Sanity:", orderNumber, result._id);

		// Fetch actual Stripe fees after a short delay
		// The balance_transaction isn't available immediately at checkout time
		await captureStripeFees(result._id, orderNumber, stripePaymentIntentId);

		// Return order number for email
		return { orderNumber, _id: result._id };
	} catch (err) {
		console.error("Error creating order in Sanity:", err);
		// Don't throw — emails were already sent, don't fail the webhook
		return null;
	}
}

/**
 * Fetch actual Stripe fees from the balance_transaction and update the order.
 * Waits 3 seconds for Stripe to finalize the transaction before fetching.
 */
async function captureStripeFees(
	orderId: string,
	orderNumber: string,
	paymentIntentId: string | undefined,
) {
	if (!paymentIntentId) return;

	try {
		// Wait for Stripe to finalize the balance_transaction
		await new Promise((resolve) => setTimeout(resolve, 3000));

		const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
			expand: ["latest_charge.balance_transaction"],
		});

		const charge = (pi as any).latest_charge;
		const fees = charge?.balance_transaction?.fee;

		if (fees && fees > 0) {
			await adminClient
				.patch(orderId)
				.set({
					stripeFees: fees,
					updatedAt: new Date().toISOString(),
				})
				.commit();
			console.log("✅ Captured Stripe fees:", orderNumber, "→", fees, "cents");
		} else {
			console.log("⚠️ No fees available after delay for:", orderNumber);
		}
	} catch (err) {
		console.error("Error capturing fees for:", orderNumber, err);
	}
}
