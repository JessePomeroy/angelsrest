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

import { json } from "@sveltejs/kit";
import { STRIPE_WEBHOOK_SECRET } from "$env/static/private";
import { getConvex } from "$lib/server/convexClient";
import { processStripeWebhookEvent } from "$lib/server/orderIntake";
import { getResend } from "$lib/server/resendClient";
import { getStripe } from "$lib/server/stripeClient";
import { verifyStripeWebhook } from "$lib/server/stripeWebhook";
import { buildOrderItemsFromSession } from "$lib/server/webhookDecoder";

const convex = getConvex();

// ─── Webhook Entry Point ─────────────────────────────────────────────────────

export async function POST({ request }) {
	const stripe = getStripe();
	const resend = getResend();
	const event = await verifyStripeWebhook(request, stripe, STRIPE_WEBHOOK_SECRET);
	await processStripeWebhookEvent(event, { stripe, resend, convex });
	return json({ received: true });
}

/**
 * Exported for tests only — the production code path goes through
 * `buildOrderItemsFromSession` in webhookDecoder.ts. Re-exporting this
 * lets the cart PR C tests exercise the parser without spinning up the
 * full webhook harness.
 */
export const __test__buildOrderItemsFromSession = buildOrderItemsFromSession;
