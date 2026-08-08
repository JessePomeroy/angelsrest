import { error, json } from "@sveltejs/kit";
import type Stripe from "stripe";
import { env } from "$env/dynamic/private";
import { getConvex } from "$lib/server/convexClient";
import { logStructured } from "$lib/server/logger";
import { createOrder as createLumaPrintsOrder } from "$lib/server/lumaprints";
import { processStripeWebhookEvent } from "$lib/server/orderIntake";
import { assertOrderProducersOpen, OrderProducersClosedError } from "$lib/server/orderProducerGate";
import { getResend } from "$lib/server/resendClient";
import { getStripe } from "$lib/server/stripeClient";
import {
	type CommerceWebhookRole,
	type StripeWebhookSecretCandidate,
	verifyStripeWebhookWithRole,
} from "$lib/server/stripeWebhook";

const convex = getConvex();

export async function POST({ request }) {
	const stripe = getStripe();
	const { event, role } = await verifyStripeWebhookWithRole(
		request,
		stripe,
		getCommerceWebhookSecrets(),
		"Commerce webhook",
	);
	assertCommerceWebhookScope(event, role);
	assertOrderProducingWebhookOpen(event);
	const resend = getResend();
	await processStripeWebhookEvent(event, { stripe, resend, convex, createLumaPrintsOrder }, role);
	return json({ received: true });
}

function assertOrderProducingWebhookOpen(event: Stripe.Event) {
	if (event.type !== "checkout.session.completed") return;
	const session = event.data.object as Stripe.Checkout.Session;
	if (
		session.mode !== "payment" ||
		session.metadata?.type === "platform_subscription" ||
		session.metadata?.type === "invoice_payment"
	) {
		return;
	}
	try {
		assertOrderProducersOpen();
	} catch (cause) {
		if (cause instanceof OrderProducersClosedError) {
			throw error(503, "Order intake is closed");
		}
		throw cause;
	}
}

function getCommerceWebhookSecrets(): StripeWebhookSecretCandidate<CommerceWebhookRole>[] {
	const candidates: StripeWebhookSecretCandidate<CommerceWebhookRole>[] = [];
	if (env.STRIPE_WEBHOOK_SECRET) {
		candidates.push({ role: "your-account", secret: env.STRIPE_WEBHOOK_SECRET });
	}
	if (env.STRIPE_CONNECT_WEBHOOK_SECRET) {
		candidates.push({ role: "connected-accounts", secret: env.STRIPE_CONNECT_WEBHOOK_SECRET });
	}
	if (candidates.length === 0) {
		throw new Error(
			"Stripe commerce webhook secret is not set. Configure STRIPE_CONNECT_WEBHOOK_SECRET or STRIPE_WEBHOOK_SECRET.",
		);
	}
	return candidates;
}

function assertCommerceWebhookScope(event: Stripe.Event, role: CommerceWebhookRole) {
	const hasConnectedAccount = typeof event.account === "string" && event.account.length > 0;
	const matchesRole =
		(role === "connected-accounts" && hasConnectedAccount) ||
		(role === "your-account" && !hasConnectedAccount);
	if (matchesRole) return;

	logStructured({
		event: "webhook.commerce_scope_rejected",
		level: "error",
		stage: "webhook",
		meta: {
			eventType: event.type,
			role,
			hasConnectedAccount,
		},
	});
	throw error(400, "Webhook account scope does not match its destination");
}
