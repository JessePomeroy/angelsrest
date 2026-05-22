import { json } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import { env as publicEnv } from "$env/dynamic/public";
import { requireAuth } from "$lib/server/adminAuth";
import { getStripe } from "$lib/server/stripeClient";
import {
	createStripeConnectOnboardingSession,
	normalizeStripeConnectError,
} from "$lib/server/stripeConnectOnboarding";

interface OnboardRequest {
	siteUrl?: string;
}

export async function POST({ request, cookies }) {
	const token = await requireAuth(cookies);
	const convex = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "");
	convex.setAuth(token);

	const body = (await request.json()) as OnboardRequest;

	const stripe = getStripe();
	try {
		const result = await createStripeConnectOnboardingSession({
			siteUrl: body.siteUrl,
			platformOrigin: getPlatformOrigin(),
			stripe,
			listClients: () => convex.query(api.platform.listAll, {}),
			saveAccountId: (args) => convex.mutation(api.platform.updateStripeConnectedAccount, args),
		});

		return json(result);
	} catch (err) {
		const connectError = normalizeStripeConnectError(err);
		if (connectError) {
			return json({ message: connectError.message }, { status: connectError.status });
		}
		throw err;
	}
}

function getPlatformOrigin() {
	const configured = publicEnv.PUBLIC_SITE_URL?.replace(/\/+$/, "");
	return configured || "https://angelsrest.online";
}
