import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function PATCH({ request }) {
	const data = await request.json();

	if (!data.siteUrl) {
		throw error(400, "Site URL is required");
	}

	try {
		await convex.mutation(api.platform.updateSubscription, {
			siteUrl: data.siteUrl,
			tier: data.tier,
			subscriptionStatus: data.subscriptionStatus,
			stripeCustomerId: data.stripeCustomerId || undefined,
			stripeSubscriptionId: data.stripeSubscriptionId || undefined,
		});
		return json({ success: true });
	} catch (err) {
		console.error("Failed to update platform client:", err);
		throw error(500, "Failed to update platform client");
	}
}
