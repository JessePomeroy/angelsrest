import { error } from "@sveltejs/kit";
import type { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type Stripe from "stripe";
import { api } from "$convex/api";
import {
	readStripeConnectStatus,
	StripeConnectOnboardingError,
	type StripeConnectStore,
} from "$lib/server/stripeConnectOnboarding";
import { createStripeConnectStore } from "$lib/server/stripeConnectStore";
import type { CommerceWebhookRole } from "$lib/server/stripeWebhook";
import { getWebhookSecret } from "$lib/server/webhookSecret";
import type { StripeConnectSetupData } from "$lib/stripeConnectSetup";

type Target = FunctionReturnType<typeof api.platform.getStripeConnectTarget>;
type RefreshArgs = Omit<
	FunctionArgs<typeof api.platform.beginStripeConnectStatusRefresh>,
	"webhookSecret"
>;
type FinishArgs = Omit<
	FunctionArgs<typeof api.platform.finishStripeConnectStatusRefresh>,
	"webhookSecret"
>;

export interface StripeConnectStatusStore
	extends Pick<StripeConnectStore, "findClient" | "readStatus"> {
	beginStatusRefresh: (
		args: RefreshArgs,
	) => Promise<FunctionReturnType<typeof api.platform.beginStripeConnectStatusRefresh>>;
	finishStatusRefresh: (
		args: FinishArgs,
	) => Promise<FunctionReturnType<typeof api.platform.finishStripeConnectStatusRefresh>>;
	markDisconnected: (args: RefreshArgs & { eventId: string }) => Promise<unknown>;
}

/** Callers resolve this target through tenant auth or signed-webhook ownership, never request metadata. */
async function synchronizeAccount(target: Target, stripe: Stripe, store: StripeConnectStatusStore) {
	if (!target.stripeConnectedAccountId || !target.attempt || !target.tenantId) {
		throw new StripeConnectOnboardingError(
			409,
			"This Stripe connection needs an Angels Rest review.",
		);
	}
	const scope: RefreshArgs = {
		clientId: target.clientId,
		accountId: target.stripeConnectedAccountId,
		platformAccountId: target.attempt.platformAccountId,
		livemode: target.attempt.livemode,
	};
	const claim = await store.beginStatusRefresh(scope);
	if (claim.kind === "disconnected") return { retryable: false };
	let result: FinishArgs["result"];
	let retryable = false;
	try {
		// The claim precedes every provider read, including platform/mode verification.
		const observed = await readStripeConnectStatus({
			siteUrl: target.siteUrl,
			stripe,
			store: { findClient: async () => target },
		});
		if (!observed.readiness) throw new StripeConnectOnboardingError(409, "Missing Stripe account");
		result = { kind: "observed", readiness: observed.readiness };
	} catch (cause) {
		const mismatch = cause instanceof StripeConnectOnboardingError && cause.status === 409;
		result = {
			kind: "unavailable",
			reason: mismatch ? "account_mismatch" : "provider_unavailable",
		};
		retryable = !mismatch;
	}
	// A storage failure must reach the caller; never acknowledge an unrecorded result.
	const completed = await store.finishStatusRefresh({
		...scope,
		refreshToken: claim.refreshToken,
		result,
	});
	return { retryable: completed.applied && retryable };
}

export async function refreshClientStripeConnectStatus({
	siteUrl,
	stripe,
	store,
}: {
	siteUrl: string;
	stripe: Stripe;
	store: StripeConnectStatusStore;
}) {
	const target = await store.findClient(siteUrl);
	if (target.stripeConnectedAccountId) await synchronizeAccount(target, stripe, store);
	// Reauthorize and read committed state. A discarded provider result is never UI authority.
	const status = await store.readStatus(target.siteUrl);
	if (status && status.accountId !== target.stripeConnectedAccountId) {
		throw new StripeConnectOnboardingError(409, "Stripe connection changed during verification");
	}
	const connectionIssue: StripeConnectSetupData["connectionIssue"] =
		status?.state.kind === "observed"
			? null
			: (status?.state.kind ?? (target.stripeConnectedAccountId ? "unavailable" : null));
	return {
		siteUrl: target.siteUrl,
		accountId: target.stripeConnectedAccountId,
		readiness: status?.state.kind === "observed" ? status.state.readiness : null,
		connectionIssue,
	};
}

/** Runs only after the route has verified signature, API version, and destination scope. */
export async function processStripeConnectLifecycleEvent(
	event: Stripe.Event,
	role: CommerceWebhookRole,
	{ stripe, convex }: { stripe: Stripe; convex: ConvexHttpClient },
) {
	if (
		event.type !== "account.updated" &&
		event.type !== "capability.updated" &&
		event.type !== "account.application.deauthorized"
	)
		return false;
	if (role !== "connected-accounts") return true;
	if (!event.account || !/^acct_[A-Za-z0-9]{16,64}$/.test(event.account))
		throw error(400, "Invalid connected account identity");
	if (event.type === "account.updated" && event.data.object.id !== event.account)
		throw error(400, "Account event identity does not match");
	if (event.type === "capability.updated") {
		const account = event.data.object.account;
		if ((typeof account === "string" ? account : account?.id) !== event.account)
			throw error(400, "Capability event identity does not match");
	}
	const client = await convex.query(api.platform.getByStripeConnectedAccountId, {
		stripeConnectedAccountId: event.account,
		webhookSecret: getWebhookSecret(),
	});
	// Lifecycle state belongs to the current verified protocol, not an old/unknown selection.
	if (
		!client ||
		client.stripeConnectedAccountId !== event.account ||
		!client.stripeConnectAttempt ||
		!client.tenantId
	)
		return true;
	if (event.livemode !== client.stripeConnectAttempt.livemode) return true;
	const store = createStripeConnectStore(convex);
	if (event.type === "account.application.deauthorized") {
		// The event object is an application; the signed top-level account owns this connection.
		// Its API access may already be gone, so this path never retrieves it from Stripe.
		await store.markDisconnected({
			clientId: client._id,
			accountId: event.account,
			platformAccountId: client.stripeConnectAttempt.platformAccountId,
			livemode: client.stripeConnectAttempt.livemode,
			eventId: event.id,
		});
		return true;
	}
	const result = await synchronizeAccount(
		{
			clientId: client._id,
			siteUrl: client.siteUrl,
			tenantId: client.tenantId,
			stripeConnectedAccountId: client.stripeConnectedAccountId,
			attempt: client.stripeConnectAttempt,
		},
		stripe,
		store,
	);
	if (result.retryable) throw error(502, "Stripe account verification is temporarily unavailable");
	return true;
}
