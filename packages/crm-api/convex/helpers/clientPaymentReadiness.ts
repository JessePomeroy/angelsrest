import type { QueryCtx } from "../_generated/server";
import { isStripeConnectedAccountId } from "./checkoutSnapshot";
import { requireCurrentStripeConnectBinding } from "./stripeConnectStatus";
import { isTenantId, resolveTenantContext } from "./tenantContext";

export const CLIENT_PAYMENT_READINESS_MAX_AGE_MS = 60_000;

export type ClientPaymentIdentity = {
	siteUrl: string;
	tenantId: string;
	accountId: string;
};

/** New client payments use current, verified ownership; historical refunds use their saved identity. */
export async function requireClientPaymentBinding(ctx: QueryCtx, identity: ClientPaymentIdentity) {
	if (!isTenantId(identity.tenantId) || !isStripeConnectedAccountId(identity.accountId)) {
		throw new Error("Client payment identity is invalid");
	}
	const tenant = await resolveTenantContext(ctx, { siteUrl: identity.siteUrl });
	const client = tenant?.client;
	const attempt = client?.stripeConnectAttempt;
	if (!client || tenant?.tenantId !== identity.tenantId || client.role === "creator"
		|| !attempt || client.stripeConnectedAccountId !== identity.accountId) {
		throw new Error("Client payments require the current verified Stripe connection");
	}
	await requireCurrentStripeConnectBinding(ctx, {
		clientId: client._id, accountId: identity.accountId,
		platformAccountId: attempt.platformAccountId, livemode: attempt.livemode,
	});
	return { client, attempt };
}

/** Evaluate inside the first-creation transaction, after the hub refreshes Stripe facts. */
export async function requireClientPaymentReady(ctx: QueryCtx, identity: ClientPaymentIdentity) {
	const bound = await requireClientPaymentBinding(ctx, identity);
	const state = bound.client.stripeConnectStatus?.state;
	const now = Date.now();
	if (state?.kind !== "observed" || state.readiness.status !== "ready"
		|| !state.readiness.chargesEnabled || !state.readiness.payoutsEnabled
		|| !Number.isSafeInteger(state.checkedAt) || state.checkedAt > now
		|| now - state.checkedAt >= CLIENT_PAYMENT_READINESS_MAX_AGE_MS) {
		throw new Error("Client payment readiness is unavailable or stale");
	}
	return bound;
}
