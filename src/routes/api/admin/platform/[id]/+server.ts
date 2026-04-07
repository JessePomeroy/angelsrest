import { error, json } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { env as publicEnv } from "$env/dynamic/public";
import { api } from "../../../../../../convex/_generated/api";

const convex = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "");

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
