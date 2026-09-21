import { getPublicSiteOrigin } from "$lib/server/runtimeConfig";
import { isStripeConnectOnboardingEnabled } from "$lib/server/stripeConnectGate";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => ({
	stripeConnectOnboardingEnabled: isStripeConnectOnboardingEnabled(),
	stripeConnectOrigin: getPublicSiteOrigin(),
});
