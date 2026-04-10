import { error } from "@sveltejs/kit";
import type Stripe from "stripe";

/**
 * Read the raw body, extract the `stripe-signature` header, and verify
 * the webhook signature. Throws a 400 if the header is missing or if
 * Stripe rejects the signature.
 *
 * Returns the parsed, verified Stripe event. Callers still own their
 * own event dispatch logic.
 */
export async function verifyStripeWebhook(
	request: Request,
	stripe: Stripe,
	webhookSecret: string,
	logLabel = "Webhook",
): Promise<Stripe.Event> {
	const body = await request.text();
	const signature = request.headers.get("stripe-signature");

	if (!signature) {
		throw error(400, "Missing stripe-signature header");
	}

	try {
		return stripe.webhooks.constructEvent(body, signature, webhookSecret);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Unknown error";
		console.error(`${logLabel} signature verification failed:`, message);
		throw error(400, `Webhook Error: ${message}`);
	}
}
