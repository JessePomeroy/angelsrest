import type { ConvexHttpClient } from "convex/browser";
import type Stripe from "stripe";
import { api } from "$convex/api";
import { getConvex } from "$lib/server/convexClient";
import { createLumaPrintsClient } from "$lib/server/lumaprints";
import {
	type LumaPrintsConnection,
	resolveLumaPrintsWebhookConfiguration,
} from "$lib/server/lumaprintsConnections";
import { ClientPaymentUnavailableError } from "$lib/server/stripeConnect";
import { refreshClientStripeConnectStatus } from "$lib/server/stripeConnectStatusSync";
import { getWebhookSecret } from "$lib/server/webhookSecret";
import { CLIENT_PAYMENT_READINESS_MAX_AGE_MS } from "../../../packages/crm-api/convex/helpers/clientPaymentReadiness";

/** Call only after request authorization/abuse checks and before a first new payment. */
export async function verifyClientPaymentReadiness({
	siteUrl,
	tenantId,
	accountId,
	stripe,
	convex,
	webhookSecret,
}: {
	siteUrl: string;
	tenantId: string;
	accountId: string;
	stripe: Stripe;
	convex?: ConvexHttpClient;
	webhookSecret?: string;
}) {
	try {
		const client = convex ?? getConvex();
		const secret = webhookSecret ?? getWebhookSecret();
		const startedAt = Date.now();
		const read = async () => {
			const projection = await client.query(api.platform.getClientPaymentTarget, {
				siteUrl,
				tenantId,
				accountId,
				webhookSecret: secret,
			});
			if (
				projection.target.siteUrl !== siteUrl ||
				projection.target.tenantId !== tenantId ||
				projection.target.stripeConnectedAccountId !== accountId ||
				(projection.status && projection.status.accountId !== accountId)
			) {
				throw new ClientPaymentUnavailableError();
			}
			return projection;
		};
		await refreshClientStripeConnectStatus({
			siteUrl,
			stripe,
			store: {
				findClient: async () => (await read()).target,
				readStatus: async () => (await read()).status,
				beginStatusRefresh: (args) =>
					client.mutation(api.platform.beginStripeConnectStatusRefresh, {
						...args,
						webhookSecret: secret,
					}),
				finishStatusRefresh: (args) =>
					client.mutation(api.platform.finishStripeConnectStatusRefresh, {
						...args,
						webhookSecret: secret,
					}),
				markDisconnected: (args) =>
					client.mutation(api.platform.markStripeConnectDisconnected, {
						...args,
						webhookSecret: secret,
					}),
			},
		});
		// Re-read committed current ownership; discarded provider observations never authorize payment.
		const { target, status } = await read();
		if (
			status?.state.kind !== "observed" ||
			status.state.readiness.status !== "ready" ||
			!status.state.readiness.chargesEnabled ||
			!status.state.readiness.payoutsEnabled ||
			// Use elapsed time for this fresh refresh, not two servers' wall-clock agreement.
			Date.now() - startedAt >= CLIENT_PAYMENT_READINESS_MAX_AGE_MS ||
			Date.now() < startedAt
		) {
			throw new ClientPaymentUnavailableError();
		}
		return { livemode: target.attempt.livemode };
	} catch {
		throw new ClientPaymentUnavailableError();
	}
}

/** Supplier checks apply only to captured production-partner print sources. */
export async function verifyClientCheckoutReadiness(input: {
	siteUrl: string;
	tenantId: string;
	accountId: string;
	stripe: Stripe;
	supplier: LumaPrintsConnection | null;
}) {
	const { livemode } = await verifyClientPaymentReadiness(input);
	if (!input.supplier) return;
	try {
		if (
			input.supplier.tenantId !== input.tenantId ||
			input.supplier.environment !== (livemode ? "production" : "sandbox")
		) {
			throw new ClientPaymentUnavailableError();
		}
		resolveLumaPrintsWebhookConfiguration(input.supplier.connectionRef);
		await createLumaPrintsClient(input.supplier).verifyStoreAccess();
	} catch {
		throw new ClientPaymentUnavailableError();
	}
}
