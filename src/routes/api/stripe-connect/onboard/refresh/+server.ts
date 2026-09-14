import { error, redirect } from "@sveltejs/kit";
import { api } from "$convex/api";
import { requireAuth } from "$lib/server/adminAuth";
import { createAuthenticatedConvexClient } from "$lib/server/convexClient";
import { getPublicSiteOrigin } from "$lib/server/runtimeConfig";
import { getStripe } from "$lib/server/stripeClient";
import {
	normalizeStripeConnectError,
	refreshStripeConnectOnboardingSession,
} from "$lib/server/stripeConnectOnboarding";

export async function GET({ url, cookies }) {
	const token = await requireAuth(cookies);

	const convex = createAuthenticatedConvexClient(token);

	try {
		const result = await refreshStripeConnectOnboardingSession({
			siteUrl: url.searchParams.get("siteUrl") ?? undefined,
			platformOrigin: getPublicSiteOrigin(),
			stripe: getStripe(),
			listClients: () => convex.query(api.platform.listAll, {}),
		});

		throw redirect(303, result.url);
	} catch (err) {
		const connectError = normalizeStripeConnectError(err);
		if (connectError) {
			throw error(connectError.status, connectError.message);
		}
		throw err;
	}
}
