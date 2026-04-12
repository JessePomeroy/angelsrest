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
import { logStructured, timed } from "$lib/server/logger";
import {
	buildLumaPrintsOrder,
	createOrder as createLumaPrintsOrder,
} from "$lib/server/lumaprints";
import { verifyStripeWebhook } from "$lib/server/stripeWebhook";
import {
	classifyLumaPrintsFailure,
	formatFailureForAdmin,
} from "$lib/server/webhookErrorClassification";
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

	// Track total webhook duration manually (rather than via `timed`) so the
	// existing catch path stays exactly as it was — we want a single
	// captureException, not double-capture from `timed` + outer catch.
	const webhookStart = Date.now();
	const sessionId =
		event.type === "checkout.session.completed"
			? (event.data.object as Stripe.Checkout.Session).id
			: undefined;

	logStructured({
		event: "webhook.received",
		stage: "webhook",
		sessionId,
		meta: { stripeEventType: event.type },
	});

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
						logStructured({
							event: "invoice.marked_paid",
							stage: "webhook",
							meta: { invoiceId },
						});
					}
					break;
				}

				await handleCheckoutCompleted(session);
				break;
			}

			case "payment_intent.payment_failed": {
				const paymentIntent = event.data.object as Stripe.PaymentIntent;
				logStructured({
					event: "payment.failed",
					level: "warn",
					stage: "webhook",
					meta: { paymentIntentId: paymentIntent.id },
				});
				// TODO: Could send "payment failed" email to customer
				break;
			}

			default:
				// Ignore other events (charge.succeeded, payment_intent.succeeded, etc.)
				// Fees are captured directly in handleCheckoutCompleted
				break;
		}

		logStructured({
			event: "webhook.processed",
			stage: "webhook",
			sessionId,
			durationMs: Date.now() - webhookStart,
			meta: { stripeEventType: event.type },
		});

		return json({ received: true });
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);

		logStructured({
			event: "webhook.failed",
			level: "error",
			stage: "webhook",
			sessionId,
			durationMs: Date.now() - webhookStart,
			error: err,
			meta: { stripeEventType: event.type },
		});
		await sendFailureAlert(event.type, sessionId ?? "unknown", errorMessage);
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

	// Critical: LumaPrints submission.
	//
	// Audit #23 PR #3 expanded the error handling here into a 3-signal fallback:
	// - **Transient errors** (network, LumaPrints 5xx, unknown) → re-throw so
	//   the webhook returns 500 and Stripe retries with backoff. Order creation
	//   is idempotent via `by_stripeSessionId`, so retries are safe. This is
	//   audit #1's original behavior, preserved for transient failures.
	// - **Permanent errors** (4xx from LumaPrints, invalid payload, rejected
	//   image, validation failure) → take the refund path: auto-refund the
	//   customer via Stripe, mark the order `fulfillment_error` in Convex,
	//   email the admin with full error context, and return 200 so Stripe
	//   doesn't retry (the underlying problem is permanent).
	//
	// Classification lives in `webhookErrorClassification.ts` and is
	// conservative: unknown errors default to transient so we don't refund
	// customers based on our own bugs.
	try {
		await submitToLumaPrints(
			orderId,
			orderNumber,
			lineItems,
			shippingDetails,
			session,
		);
	} catch (err) {
		const classification = classifyLumaPrintsFailure(err);
		// `timed` inside submitToLumaPrints already captured the exception
		// to Sentry — log the classification as a follow-up info event so
		// dashboards can group "permanent vs transient" without producing
		// a duplicate Sentry issue.
		logStructured({
			event: "lumaprints.classified",
			level: "warn",
			stage: "lumaprints_submit",
			orderId: orderNumber,
			meta: { classification },
		});

		if (classification === "transient") {
			// Re-throw — Stripe retries the webhook.
			throw err;
		}

		// Permanent failure: refund + mark order + notify admin + return 200.
		await handlePermanentFulfillmentFailure({
			orderId,
			orderNumber,
			error: err,
			session,
			customerEmail:
				// biome-ignore lint/suspicious/noExplicitAny: Stripe SDK types
				(session as any).customer_details?.email ?? "unknown",
		});
	}

	return { orderNumber, _id: orderId };
}

