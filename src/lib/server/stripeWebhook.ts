import { error } from "@sveltejs/kit";
import type Stripe from "stripe";
import { logStructured } from "$lib/server/logger";

/**
 * Read the raw body and signature once, then verify against one or more
 * destination secrets. Callers still own event dispatch and business authority.
 */
export async function verifyStripeWebhook(
	request: Request,
	stripe: Stripe,
	webhookSecrets: string | readonly string[],
	logLabel = "Webhook",
): Promise<Stripe.Event> {
	const body = await request.text();
	const signature = request.headers.get("stripe-signature");

	if (!signature) {
		throw error(400, "Missing stripe-signature header");
	}

	const candidates = [
		...new Set(
			(typeof webhookSecrets === "string" ? [webhookSecrets] : webhookSecrets).filter(
				(secret) => secret.length > 0,
			),
		),
	];
	let verificationError: unknown;
	for (const secret of candidates) {
		try {
			return stripe.webhooks.constructEvent(body, signature, secret);
		} catch (err: unknown) {
			verificationError = err;
		}
	}

	const message = verificationError instanceof Error ? verificationError.message : "Unknown error";
	logStructured({
		event: "webhook.signature_verification_failed",
		level: "error",
		stage: "webhook",
		error: verificationError,
		meta: { logLabel, message },
	});
	throw error(400, `Webhook Error: ${message}`);
}
