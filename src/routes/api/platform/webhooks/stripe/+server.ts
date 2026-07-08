import { json } from "@sveltejs/kit";
import type Stripe from "stripe";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import { STRIPE_PLATFORM_WEBHOOK_SECRET } from "$env/static/private";
import { getConvex } from "$lib/server/convexClient";
import { logStructured } from "$lib/server/logger";
import { getStripe } from "$lib/server/stripeClient";
import { verifyStripeWebhook } from "$lib/server/stripeWebhook";

const convex = getConvex();

function getWebhookSecret(): string {
	const secret = env.WEBHOOK_SECRET;
	if (!secret) {
		throw new Error(
			"WEBHOOK_SECRET is not set — cannot call webhook-gated Convex platform mutations.",
		);
	}
	return secret;
}

function stripeExpandableId(
	value: string | { id?: string } | null | undefined,
): string | undefined {
	if (typeof value === "string") return value;
	if (value && typeof value.id === "string") return value.id;
	return undefined;
}

export async function POST({ request }) {
	const stripe = getStripe();
	const event = await verifyStripeWebhook(
		request,
		stripe,
		STRIPE_PLATFORM_WEBHOOK_SECRET,
		"Platform webhook",
	);

	logStructured({
		event: "platform_webhook.received",
		stage: "webhook",
		meta: { eventType: event.type },
	});

	const webhookSecret = getWebhookSecret();

	switch (event.type) {
		case "checkout.session.completed": {
			const session = event.data.object as Stripe.Checkout.Session;
			if (session.metadata?.type !== "platform_subscription") break;

			await convex.mutation(api.platform.updateSubscription, {
				webhookSecret,
				siteUrl: session.metadata.siteUrl,
				tier: "full",
				subscriptionStatus: "active",
				stripeCustomerId: session.customer as string,
				stripeSubscriptionId: session.subscription as string,
			});
			logStructured({
				event: "platform_subscription.activated",
				stage: "webhook",
				sessionId: session.id,
				meta: {
					siteUrl: session.metadata.siteUrl,
					stripeCustomerId: stripeExpandableId(session.customer),
					stripeSubscriptionId: stripeExpandableId(session.subscription),
				},
			});
			break;
		}

		case "customer.subscription.deleted": {
			const subscription = event.data.object as Stripe.Subscription;
			const client = await convex.query(api.platform.getBySubscriptionId, {
				webhookSecret,
				subscriptionId: subscription.id,
			});

			if (client) {
				await convex.mutation(api.platform.updateSubscription, {
					webhookSecret,
					siteUrl: client.siteUrl,
					tier: "basic",
					subscriptionStatus: "canceled",
				});
				logStructured({
					event: "platform_subscription.canceled",
					stage: "webhook",
					meta: {
						siteUrl: client.siteUrl,
						stripeSubscriptionId: subscription.id,
					},
				});
			}
			break;
		}

		case "customer.subscription.updated": {
			const subscription = event.data.object as Stripe.Subscription;
			const client = await convex.query(api.platform.getBySubscriptionId, {
				webhookSecret,
				subscriptionId: subscription.id,
			});

			if (client) {
				const isActive = subscription.status === "active";
				await convex.mutation(api.platform.updateSubscription, {
					webhookSecret,
					siteUrl: client.siteUrl,
					tier: isActive ? "full" : "basic",
					subscriptionStatus: subscription.status as "active" | "canceled" | "past_due" | "none",
				});
				logStructured({
					event: "platform_subscription.updated",
					stage: "webhook",
					meta: {
						siteUrl: client.siteUrl,
						stripeSubscriptionId: subscription.id,
						subscriptionStatus: subscription.status,
					},
				});
			}
			break;
		}

		case "invoice.payment_failed": {
			const invoice = event.data.object as Stripe.Invoice;
			logStructured({
				event: "platform_subscription.payment_failed",
				level: "warn",
				stage: "webhook",
				meta: { stripeCustomerId: stripeExpandableId(invoice.customer) },
			});
			break;
		}
	}

	return json({ received: true });
}
