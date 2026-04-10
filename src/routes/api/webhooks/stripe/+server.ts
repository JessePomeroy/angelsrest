/**
 * Stripe Webhook Handler 🪝
 *
 * Receives webhook events from Stripe when purchases happen.
 *
 * Flow for a successful purchase:
 * 1. Customer completes checkout → Stripe fires checkout.session.completed
 * 2. We send confirmation emails (customer + admin)
 * 3. We create an order in Sanity CMS for tracking
 * 4. If LumaPrints products → submit to LumaPrints for fulfillment
 * 5. We fetch actual Stripe fees (with a short delay for availability)
 *
 * 🔒 Security: Every webhook is verified via cryptographic signature
 * 📧 Emails: Customer confirmation + admin notification via Resend
 * 📦 Orders: Stored in Sanity with sequential numbering (ORD-001, ORD-002...)
 * 💰 Fees: Actual Stripe transaction fees captured from balance_transaction
 * 🖨️ Fulfillment: Fine Art Paper prints auto-submitted to LumaPrints
 *
 * Webhook URL: https://www.angelsrest.online/api/webhooks/stripe
 * Events handled: checkout.session.completed, payment_intent.payment_failed
 */

import { error, json } from "@sveltejs/kit";
import { Resend } from "resend";
import Stripe from "stripe";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import {
	RESEND_API_KEY,
	STRIPE_SECRET_KEY,
	STRIPE_WEBHOOK_SECRET,
} from "$env/static/private";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";
import {
	buildLumaPrintsOrder,
	createOrder as createLumaPrintsOrder,
} from "$lib/server/lumaprints";
import { verifyStripeWebhook } from "$lib/server/stripeWebhook";
import type { OrderItem, Recipient } from "$lib/shop/types";

const convex = getConvex();

const stripe = new Stripe(STRIPE_SECRET_KEY);
const resend = new Resend(RESEND_API_KEY);

/** Format cents to USD string (e.g., 1500 → "$15.00") */
const formatCurrency = (amount: number) =>
	new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
	}).format(amount / 100);

/** Format shipping address for emails */
// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
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

// ─── Failure Alerting ────────────────────────────────────────────────────────

/** Send an alert email when a critical webhook operation fails */
async function sendFailureAlert(
	eventType: string,
	sessionId: string,
	errorMessage: string,
) {
	try {
		await resend.emails.send({
			from: "Angel's Rest Alerts <orders@angelsrest.online>",
			to: [env.NOTIFICATION_EMAIL || "thinkingofview@gmail.com"],
			subject: `🚨 Webhook failure: ${eventType}`,
			text: `A critical webhook operation failed. Stripe will retry automatically.

Event: ${eventType}
Session: ${sessionId}
Error: ${errorMessage}

Action required:
- Check Stripe dashboard for the payment: https://dashboard.stripe.com
- If retries exhaust, manually fulfill the order
- Check server logs for full stack trace`,
		});
	} catch (emailErr) {
		// Alert email itself failed — log but don't throw (we're already in error handling)
		console.error("Failed to send failure alert email:", emailErr);
	}
}

// ─── Webhook Entry Point ─────────────────────────────────────────────────────

