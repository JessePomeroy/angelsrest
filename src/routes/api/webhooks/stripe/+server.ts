/**
 * Stripe Webhook Handler
 *
 * Receives webhook events from Stripe when purchases happen.
 *
 * Flow for a successful purchase:
 * 1. Customer completes checkout → Stripe fires checkout.session.completed
 * 2. We send confirmation emails (customer + admin)
 * 3. We create an order in Convex for tracking
 * 4. If LumaPrints products → submit to LumaPrints for fulfillment
 * 5. We fetch actual Stripe fees (with a short delay for availability)
 *
 * Webhook URL: https://www.angelsrest.online/api/webhooks/stripe
 * Events handled: checkout.session.completed, payment_intent.payment_failed
 */

import { error, json } from "@sveltejs/kit";
import { Resend } from "resend";
import Stripe from "stripe";
import { api } from "$convex/api";
import { RESEND_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } from "$env/static/private";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";
import { logStructured } from "$lib/server/logger";
import { verifyStripeWebhook } from "$lib/server/stripeWebhook";
import { buildOrderItemsFromSession } from "$lib/server/webhookDecoder";
import type { ShippingDetails } from "$lib/server/webhookEmails";
import {
	sendAdminNotification,
	sendCustomerConfirmation,
	sendFailureAlert,
	sendPaymentFailedEmail,
} from "$lib/server/webhookEmails";
import { createOrderInConvex } from "$lib/server/webhookOrders";

const convex = getConvex();

const stripe = new Stripe(STRIPE_SECRET_KEY);
const resend = new Resend(RESEND_API_KEY);

// ─── Webhook Entry Point ─────────────────────────────────────────────────────

export async function POST({ request }) {
	const event = await verifyStripeWebhook(request, stripe, STRIPE_WEBHOOK_SECRET);

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
				const failureMessage =
					paymentIntent.last_payment_error?.message || "Your payment method was declined.";
				logStructured({
					event: "payment.failed",
					level: "warn",
					stage: "webhook",
					meta: {
						paymentIntentId: paymentIntent.id,
						failureMessage,
					},
				});
				if (paymentIntent.receipt_email) {
					try {
						await sendPaymentFailedEmail(resend, {
							customerEmail: paymentIntent.receipt_email,
							errorMessage: failureMessage,
						});
					} catch (err) {
						console.error("Failed to send payment-failed email (non-fatal):", err);
					}
				}
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
		await sendFailureAlert(resend, event.type, sessionId ?? "unknown", errorMessage);
		throw error(500, "Webhook processing failed");
	}
}

// ─── Checkout Handler ────────────────────────────────────────────────────────

/**
 * Handle a completed checkout session.
 * Sends emails, creates order in Convex, and captures Stripe fees.
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
	console.log("Processing completed checkout:", session.id);

	// Fetch full session data with line items and payment details
	const { fullSession, lineItems, shippingDetails } = await fetchSessionDetails(session);

	const customerEmail = fullSession.customer_details?.email || session.customer_email;

	if (!customerEmail) {
		console.error("No customer email found for session:", session.id);
		return;
	}

	// Create order — this is critical and MUST succeed for the webhook to return 200.
	// If this throws, Stripe will retry (order creation is idempotent via stripeSessionId).
	const orderResult = await createOrderInConvex(
		{ stripe, convex, resend },
		{
			session: fullSession,
			shippingDetails,
			lineItems,
		},
	);

	// Emails are non-critical — order is already created, don't fail the webhook over email
	try {
		await sendCustomerConfirmation(resend, {
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
		await sendAdminNotification(resend, {
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
	let shippingDetails: ShippingDetails;

	try {
		fullSession = await stripe.checkout.sessions.retrieve(session.id, {
			expand: ["line_items", "customer_details"],
		});
		lineItems = fullSession.line_items?.data || [];
		shippingDetails = session.collected_information?.shipping_details;
	} catch {
		// For Stripe CLI test events, the session may not exist
		console.log("Session retrieval failed (likely test event), using event data");
		fullSession = session;
		shippingDetails = session.collected_information?.shipping_details;
	}

	return { fullSession, lineItems, shippingDetails };
}

/**
 * Exported for tests only — the production code path goes through
 * `buildOrderItemsFromSession` in webhookDecoder.ts. Re-exporting this
 * lets the cart PR C tests exercise the parser without spinning up the
 * full webhook harness.
 */
export const __test__buildOrderItemsFromSession = buildOrderItemsFromSession;
