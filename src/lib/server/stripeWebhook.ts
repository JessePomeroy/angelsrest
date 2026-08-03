import { error } from "@sveltejs/kit";
import type Stripe from "stripe";
import { logStructured } from "$lib/server/logger";
import { STRIPE_API_VERSION } from "$lib/server/stripeApiVersion";

/**
 * Read the raw body and signature once, then verify against one or more
 * destination secrets. Callers still own event dispatch and business authority.
 */
export type CommerceWebhookRole = "your-account" | "connected-accounts";

export interface StripeWebhookSecretCandidate<Role extends string = string> {
	role: Role;
	secret: string;
}

export interface VerifiedStripeWebhook<Role extends string = string> {
	event: Stripe.Event;
	role: Role;
}

export async function verifyStripeWebhook(
	request: Request,
	stripe: Stripe,
	webhookSecrets: string | readonly string[],
	logLabel = "Webhook",
): Promise<Stripe.Event> {
	const secrets = typeof webhookSecrets === "string" ? [webhookSecrets] : webhookSecrets;
	const { event } = await verifyStripeWebhookWithRole(
		request,
		stripe,
		secrets.map((secret) => ({ role: "webhook", secret })),
		logLabel,
	);
	return event;
}

export async function verifyStripeWebhookWithRole<Role extends string>(
	request: Request,
	stripe: Stripe,
	webhookSecrets: readonly StripeWebhookSecretCandidate<Role>[],
	logLabel = "Webhook",
): Promise<VerifiedStripeWebhook<Role>> {
	const candidates = normalizeCandidates(webhookSecrets, logLabel);
	const body = await request.text();
	const signature = request.headers.get("stripe-signature");

	if (!signature) {
		throw error(400, "Missing stripe-signature header");
	}

	const failureCategories = new Set<string>();
	for (const candidate of candidates) {
		let event: Stripe.Event;
		try {
			event = stripe.webhooks.constructEvent(body, signature, candidate.secret);
		} catch (err: unknown) {
			failureCategories.add(classifyVerificationFailure(err));
			continue;
		}
		assertWebhookApiVersion(event, logLabel);
		return { event, role: candidate.role };
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

function assertWebhookApiVersion(event: Stripe.Event, logLabel: string) {
	if (event.api_version === STRIPE_API_VERSION) return;
	logStructured({
		event: "webhook.api_version_rejected",
		level: "error",
		stage: "webhook",
		meta: {
			logLabel,
			eventType: event.type,
			expectedApiVersion: STRIPE_API_VERSION,
			actualApiVersion: event.api_version ?? "missing",
		},
	});
	throw error(400, "Webhook API version is unsupported");
}

function normalizeCandidates<Role extends string>(
	candidates: readonly StripeWebhookSecretCandidate<Role>[],
	logLabel: string,
) {
	const distinct = new Map<string, StripeWebhookSecretCandidate<Role>>();
	for (const candidate of candidates) {
		if (!candidate.secret) continue;
		const existing = distinct.get(candidate.secret);
		if (existing?.role === candidate.role) continue;
		if (existing) {
			logStructured({
				event: "webhook.secret_configuration_invalid",
				level: "error",
				stage: "webhook",
				meta: {
					logLabel,
					candidateCount: candidates.length,
					roleCount: new Set(candidates.map(({ role }) => role)).size,
				},
			});
			throw error(500, "Webhook secret configuration is invalid");
		}
		distinct.set(candidate.secret, candidate);
	}
	return [...distinct.values()];
}

function classifyVerificationFailure(err: unknown) {
	const message = err instanceof Error ? err.message.toLowerCase() : "";
	if (message.includes("timestamp") && message.includes("tolerance")) return "timestamp";
	if (message.includes("json") || message.includes("unexpected token")) {
		return "malformed_payload";
	}
	return "signature";
}
