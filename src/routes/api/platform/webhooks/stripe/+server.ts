import { json } from "@sveltejs/kit";
import Stripe from "stripe";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import { STRIPE_PLATFORM_WEBHOOK_SECRET, STRIPE_SECRET_KEY } from "$env/static/private";
import { getConvex } from "$lib/server/convexClient";
import { verifyStripeWebhook } from "$lib/server/stripeWebhook";

const stripe = new Stripe(STRIPE_SECRET_KEY);
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

export async function POST({ request }) {
	const event = await verifyStripeWebhook(
		request,
		stripe,
		STRIPE_PLATFORM_WEBHOOK_SECRET,
		"Platform webhook",
	);

	console.log(`Platform webhook received: ${event.type}`);

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
			console.log("Subscription activated for:", session.metadata.siteUrl);
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
				console.log("Subscription canceled for:", client.siteUrl);
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
				console.log("Subscription updated for:", client.siteUrl, "→", subscription.status);
			}
			break;
		}

		case "invoice.payment_failed": {
			const invoice = event.data.object as Stripe.Invoice;
			console.log("Subscription payment failed for customer:", invoice.customer);
			break;
		}
	}

	return json({ received: true });
}
