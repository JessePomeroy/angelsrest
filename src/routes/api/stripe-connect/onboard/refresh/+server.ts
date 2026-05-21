import { error, redirect } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import { env as publicEnv } from "$env/dynamic/public";
import { requireAuth } from "$lib/server/adminAuth";
import { getStripe } from "$lib/server/stripeClient";
import {
	refreshStripeConnectOnboardingSession,
	StripeConnectOnboardingError,
} from "$lib/server/stripeConnectOnboarding";

export async function GET({ url, cookies }) {
	const token = await requireAuth(cookies);

	const convex = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "");
	convex.setAuth(token);

	try {
		const result = await refreshStripeConnectOnboardingSession({
			siteUrl: url.searchParams.get("siteUrl") ?? undefined,
			platformOrigin: getPlatformOrigin(),
			stripe: getStripe(),
			listClients: () => convex.query(api.platform.listAll, {}),
		});

		throw redirect(303, result.url);
	} catch (err) {
		if (err instanceof StripeConnectOnboardingError) {
			throw error(err.status, err.message);
		}
		throw err;
	}
}

function getPlatformOrigin() {
	const configured = publicEnv.PUBLIC_SITE_URL?.replace(/\/+$/, "");
	return configured || "https://angelsrest.online";
}
