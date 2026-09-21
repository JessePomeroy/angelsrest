import type { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import type { StripeConnectStatusStore } from "$lib/server/stripeConnectStatusSync";
import { getWebhookSecret } from "$lib/server/webhookSecret";

/** Session authority selects the client; the hub secret attests provider-derived writes. */
export function createStripeConnectStore(convex: ConvexHttpClient): StripeConnectStatusStore {
	const webhookSecret = getWebhookSecret();
	return {
		findClient: (siteUrl) => convex.query(api.platform.getStripeConnectTarget, { siteUrl }),
		readStatus: (siteUrl) => convex.query(api.platform.getStripeConnectStatus, { siteUrl }),
		beginStatusRefresh: (args) =>
			convex.mutation(api.platform.beginStripeConnectStatusRefresh, { ...args, webhookSecret }),
		finishStatusRefresh: (args) =>
			convex.mutation(api.platform.finishStripeConnectStatusRefresh, { ...args, webhookSecret }),
		markDisconnected: (args) =>
			convex.mutation(api.platform.markStripeConnectDisconnected, { ...args, webhookSecret }),
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
