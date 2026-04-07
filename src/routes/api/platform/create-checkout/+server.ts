import { error, json } from "@sveltejs/kit";
import Stripe from "stripe";
import { STRIPE_SECRET_KEY } from "$env/static/private";

const stripe = new Stripe(STRIPE_SECRET_KEY);
const CRM_PRICE_ID = "price_1TJYv9EdZA9bU4XSjZ2Kh8AB";

export async function POST({ request }) {
	const { clientEmail, siteUrl } = await request.json();

	if (!clientEmail || !siteUrl) {
		throw error(400, "Missing clientEmail or siteUrl");
	}

	const session = await stripe.checkout.sessions.create({
		mode: "subscription",
		customer_email: clientEmail,
		line_items: [{ price: CRM_PRICE_ID, quantity: 1 }],
		metadata: { siteUrl, type: "platform_subscription" },
		success_url: `https://${siteUrl}/admin?upgraded=true`,
		cancel_url: `https://${siteUrl}/admin?upgrade=canceled`,
	});

	return json({ url: session.url });
}
