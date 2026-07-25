import { json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { getConvex } from "$lib/server/convexClient";
import { createOrder as createLumaPrintsOrder } from "$lib/server/lumaprints";
import { processStripeWebhookEvent } from "$lib/server/orderIntake";
import { getResend } from "$lib/server/resendClient";
import { getStripe } from "$lib/server/stripeClient";
import { verifyStripeWebhook } from "$lib/server/stripeWebhook";

const convex = getConvex();

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
