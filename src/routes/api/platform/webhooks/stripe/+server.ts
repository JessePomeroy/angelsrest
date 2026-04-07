import { error, json } from "@sveltejs/kit";
import Stripe from "stripe";
import { api } from "$convex/api";
import {
	STRIPE_PLATFORM_WEBHOOK_SECRET,
	STRIPE_SECRET_KEY,
} from "$env/static/private";
import { getConvex } from "$lib/server/convexClient";

const stripe = new Stripe(STRIPE_SECRET_KEY);
const convex = getConvex();

export async function POST({ request }) {
	const body = await request.text();
	const signature = request.headers.get("stripe-signature");

	if (!signature) {
		throw error(400, "Missing stripe-signature header");
	}

	let event: Stripe.Event;
	try {
		event = stripe.webhooks.constructEvent(
			body,
			signature,
			STRIPE_PLATFORM_WEBHOOK_SECRET,
		);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : "Unknown error";
		console.error("Platform webhook signature verification failed:", message);
		throw error(400, `Webhook Error: ${message}`);
	}

	console.log(`Platform webhook received: ${event.type}`);

	switch (event.type) {
		case "checkout.session.completed": {
			const session = event.data.object as Stripe.Checkout.Session;
			if (session.metadata?.type !== "platform_subscription") break;

			await convex.mutation(api.platform.updateSubscription, {
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
				subscriptionId: subscription.id,
			});

			if (client) {
				await convex.mutation(api.platform.updateSubscription, {
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
				subscriptionId: subscription.id,
			});

			if (client) {
				const isActive = subscription.status === "active";
				await convex.mutation(api.platform.updateSubscription, {
					siteUrl: client.siteUrl,
					tier: isActive ? "full" : "basic",
					subscriptionStatus: subscription.status as
						| "active"
						| "canceled"
						| "past_due"
						| "none",
				});
				console.log(
					"Subscription updated for:",
					client.siteUrl,
					"→",
					subscription.status,
				);
			}
			break;
		}

		case "invoice.payment_failed": {
			const invoice = event.data.object as Stripe.Invoice;
			console.log(
				"Subscription payment failed for customer:",
				invoice.customer,
			);
			break;
		}
	}

	return json({ received: true });
}
