import { error, json } from "@sveltejs/kit";
import Stripe from "stripe";
import { env } from "$env/dynamic/private";
import { STRIPE_SECRET_KEY } from "$env/static/private";

const stripe = new Stripe(STRIPE_SECRET_KEY);

function getCrmPriceId(): string {
	const id = env.STRIPE_CRM_PRICE_ID;
	if (!id) throw error(500, "STRIPE_CRM_PRICE_ID env var is not set");
	return id;
}

export async function POST({ request }) {
	const { clientEmail, siteUrl } = await request.json();

	if (!clientEmail || !siteUrl) {
		throw error(400, "Missing clientEmail or siteUrl");
	}

	const session = await stripe.checkout.sessions.create({
		mode: "subscription",
		customer_email: clientEmail,
		line_items: [{ price: getCrmPriceId(), quantity: 1 }],
		metadata: { siteUrl, type: "platform_subscription" },
		success_url: `https://${siteUrl}/admin?upgraded=true`,
		cancel_url: `https://${siteUrl}/admin?upgrade=canceled`,
	});

	return json({ url: session.url });
}
