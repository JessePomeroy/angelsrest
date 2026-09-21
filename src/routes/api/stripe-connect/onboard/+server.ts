import { json } from "@sveltejs/kit";
import { requireAuth } from "$lib/server/adminAuth";
import { createAuthenticatedConvexClient } from "$lib/server/convexClient";
import { getPublicSiteOrigin } from "$lib/server/runtimeConfig";
import { getStripe } from "$lib/server/stripeClient";
import {
	assertStripeConnectOnboardingEnabled,
	assertStripeConnectRequestOrigin,
} from "$lib/server/stripeConnectGate";
import {
	createStripeConnectOnboardingSession,
	normalizeStripeConnectError,
	StripeConnectOnboardingError,
} from "$lib/server/stripeConnectOnboarding";
import { createStripeConnectStore } from "$lib/server/stripeConnectStore";

export async function POST({ request, cookies }) {
	const token = await requireAuth(cookies);
	const convex = createAuthenticatedConvexClient(token);

	try {
		assertStripeConnectRequestOrigin(request);
		assertStripeConnectOnboardingEnabled();
		const body: unknown = await request.json().catch(() => {
			throw new StripeConnectOnboardingError(400, "Invalid onboarding request");
		});
		if (!body || typeof body !== "object" || Array.isArray(body) || !("siteUrl" in body)) {
			throw new StripeConnectOnboardingError(400, "Invalid onboarding request");
		}
		const result = await createStripeConnectOnboardingSession({
			siteUrl: body.siteUrl,
			platformOrigin: getPublicSiteOrigin(),
			stripe: getStripe(),
			store: createStripeConnectStore(convex),
		});

		return json(result, { headers: { "cache-control": "private, no-store" } });
	} catch (err) {
		const connectError = normalizeStripeConnectError(err);
		if (connectError) {
			return json({ message: connectError.message }, { status: connectError.status });
		}
		throw err;
	}
}
