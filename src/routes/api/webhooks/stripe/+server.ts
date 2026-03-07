/**
 * Stripe Webhook Handler 🪝
 *
 * This endpoint receives webhook events from Stripe when things happen in your account.
 * Most importantly: when a customer completes a purchase, we automatically send emails.
 *
 * 🔒 Security: We verify every webhook came from Stripe using cryptographic signatures
 * 📧 Automation: Sends confirmation email to customer + notification to admin
 * 🔄 Reliability: Even if your checkout page crashes, webhooks still fire
 *
 * Webhook URL: https://www.angelsrest.online/api/webhooks/stripe
 * Events we handle: checkout.session.completed, payment_intent.payment_failed
 *
 * 📚 See guides/stripe-webhooks.md for full setup and troubleshooting guide
 */

import { json, error } from "@sveltejs/kit";
import Stripe from "stripe";
import { Resend } from "resend";
import {
	STRIPE_SECRET_KEY,
	STRIPE_WEBHOOK_SECRET,
	RESEND_API_KEY,
} from "$env/static/private";
import { adminClient } from "$lib/sanity/adminClient";
import {
	getNextOrderNumber,
	orderExistsForSession,
} from "$lib/orders/orderNumber";

const stripe = new Stripe(STRIPE_SECRET_KEY);
const resend = new Resend(RESEND_API_KEY);

export async function POST({ request }) {
	// Get the raw body and signature from Stripe's webhook request
	const body = await request.text(); // IMPORTANT: Must be raw text, not JSON
	const signature = request.headers.get("stripe-signature");

	if (!signature) {
		console.error("Missing stripe-signature header");
		throw error(400, "Missing stripe-signature header");
	}

	let event: Stripe.Event;

	try {
		/**
		 * 🔒 CRITICAL SECURITY STEP
		 *
		 * This verifies the webhook actually came from Stripe using cryptographic signatures.
		 * Without this, anyone could send fake "payment completed" requests to your server.
		 *
		 * How it works:
		 * 1. Stripe signs each webhook with your secret key
		 * 2. We recreate the signature using the same secret + request body
		 * 3. If signatures match = legitimate webhook from Stripe
		 * 4. If they don't match = reject the request
		 */
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
		/**
		 * 🎯 EVENT ROUTING
		 *
		 * Stripe sends many different event types. We handle the important ones:
		 *
		 * checkout.session.completed = Customer successfully paid
		 * payment_intent.payment_failed = Payment was attempted but failed
		 *
		 * Other events we could handle in the future:
		 * - invoice.payment_succeeded (for subscriptions)
		 * - customer.subscription.deleted (cancellations)
		 * - charge.dispute.created (chargebacks)
		 */
		switch (event.type) {
			case "checkout.session.completed": {
				// ✅ SUCCESS: Customer completed their purchase
				const session = event.data.object as Stripe.Checkout.Session;
				await handleCheckoutCompleted(session);
				break;
			}

			case "payment_intent.payment_failed": {
				// ❌ FAILURE: Payment attempt was declined/failed
				const paymentIntent = event.data.object as Stripe.PaymentIntent;
				console.log("Payment failed:", paymentIntent.id);
				// TODO: Could send "payment failed" email to customer here
				break;
			}

			default:
				// 📝 LOG: We receive but don't process this event type
				console.log(`Unhandled event type: ${event.type}`);
		}

		return json({ received: true });
	} catch (err) {
		console.error("Error processing webhook:", err);
		throw error(500, "Webhook processing failed");
	}
}

/**
 * Handle completed checkout sessions
 * Sends confirmation email to customer and notification to admin
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
	console.log("Processing completed checkout:", session.id);

	try {
		/**
		 * 📦 FETCH COMPLETE ORDER DATA
		 *
		 * The webhook gives us basic session info, but we need more details:
		 * - line_items: What exactly did they buy?
		 * - customer_details: Full customer info for email
		 *
		 * Note: For Stripe CLI test events (stripe trigger), the session doesn't
		 * actually exist in Stripe, so we'll fall back to event data if retrieval fails.
		 */
		let fullSession: Stripe.Checkout.Session;
		let lineItems: Stripe.LineItem[] = [];
		let shippingDetails: any;
		let stripeFees = 0;

		try {
			// Try to fetch full session with line items and payment intent (for fees)
			fullSession = await stripe.checkout.sessions.retrieve(session.id, {
				expand: ["line_items", "customer_details", "payment_intent"],
			});
			lineItems = fullSession.line_items?.data || [];
			shippingDetails = session.collected_information?.shipping_details;

			// Get actual fees from balance_transaction
			// This gives us the real Stripe fees instead of calculating
			try {
				const paymentIntentId = (fullSession as any).payment_intent;
				console.log("Payment Intent ID:", paymentIntentId);
				if (paymentIntentId) {
					const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
					console.log("Payment Intent:", paymentIntent);
					if (paymentIntent.balance_transaction) {
						const balanceTx = await stripe.balanceTransactions.retrieve(
							paymentIntent.balance_transaction as string
						);
						stripeFees = balanceTx.fee; // Fees in cents
						console.log("Stripe fees captured:", stripeFees);
					}
				}
			} catch (feeError) {
				console.error("Error fetching fees:", feeError);
			}
		} catch (retrieveError) {
			// For test/triggered events, the session might not exist
			// Use event data directly instead
			console.log(
				"Session retrieval failed (likely test event), using event data:",
				retrieveError,
			);
			fullSession = session;
			// For test events, try to get line items from the event
			// Note: triggered events may not have full line item data
			shippingDetails = (session as any).collected_information?.shipping_details;
		}

		const customerEmail =
			fullSession.customer_details?.email || (session as any).email;

		if (!customerEmail) {
			console.error("No customer email found for session:", session.id);
			return;
		}

		// Send customer confirmation email
		await sendCustomerConfirmation({
			session: fullSession,
			customerEmail,
			shippingDetails,
			lineItems,
		});

		// Send admin notification email
		await sendAdminNotification({
			session: fullSession,
			customerEmail,
			shippingDetails,
			lineItems,
		});

		// Create order in Sanity for tracking
		await createOrderInSanity({
			session: fullSession,
			shippingDetails,
			lineItems,
			stripeFees,
		});

		console.log("Emails sent successfully for session:", session.id);
	} catch (err) {
		console.error("Error in handleCheckoutCompleted:", err);
		throw err;
	}
}

