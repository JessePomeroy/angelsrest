import type { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import type { StripeConnectStore } from "$lib/server/stripeConnectOnboarding";
import { getWebhookSecret } from "$lib/server/webhookSecret";

/** Session authority selects the client; the hub secret attests provider-derived writes. */
export function createStripeConnectStore(convex: ConvexHttpClient): StripeConnectStore {
	const webhookSecret = getWebhookSecret();
	return {
		findClient: (siteUrl) => convex.query(api.platform.getStripeConnectTarget, { siteUrl }),
		beginAttempt: (args) =>
			convex.mutation(api.platform.beginStripeConnectAccount, {
				...args,
				webhookSecret,
			}),
		bindAccount: (args) =>
			convex.mutation(api.platform.bindStripeConnectAccount, {
				...args,
				webhookSecret,
			}),
	};
}
