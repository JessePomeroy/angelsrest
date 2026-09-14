import type { Config } from "@sveltejs/adapter-vercel";
import { error, json } from "@sveltejs/kit";
import type Stripe from "stripe";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import {
	readCheckoutTenantIdMarker,
	readCheckoutTenantMarker,
} from "$lib/server/checkoutSnapshotConsumer";
import { getConvex } from "$lib/server/convexClient";
import { logStructured } from "$lib/server/logger";
import { createOrder as createLumaPrintsOrder } from "$lib/server/lumaprints";
import { processStripeWebhookEvent } from "$lib/server/orderIntake";
import { assertOrderProducersOpen, OrderProducersClosedError } from "$lib/server/orderProducerGate";
import { getResend } from "$lib/server/resendClient";
import { getStripe } from "$lib/server/stripeClient";
import { COMMERCE_TENANT_ID_METADATA_KEY } from "$lib/server/stripeConnect";
import {
	type CommerceWebhookRole,
	type StripeWebhookSecretCandidate,
	verifyStripeWebhookWithRole,
} from "$lib/server/stripeWebhook";
import { getWebhookSecret } from "$lib/server/webhookSecret";

const convex = getConvex();

export const config = { maxDuration: 60 } satisfies Config;

export async function POST({ request }) {
	const stripe = getStripe();
	const { event, role } = await verifyStripeWebhookWithRole(
		request,
		stripe,
		getCommerceWebhookSecrets(),
		"Commerce webhook",
	);
	assertCommerceWebhookScope(event, role);
	if (await isAcknowledgedOrderReplay(event)) return json({ received: true });
	const resend = getResend();
	await processStripeWebhookEvent(event, { stripe, resend, convex, createLumaPrintsOrder }, role);
	return json({ received: true });
}

async function isAcknowledgedOrderReplay(event: Stripe.Event) {
	if (event.type !== "checkout.session.completed") return false;
	const session = event.data.object as Stripe.Checkout.Session;
	if (
		session.mode !== "payment" ||
		session.metadata?.type === "platform_subscription" ||
		session.metadata?.type === "invoice_payment"
	) {
		return false;
	}
	try {
		assertOrderProducersOpen();
		return false;
	} catch (cause) {
		if (!(cause instanceof OrderProducersClosedError)) throw cause;
	}

	const stripeConnectedAccountId =
		typeof event.account === "string" ? event.account.trim() : undefined;
	const stripeTenantMetadataSiteUrl = readCheckoutTenantMarker(session.metadata);
	const stripeTenantMetadataTenantId = readCheckoutTenantIdMarker(session.metadata);
	if (
		session.metadata?.[COMMERCE_TENANT_ID_METADATA_KEY] !== undefined &&
		stripeTenantMetadataTenantId === undefined
	)
		throw error(400, "Checkout tenant identity is invalid");
	const routing = await convex.query(api.orders.resolveCheckoutRouting, {
		stripeSessionId: session.id,
		...(stripeConnectedAccountId ? { stripeConnectedAccountId } : {}),
		...(stripeTenantMetadataSiteUrl ? { stripeTenantMetadataSiteUrl } : {}),
		...(stripeTenantMetadataTenantId ? { stripeTenantMetadataTenantId } : {}),
		webhookSecret: getWebhookSecret(),
	});
	if (routing?.source === "retired" || routing?.source === "order") return true;
	throw error(503, "Order intake is closed");
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
