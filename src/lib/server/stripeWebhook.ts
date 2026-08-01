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
	const failureCategories = new Set<string>();
	for (const secret of candidates) {
		try {
			return stripe.webhooks.constructEvent(body, signature, secret);
		} catch (err: unknown) {
			failureCategories.add(classifyVerificationFailure(err));
		}
	}

	logStructured({
		event: "webhook.signature_verification_failed",
		level: "error",
		stage: "webhook",
		meta: {
			logLabel,
			candidateCount: candidates.length,
			failureCategories: [...failureCategories],
		},
	});
	throw error(400, "Webhook signature verification failed");
}

function classifyVerificationFailure(err: unknown) {
	const message = err instanceof Error ? err.message.toLowerCase() : "";
	if (message.includes("timestamp") && message.includes("tolerance")) return "timestamp";
	if (message.includes("json") || message.includes("unexpected token")) {
		return "malformed_payload";
	}
	return "signature";
}