export async function POST({ request }) {
	const event = await verifyStripeWebhook(
		request,
		stripe,
		STRIPE_WEBHOOK_SECRET,
	);

	console.log(`Received webhook: ${event.type}`);

	try {
		switch (event.type) {
			case "checkout.session.completed": {
				const session = event.data.object as Stripe.Checkout.Session;

				// Invoice payment — mark paid in Convex and skip order creation
				if (session.metadata?.type === "invoice_payment") {
					const invoiceId = session.metadata.invoiceId;
					if (invoiceId) {
						await convex.mutation(api.invoices.markPaid, {
							// biome-ignore lint/suspicious/noExplicitAny: Convex Id type
							invoiceId: invoiceId as any,
							siteUrl: session.metadata?.siteUrl || SITE_DOMAIN,
						});
						console.log("Invoice marked paid:", invoiceId);
					}
					break;
				}

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
		const sessionId =
			event.type === "checkout.session.completed"
				? (event.data.object as Stripe.Checkout.Session).id
				: "unknown";
		const errorMessage = err instanceof Error ? err.message : String(err);

		console.error("Webhook processing failed:", event.type, sessionId, err);
		await sendFailureAlert(event.type, sessionId, errorMessage);
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

	// Fetch full session data with line items and payment details
	const { fullSession, lineItems, shippingDetails } =
		await fetchSessionDetails(session);

	const customerEmail =
		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
		fullSession.customer_details?.email || (session as any).email;

	if (!customerEmail) {
		console.error("No customer email found for session:", session.id);
		return;
	}

	// Create order — this is critical and MUST succeed for the webhook to return 200.
	// If this throws, Stripe will retry (order creation is idempotent via stripeSessionId).
	const orderResult = await createOrderInConvex({
		session: fullSession,
		shippingDetails,
		lineItems,
	});

	// Emails are non-critical — order is already created, don't fail the webhook over email
	try {
		await sendCustomerConfirmation({
			session: fullSession,
			customerEmail,
			shippingDetails,
			lineItems,
			orderNumber: orderResult.orderNumber,
		});
	} catch (err) {
		console.error("Failed to send customer confirmation (non-fatal):", err);
	}

	try {
		await sendAdminNotification({
			session: fullSession,
			customerEmail,
			shippingDetails,
			lineItems,
			orderNumber: orderResult.orderNumber,
		});
	} catch (err) {
		console.error("Failed to send admin notification (non-fatal):", err);
	}

	console.log("Checkout processed successfully:", session.id);
}

/**
 * Fetch complete session data from Stripe.
 * Expands line items and payment intent for fee access.
 * Falls back to event data for test/triggered events.
 */
async function fetchSessionDetails(session: Stripe.Checkout.Session) {
	let fullSession: Stripe.Checkout.Session;
	let lineItems: Stripe.LineItem[] = [];
	// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
	let shippingDetails: any;

	try {
		fullSession = await stripe.checkout.sessions.retrieve(session.id, {
			expand: ["line_items", "customer_details"],
		});
		lineItems = fullSession.line_items?.data || [];
		shippingDetails = session.collected_information?.shipping_details;
	} catch {
		// For Stripe CLI test events, the session may not exist
		console.log(
			"Session retrieval failed (likely test event), using event data",
		);
		fullSession = session;
		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
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
	// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
	shippingDetails: any;
	lineItems: Stripe.LineItem[];
	orderNumber?: string;
}) {
	// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
	const isDigital = (session as any).metadata?.isDigital === "true";

	const digitalSection = isDigital
		? `
DOWNLOAD YOUR PURCHASE
https://www.angelsrest.online/checkout/success?session_id=${session.id}

Your download link will remain active. Visit the link above anytime to re-download.
`
		: `
SHIPPING ADDRESS
${formatShippingAddress(shippingDetails)}

TRACK YOUR ORDER
View your order status anytime: https://angelsrest.online/orders?email=${encodeURIComponent(customerEmail)}&order=${orderNumber}

WHAT'S NEXT?
• Your order will be processed within 1-2 business days
• Made-to-order prints typically ship within 2 weeks
• You'll receive tracking information once your order ships
`;

	const emailContent = `
Hi ${shippingDetails?.name || session.customer_details?.name || "there"},

Thank you for your order! Your payment has been successfully processed.

ORDER DETAILS
Order ID: ${session.id}
Total: ${formatCurrency(session.amount_total || 0)}

ITEMS ORDERED
${formatLineItems(lineItems)}
${digitalSection}
If you have any questions, just reply to this email.

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
	// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
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
		to: [env.NOTIFICATION_EMAIL || "thinkingofview@gmail.com"],
		subject: orderNumber
			? `🛒 New Order ${orderNumber}: ${formatCurrency(session.amount_total || 0)} from ${shippingDetails?.name || customerEmail}`
			: `🛒 New Order: ${formatCurrency(session.amount_total || 0)} from ${shippingDetails?.name || customerEmail}`,
		text: emailContent,
	});
}

// ─── Order Creation ──────────────────────────────────────────────────────────

/**
 * Create an order in Convex.
 *
 * After creating the order, waits 3 seconds then fetches actual Stripe fees
 * from the balance_transaction (which isn't available immediately at checkout time).
 */
async function createOrderInConvex({
	session,
	shippingDetails,
	lineItems,
}: {
	session: Stripe.Checkout.Session;
	// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
	shippingDetails: any;
	lineItems: Stripe.LineItem[];
}) {
	// Extract payment intent ID (could be string or expanded object)
	// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
	const rawPaymentIntent = (session as any).payment_intent;
	const stripePaymentIntentId =
		typeof rawPaymentIntent === "string"
			? rawPaymentIntent
			: rawPaymentIntent?.id;

	const items = lineItems.map((item) => ({
		productName: item.description || "Unknown Product",
		quantity: item.quantity || 1,
		price: item.amount_total || item.price?.unit_amount || 0,
	}));

	// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
	const isDigital = (session as any).metadata?.isDigital === "true";

	// Create order in Convex (idempotent — returns existing order if session already processed)
	const { _id: orderId, orderNumber } = await convex.mutation(
		api.orders.create,
		{
			siteUrl: SITE_DOMAIN,
			stripeSessionId: session.id,
			customerEmail: session.customer_details?.email || "",
			customerName:
				session.customer_details?.name || shippingDetails?.name || undefined,
			stripePaymentIntentId: stripePaymentIntentId || undefined,
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
			items,
			total: session.amount_total || 0,
			subtotal: session.amount_subtotal || undefined,
			fulfillmentType: isDigital ? "digital" : "self",
			// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
			paperName: (session as any).metadata?.paperName || undefined,
			paperSubcategoryId:
				// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
				(session as any).metadata?.paperSubcategoryId || undefined,
		},
	);

	console.log("Created order in Convex:", orderNumber, orderId);

	// Non-critical: capture fees — can be reconciled manually later
	try {
		await captureStripeFees(orderId, orderNumber, stripePaymentIntentId);
	} catch (err) {
		console.error(
			"Failed to capture Stripe fees (non-fatal):",
			orderNumber,
			err,
		);
	}

	// Critical: LumaPrints submission — if this fails, customer paid but nothing prints.
	// Let it throw so the webhook returns 500 and Stripe retries.
	// Order creation is idempotent, so retries are safe.
	await submitToLumaPrints(
		orderId,
		orderNumber,
		lineItems,
		shippingDetails,
		session,
	);

	return { orderNumber, _id: orderId };
}

/**
 * Fetch actual Stripe fees from the balance_transaction and update the order.
 * Waits 3 seconds for Stripe to finalize the transaction before fetching.
 */
async function captureStripeFees(
	// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
	orderId: any,
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

		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
		const charge = (pi as any).latest_charge;
		const fees = charge?.balance_transaction?.fee;

		if (fees && fees > 0) {
			await convex.mutation(api.orders.updateStatus, {
				orderId,
				stripeFees: fees,
			});
			console.log("✅ Captured Stripe fees:", orderNumber, "→", fees, "cents");
		} else {
			console.log("⚠️ No fees available after delay for:", orderNumber);
		}
	} catch (err) {
		console.error("Error capturing fees for:", orderNumber, err);
	}
}

/**
 * Build the list of LumaPrints order items from Stripe checkout metadata.
 *
 * Handles two shapes of order:
 *   - Print set: `metadata.isPrintSet === "true"` with an `imageUrls` JSON array,
 *     one LumaPrints item per image, same paper/size for every image.
 *   - Single print: one item built from `metadata.imageUrl` + the first line item
 *     for the quantity.
 *
 * Returns an empty array if no paper was selected at checkout — caller treats
 * that as "no LumaPrints items in this order" and short-circuits.
 *
 * Pure-ish: no network, no Convex, no fetch. Testable in isolation once the
 * session/lineItems shapes are known.
 */
function buildOrderItemsFromSession(
	session: Stripe.Checkout.Session,
	lineItems: Stripe.LineItem[],
): OrderItem[] {
	// biome-ignore lint/suspicious/noExplicitAny: Stripe metadata is string-only
	const meta = (session.metadata ?? {}) as Record<string, any>;

	const paperSubcategoryId = parseInt(meta.paperSubcategoryId ?? "", 10);
	if (!paperSubcategoryId) return [];

	const width = parseInt(meta.paperWidth ?? "8", 10) || 8;
	const height = parseInt(meta.paperHeight ?? "10", 10) || 10;

	const isPrintSet = meta.isPrintSet === "true";
	if (isPrintSet) {
		let imageUrls: string[] = [];
		try {
			imageUrls = JSON.parse(meta.imageUrls ?? "[]");
		} catch {
			imageUrls = [];
		}
		return imageUrls.map((imageUrl) => ({
			imageUrl,
			paperSubcategoryId,
			width,
			height,
			quantity: 1,
		}));
	}

	const imageUrl = meta.imageUrl ?? "";
	if (!imageUrl) return [];
	return [
		{
			imageUrl,
			paperSubcategoryId,
			width,
			height,
			quantity: lineItems[0]?.quantity ?? 1,
		},
	];
}

/** Build a LumaPrints recipient from Stripe shipping details. */
function buildRecipientFromShipping(
	// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK shipping_details is loosely typed
	shippingDetails: any,
): Recipient {
	const nameParts = (shippingDetails?.name || "").split(" ");
	return {
		firstName: nameParts[0] || "",
		lastName: nameParts.slice(1).join(" ") || "",
		address1: shippingDetails?.address?.line1 || "",
		address2: shippingDetails?.address?.line2 || "",
		city: shippingDetails?.address?.city || "",
		state: shippingDetails?.address?.state || "",
		zip: shippingDetails?.address?.postal_code || "",
		country: shippingDetails?.address?.country || "US",
	};
}

/**
 * Submit order to LumaPrints for fulfillment if it contains LumaPrints products.
 *
 * Critical path (audit #1): if the LumaPrints call fails, this function
 * throws so the webhook returns 500 and Stripe retries. Order creation is
 * idempotent upstream so retries are safe.
 */
async function submitToLumaPrints(
	// biome-ignore lint/suspicious/noExplicitAny: Convex Id types
	orderId: any,
	orderNumber: string,
	lineItems: Stripe.LineItem[],
	// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK shipping_details is loosely typed
	shippingDetails: any,
	session: Stripe.Checkout.Session,
) {
	const items = buildOrderItemsFromSession(session, lineItems);
	if (items.length === 0) {
		console.log("No LumaPrints items in order:", orderNumber);
		return;
	}

	const recipient = buildRecipientFromShipping(shippingDetails);
	const lpOrder = buildLumaPrintsOrder(orderNumber, recipient, items);

	console.log("Submitting to LumaPrints:", orderNumber, items.length, "items");

	const result = await createLumaPrintsOrder(lpOrder);

	// Update Convex order with the LumaPrints order number
	await convex.mutation(api.orders.updateStatus, {
		orderId,
		lumaprintsOrderNumber: result.orderNumber,
	});

	console.log(
		"✅ Submitted to LumaPrints:",
		orderNumber,
		"→",
		result.orderNumber,
	);
}
