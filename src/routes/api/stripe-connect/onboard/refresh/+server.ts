import { error, isHttpError, redirect } from "@sveltejs/kit";
import { requireAuth } from "$lib/server/adminAuth";
import { createAuthenticatedConvexClient } from "$lib/server/convexClient";
import { getPublicSiteOrigin } from "$lib/server/runtimeConfig";
import { getStripe } from "$lib/server/stripeClient";
import { assertStripeConnectOnboardingEnabled } from "$lib/server/stripeConnectGate";
import {
	normalizeStripeConnectError,
	normalizeStripeConnectSiteUrl,
	refreshStripeConnectOnboardingSession,
} from "$lib/server/stripeConnectOnboarding";
import { createStripeConnectStore } from "$lib/server/stripeConnectStore";
import { stripeConnectSetupPath } from "$lib/stripeConnectSetup";
import type { RequestEvent } from "./$types";

export async function GET({ url, cookies }: Pick<RequestEvent, "url" | "cookies">) {
	const siteUrl = normalizeStripeConnectSiteUrl(url.searchParams.get("siteUrl"));
	if (!siteUrl) throw error(400, "A valid client website is required");
	let token: string;
	try {
		token = await requireAuth(cookies);
	} catch (cause) {
		if (isHttpError(cause, 401)) throw redirect(303, stripeConnectSetupPath(siteUrl));
		throw cause;
	}

	const convex = createAuthenticatedConvexClient(token);

	try {
		assertStripeConnectOnboardingEnabled();
		const result = await refreshStripeConnectOnboardingSession({
			siteUrl,
			platformOrigin: getPublicSiteOrigin(),
			stripe: getStripe(),
			store: createStripeConnectStore(convex),
		});

		return new Response(null, {
			status: 303,
			headers: {
				location: result.url,
				"cache-control": "private, no-store",
				"referrer-policy": "no-referrer",
			},
		});
	} catch (err) {
		const connectError = normalizeStripeConnectError(err);
		if (connectError) {
			throw error(connectError.status, connectError.message);
		}
		throw err;
	}
}