/**
 * 3-signal permanent-failure fallback introduced in audit #23 PR #3.
 *
 * 1. Auto-refund via `stripe.refunds.create` with reason
 *    `requested_by_customer` and a metadata note pointing at the order.
 * 2. Mark the Convex order `fulfillment_error` with the human-readable
 *    error message and the Stripe refund ID for audit trail.
 * 3. Send an admin email with order details, error message, and a link
 *    to the order in the admin dashboard.
 *
 * All three signals are best-effort — if any one fails, we log and
 * continue so the other two still fire. The caller returns 200 to Stripe
 * unconditionally after this runs: the underlying LumaPrints failure is
 * permanent, retries won't help.
 */
async function handlePermanentFulfillmentFailure({
	orderId,
	orderNumber,
	error: fulfillmentError,
	session,
	customerEmail,
}: {
	// biome-ignore lint/suspicious/noExplicitAny: Convex Id types
	orderId: any;
	orderNumber: string;
	error: unknown;
	session: Stripe.Checkout.Session;
	customerEmail: string;
}) {
	const errorSummary = formatFailureForAdmin(fulfillmentError);
	let stripeRefundId: string | undefined;

	// 1. Stripe refund
	try {
		const paymentIntentId =
			typeof session.payment_intent === "string"
				? session.payment_intent
				: (session.payment_intent?.id ?? undefined);

		if (!paymentIntentId) {
			logStructured({
				event: "refund.skipped",
				level: "error",
				stage: "stripe_refund",
				orderId: orderNumber,
				error: new Error("no payment_intent on session"),
			});
		} else {
			const refund = await stripe.refunds.create({
				payment_intent: paymentIntentId,
				reason: "requested_by_customer",
				metadata: {
					orderNumber,
					fulfillmentError: errorSummary.slice(0, 500),
					automated: "audit_23_pr_3",
				},
			});
			stripeRefundId = refund.id;
			logStructured({
				event: "refund.created",
				stage: "stripe_refund",
				orderId: orderNumber,
				meta: { refundId: refund.id, refundStatus: refund.status },
			});
		}
	} catch (refundErr) {
		logStructured({
			event: "refund.failed",
			level: "error",
			stage: "stripe_refund",
			orderId: orderNumber,
			error: refundErr,
		});
	}

	// 2. Mark Convex order fulfillment_error
	try {
		await convex.mutation(api.orders.updateStatus, {
			orderId,
			status: "fulfillment_error",
			fulfillmentError: errorSummary.slice(0, 1000),
			stripeRefundId,
		});
	} catch (convexErr) {
		logStructured({
			event: "fulfillment_error.convex_update_failed",
			level: "error",
			stage: "fulfillment_failure",
			orderId: orderNumber,
			error: convexErr,
		});
	}

	// 3. Admin email
	try {
		await sendFulfillmentFailureAlert({
			orderNumber,
			customerEmail,
			errorSummary,
			stripeRefundId,
			total: session.amount_total ?? 0,
		});
	} catch (emailErr) {
		logStructured({
			event: "fulfillment_error.email_failed",
			level: "error",
			stage: "email_admin",
			orderId: orderNumber,
			error: emailErr,
		});
	}
}

/**
 * Admin notification email for permanent fulfillment failures.
 * Sent to NOTIFICATION_EMAIL (with Jesse's personal Gmail as fallback,
 * matching the pattern used elsewhere in this file).
 */
