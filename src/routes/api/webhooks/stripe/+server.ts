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
import {
	RESEND_API_KEY,
	STRIPE_SECRET_KEY,
	STRIPE_WEBHOOK_SECRET,
} from "$env/static/private";
import { SITE_DOMAIN } from "$lib/config/site";
import { createOrder as createLumaPrintsOrder } from "$lib/lumaprints/client";
import { getConvex } from "$lib/server/convexClient";

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
		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
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
			// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
			fullSession.customer_details?.email || (session as any).email;

		if (!customerEmail) {
			console.error("No customer email found for session:", session.id);
			return;
		}

		// Create order first so we have the order number for the email
		const orderResult = await createOrderInConvex({
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
		to: ["thinkingofview@gmail.com"],
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
	try {
		// Get next order number from Convex
		const orderNumber = await convex.query(api.orders.getNextOrderNumber, {
			siteUrl: SITE_DOMAIN,
		});

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

		// Create order in Convex
		const orderId = await convex.mutation(api.orders.create, {
			siteUrl: SITE_DOMAIN,
			orderNumber,
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
		});

		console.log("Created order in Convex:", orderNumber, orderId);

		// Fetch actual Stripe fees after a short delay
		await captureStripeFees(orderId, orderNumber, stripePaymentIntentId);

		// Submit to LumaPrints if applicable
		await submitToLumaPrints(
			orderId,
			orderNumber,
			lineItems,
			shippingDetails,
			session,
		);

		return { orderNumber, _id: orderId };
	} catch (err) {
		console.error("Error creating order in Convex:", err);
		return null;
	}
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
 * Submit order to LumaPrints for fulfillment if it contains LumaPrints products.
 *
 * Looks up each line item in Sanity to check fulfillmentType.
 * Only submits if at least one item is LumaPrints-fulfilled.
 */
async function submitToLumaPrints(
	// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
	orderId: any,
	orderNumber: string,
	lineItems: Stripe.LineItem[],
	// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
	shippingDetails: any,
	session: Stripe.Checkout.Session,
) {
	try {
		// Check if this is a print set order
		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
		const isPrintSet = (session as any).metadata?.isPrintSet === "true";
		// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
		const imageUrlsJson = (session as any).metadata?.imageUrls || "[]";
		let imageUrls: string[] = [];
		try {
			imageUrls = JSON.parse(imageUrlsJson);
		} catch {
			imageUrls = [];
		}

		// Check each line item for paper selection from metadata
		const lumaprintsItems: {
			externalItemId: string;
			productName: string;
			quantity: number;
			subcategoryId: number;
			width: number;
			height: number;
			options: number[];
			imageUrl: string;
		}[] = [];

		// Get paper info from Stripe metadata (passed during checkout)
		const paperSubcategoryId =
			// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
			(session as any).metadata?.paperSubcategoryId || "";
		const paperWidth = parseInt(
			// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
			(session as any).metadata?.paperWidth || "8",
			10,
		);
		const paperHeight = parseInt(
			// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
			(session as any).metadata?.paperHeight || "10",
			10,
		);

		if (isPrintSet && imageUrls.length > 0) {
			// Print set: create one LumaPrints item per image
			for (let i = 0; i < imageUrls.length; i++) {
				const rawImageUrl = imageUrls[i] || "";
				const imageUrl = rawImageUrl.split("?")[0].replace(/\.webp$/, ".jpg");

				lumaprintsItems.push({
					externalItemId: `print-set-${i + 1}`,
					// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
					productName: `${(session as any).metadata?.productId} - ${i + 1}/${imageUrls.length}`,
					quantity: 1,
					subcategoryId: parseInt(paperSubcategoryId, 10) || 103001,
					width: paperWidth || 8,
					height: paperHeight || 10,
					options: [39],
					imageUrl,
				});
			}
		} else if (paperSubcategoryId) {
			// Single product: create one item
			// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
			const rawImageUrl = (session as any).metadata?.imageUrl || "";
			const imageUrl = rawImageUrl.split("?")[0].replace(/\.webp$/, ".jpg");

			const item = lineItems[0];
			lumaprintsItems.push({
				externalItemId: item?.id || "single-item",
				productName: item?.description || "Print",
				quantity: item?.quantity || 1,
				subcategoryId: parseInt(paperSubcategoryId, 10),
				width: paperWidth || 8,
				height: paperHeight || 10,
				options: [39],
				imageUrl,
			});
		}

		if (lumaprintsItems.length === 0) {
			console.log("No LumaPrints items in order:", orderNumber);
			return;
		}

		// Build LumaPrints order
		const nameParts = (shippingDetails?.name || "").split(" ");
		const firstName = nameParts[0] || "";
		const lastName = nameParts.slice(1).join(" ") || "";

		const lumaprintsOrder = {
			externalId: orderNumber,
			storeId: 83765,
			shippingMethod: "default" as const,
			productionTime: "regular" as const,
			recipient: {
				firstName,
				lastName,
				addressLine1: shippingDetails?.address?.line1 || "",
				addressLine2: shippingDetails?.address?.line2 || "",
				city: shippingDetails?.address?.city || "",
				state: shippingDetails?.address?.state || "",
				zipCode: shippingDetails?.address?.postal_code || "",
				country: shippingDetails?.address?.country || "US",
				phone: "",
			},
			orderItems: lumaprintsItems.map((item, index) => ({
				externalItemId: `item-${index + 1}`,
				subcategoryId: item.subcategoryId,
				quantity: item.quantity,
				width: item.width,
				height: item.height,
				file: {
					imageUrl: item.imageUrl,
				},
				orderItemOptions: item.options,
			})),
		};

		console.log(
			"Submitting to LumaPrints:",
			orderNumber,
			lumaprintsItems.length,
			"items",
			JSON.stringify(lumaprintsItems),
		);

		const result = await createLumaPrintsOrder(lumaprintsOrder);

		// Update Convex order with LumaPrints order number
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
	} catch (err) {
		console.error("Error submitting to LumaPrints:", err);
		// Don't fail the webhook - just log the error
		// Order is still created in Sanity, fulfillment can be done manually
	}
}
