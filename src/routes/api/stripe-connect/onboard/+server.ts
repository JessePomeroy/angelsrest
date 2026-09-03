import { json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { requireAuth } from "$lib/server/adminAuth";
import { createAuthenticatedConvexClient } from "$lib/server/convexClient";
import { getPublicSiteOrigin } from "$lib/server/runtimeConfig";
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
	const convex = createAuthenticatedConvexClient(token);

	const body = (await request.json()) as OnboardRequest;

	const stripe = getStripe();
	try {
		const result = await createStripeConnectOnboardingSession({
			siteUrl: body.siteUrl,
			platformOrigin: getPublicSiteOrigin(),
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