async function sendFulfillmentFailureAlert({
	orderNumber,
	customerEmail,
	errorSummary,
	stripeRefundId,
	total,
}: {
	orderNumber: string;
	customerEmail: string;
	errorSummary: string;
	stripeRefundId: string | undefined;
	total: number;
}) {
	const adminEmail = env.NOTIFICATION_EMAIL || "thinkingofview@gmail.com";
	const refundLine = stripeRefundId
		? `✅ Customer auto-refunded via Stripe (refund ID: ${stripeRefundId})`
		: "⚠️ Refund FAILED — manual intervention required";

	await resend.emails.send({
		from: "Angel's Rest Alerts <orders@angelsrest.online>",
		to: [adminEmail],
		subject: `[URGENT] Fulfillment error on order ${orderNumber}`,
		text: `
Order ${orderNumber} permanently failed at LumaPrints submission.

Customer: ${customerEmail}
Amount: ${formatCurrency(total)}

${refundLine}

Error details:
${errorSummary}

The order has been marked fulfillment_error in the admin dashboard.
No action required unless the refund failed above.

Admin dashboard: https://${SITE_DOMAIN}/admin/orders
`.trim(),
	});
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
 * Handles three shapes of order:
 *   - **Cart** (added cart PR C): `metadata.isCart === "true"` with one
 *     `cartItem_{n}` JSON entry per line. Each cart item carries its own
 *     paper/size, so this branch ignores the top-level paper metadata.
 *     Encoding contract is shared with `buildCartMetadata` in
 *     `src/routes/api/cart/checkout/+server.ts` — keep them in sync.
 *   - **Print set:** `metadata.isPrintSet === "true"` with an `imageUrls`
 *     JSON array, one LumaPrints item per image, same paper/size for
 *     every image. Reads paper from top-level metadata.
 *   - **Single print:** one item built from `metadata.imageUrl` + the
 *     first line item for the quantity. Reads paper from top-level metadata.
 *
 * Returns an empty array when there's nothing to fulfill (no LumaPrints
 * items in the order, e.g. digital-only or invoice payments). Caller
 * treats that as a short-circuit.
 *
 * Pure-ish: no network, no Convex, no fetch. Testable in isolation once
 * the session/lineItems shapes are known.
 */