/**
 * Send order confirmation to customer
 */
async function sendCustomerConfirmation({
	session,
	customerEmail,
	shippingDetails,
	lineItems,
}: {
	session: Stripe.Checkout.Session;
	customerEmail: string;
	shippingDetails: any;
	lineItems: Stripe.LineItem[];
}) {
	const formatCurrency = (amount: number) => {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
		}).format(amount / 100);
	};

	const itemsList = lineItems
		.map(
			(item) =>
				`• ${item.description} (${item.quantity}x) - ${formatCurrency(item.amount_total)}`,
		)
		.join("\n");

	const shippingAddress = shippingDetails?.address
		? `
${shippingDetails.name}
${shippingDetails.address.line1}
${shippingDetails.address.line2 || ""}
${shippingDetails.address.city}, ${shippingDetails.address.state} ${shippingDetails.address.postal_code}
${shippingDetails.address.country}`.trim()
		: "No shipping address";

	const emailContent = `
Hi ${shippingDetails?.name || "there"},

Thank you for your order! Your payment has been successfully processed.

ORDER DETAILS
Order ID: ${session.id}
Total: ${formatCurrency(session.amount_total || 0)}

ITEMS ORDERED
${itemsList}

SHIPPING ADDRESS
${shippingAddress}

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

/**
 * Send order notification to admin (you)
 */
async function sendAdminNotification({
	session,
	customerEmail,
	shippingDetails,
	lineItems,
}: {
	session: Stripe.Checkout.Session;
	customerEmail: string;
	shippingDetails: any;
	lineItems: Stripe.LineItem[];
}) {
	const formatCurrency = (amount: number) => {
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: "USD",
		}).format(amount / 100);
	};

	const itemsList = lineItems
		.map(
			(item) =>
				`• ${item.description} (${item.quantity}x) - ${formatCurrency(item.amount_total)}`,
		)
		.join("\n");

	const shippingAddress = shippingDetails?.address
		? `
${shippingDetails.name}
${shippingDetails.address.line1}
${shippingDetails.address.line2 || ""}
${shippingDetails.address.city}, ${shippingDetails.address.state} ${shippingDetails.address.postal_code}
${shippingDetails.address.country}`.trim()
		: "No shipping address";

	const emailContent = `
🎉 NEW ORDER RECEIVED!

ORDER DETAILS
Order ID: ${session.id}
Customer: ${customerEmail}
Total: ${formatCurrency(session.amount_total || 0)}
Payment Status: ${session.payment_status}

ITEMS TO FULFILL
${itemsList}

SHIP TO
${shippingAddress}

STRIPE DASHBOARD
View full details: https://dashboard.stripe.com/payments/${session.payment_intent}

---
This order was automatically processed through your Angel's Rest website.
  `.trim();

	await resend.emails.send({
		from: "Angel's Rest Orders <orders@angelsrest.online>",
		to: ["thinkingofview@gmail.com"],
		subject: `🛒 New Order: ${formatCurrency(session.amount_total || 0)} from ${shippingDetails?.name || customerEmail}`,
		text: emailContent,
	});
}

/**
 * Create an order document in Sanity for tracking
 * This enables custom workflow status, expense tracking, and backup data
 */
async function createOrderInSanity({
	session,
	shippingDetails,
	lineItems,
	stripeFees = 0,
}: {
	session: Stripe.Checkout.Session;
	shippingDetails: any;
	lineItems: Stripe.LineItem[];
	stripeFees?: number;
}) {
	try {
		// Check idempotency - don't create duplicate orders
		const alreadyExists = await orderExistsForSession(session.id);
		if (alreadyExists) {
			console.log("Order already exists for session:", session.id);
			return;
		}

		// Generate sequential order number
		const orderNumber = await getNextOrderNumber();

		// Map line items to Sanity format
		const items = lineItems.map((item) => ({
			_key: crypto.randomUUID(),
			productName: item.description || "Unknown Product",
			quantity: item.quantity || 1,
			// Use amount_total (total for this line) or unit_amount from price object
			price: item.amount_total || item.price?.unit_amount || 0,
		}));

		// Create the order document
		const orderDoc = {
			_type: "order",
			orderNumber,
			stripeSessionId: session.id,
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
			stripeFees,
			currency: session.currency || "usd",
			status: "new",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const result = await adminClient.create(orderDoc);
		console.log("Created order in Sanity:", orderNumber, result._id);
	} catch (err) {
		console.error("Error creating order in Sanity:", err);
		// Don't throw - we already sent emails, don't fail the webhook
	}
}
