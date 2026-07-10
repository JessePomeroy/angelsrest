/**
 * Stripe Webhook Handler
 *
 * Receives webhook events from Stripe when purchases happen.
 *
 * Flow for a successful purchase:
 * 1. Verify Stripe's signature against the raw request body.
 * 2. Resolve the platform/connected-account tenant and checkout kind.
 * 3. Create or reuse the idempotent Convex order.
 * 4. Schedule Stripe fee capture outside the webhook hot path.
 * 5. Submit eligible print items to LumaPrints.
 * 6. Send the applicable customer/admin notifications.
 *
 * Webhook URL: https://www.angelsrest.online/api/webhooks/stripe
 * Events handled: checkout.session.completed, payment_intent.payment_failed
 */

import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { getConvex } from "$lib/server/convexClient";
import { createOrder as createLumaPrintsOrder } from "$lib/server/lumaprints";
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
	const event = await verifyStripeWebhook(request, stripe, getCommerceWebhookSecret());
	await processStripeWebhookEvent(event, { stripe, resend, convex, createLumaPrintsOrder });
	return json({ received: true });
}

function getCommerceWebhookSecret() {
	const secret = env.STRIPE_CONNECT_WEBHOOK_SECRET || env.STRIPE_WEBHOOK_SECRET;
	if (!secret) {
		throw new Error(
			"Stripe commerce webhook secret is not set. Configure STRIPE_CONNECT_WEBHOOK_SECRET or STRIPE_WEBHOOK_SECRET.",
		);
	}
	return secret;
}

/**
 * Exported for tests only — the production code path goes through
 * `buildOrderItemsFromSession` in webhookDecoder.ts. Re-exporting this
 * lets cart-shape tests exercise the parser without spinning up the
 * full webhook harness.
 */
export const __test__buildOrderItemsFromSession = buildOrderItemsFromSession;