function buildOrderItemsFromSession(
	session: Stripe.Checkout.Session,
	lineItems: Stripe.LineItem[],
): OrderItem[] {
	// biome-ignore lint/suspicious/noExplicitAny: Stripe metadata is string-only
	const meta = (session.metadata ?? {}) as Record<string, any>;

	// ─── Path 1: Cart (multi-item, per-line paper/size) ───────────────────
	if (meta.isCart === "true") {
		const count = Number.parseInt(meta.cartItemCount ?? "0", 10);
		if (!Number.isFinite(count) || count <= 0) return [];

		const items: OrderItem[] = [];
		for (let i = 0; i < count; i++) {
			const raw = meta[`cartItem_${i}`];
			if (typeof raw !== "string" || !raw) continue;
			try {
				// Compact representation from buildCartMetadata. Field semantics:
				//  - `u` always present: cover image (cart UI thumbnail)
				//  - `q` always present: cart line quantity
				//  - `s/w/h` for LumaPrints prints; absent → self-fulfilled merch,
				//    skip the line entirely
				//  - `i` for print sets: array of image URLs to expand into one
				//    OrderItem per image, multiplied through by `q`
				const parsed = JSON.parse(raw) as {
					u?: string;
					s?: number;
					w?: number;
					h?: number;
					q?: number;
					i?: string[];
					b?: number;
					f?: number;
				};
				if (typeof parsed.u !== "string" || typeof parsed.q !== "number") {
					continue;
				}
				const hasPaper =
					typeof parsed.s === "number" &&
					typeof parsed.w === "number" &&
					typeof parsed.h === "number";
				if (!hasPaper) {
					// Self-fulfilled merch — skip LumaPrints submission entirely.
					continue;
				}
				const border =
					typeof parsed.b === "number" && parsed.b > 0 ? parsed.b : undefined;
				const frame =
					typeof parsed.f === "number" && parsed.f > 0 ? parsed.f : undefined;
				if (Array.isArray(parsed.i) && parsed.i.length > 0) {
					for (const url of parsed.i) {
						if (typeof url !== "string" || !url) continue;
						items.push({
							imageUrl: url,
							paperSubcategoryId: parsed.s as number,
							width: parsed.w as number,
							height: parsed.h as number,
							quantity: parsed.q,
							borderWidth: border,
							frameSubcategoryId: frame,
						});
					}
					continue;
				}
				items.push({
					imageUrl: parsed.u,
					paperSubcategoryId: parsed.s as number,
					width: parsed.w as number,
					height: parsed.h as number,
					quantity: parsed.q,
					borderWidth: border,
					frameSubcategoryId: frame,
				});
			} catch {
				// Skip malformed entries — partial fulfillment is better than
				// throwing the entire order on the floor for one bad row.
			}
		}
		return items;
	}

	// ─── Existing paths use top-level paperSubcategoryId ──────────────────
	const paperSubcategoryId = Number.parseInt(meta.paperSubcategoryId ?? "", 10);
	if (!paperSubcategoryId) return [];

	const width = Number.parseInt(meta.paperWidth ?? "8", 10) || 8;
	const height = Number.parseInt(meta.paperHeight ?? "10", 10) || 10;

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

/**
 * Exported for tests only — the production code path goes through
 * `buildOrderItemsFromSession` above. Re-exporting this lets the cart
 * PR C tests exercise the parser without spinning up the full webhook
 * harness.
 */
export const __test__buildOrderItemsFromSession = buildOrderItemsFromSession;

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
		logStructured({
			event: "lumaprints.skipped",
			stage: "lumaprints_submit",
			orderId: orderNumber,
			meta: { reason: "no LumaPrints items in order" },
		});
		return;
	}

	// ─── Sharp border compositing ────────────────────────────────────
	// Detect items with a borderWidth, run Sharp to composite a white
	// border, upload to R2, and replace the image URL with the R2 URL.
	const borderedItems = items
		.map((item, index) => ({
			index,
			imageUrl: item.imageUrl,
			borderWidthInches: item.borderWidth ?? 0,
		}))
		.filter((item) => item.borderWidthInches > 0);

	if (borderedItems.length > 0) {
		const { processBorderedPrints } = await import("$lib/server/sharpBorder");
		const urlMap = await timed(
			{
				event: "sharp.bordered",
				stage: "sharp_composite",
				orderId: orderNumber,
				meta: { borderedCount: borderedItems.length },
			},
			() => processBorderedPrints(borderedItems, orderNumber),
		);
		// Replace original URLs with R2 URLs for bordered items
		for (const [index, r2Url] of urlMap) {
			items[index].imageUrl = r2Url;
		}
	}

	const recipient = buildRecipientFromShipping(shippingDetails);
	const lpOrder = buildLumaPrintsOrder(orderNumber, recipient, items);

	// `timed` logs an info entry with durationMs on success and an error
	// entry (with Sentry capture) on failure, then re-throws so the caller's
	// classify-and-fallback path runs unchanged.
	const result = await timed(
		{
			event: "lumaprints.submitted",
			stage: "lumaprints_submit",
			orderId: orderNumber,
			meta: { itemCount: items.length },
		},
		() => createLumaPrintsOrder(lpOrder),
	);

	// Update Convex order with the LumaPrints order number
	await convex.mutation(api.orders.updateStatus, {
		orderId,
		lumaprintsOrderNumber: result.orderNumber,
	});

	logStructured({
		event: "lumaprints.recorded",
		stage: "lumaprints_submit",
		orderId: orderNumber,
		meta: { lumaprintsOrderNumber: result.orderNumber },
	});
}
