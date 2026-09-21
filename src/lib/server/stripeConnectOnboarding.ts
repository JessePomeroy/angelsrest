import type { FunctionReturnType } from "convex/server";
import type Stripe from "stripe";
import type { api } from "$convex/api";
import type { StripeConnectReadiness } from "$lib/stripeConnectSetup";

type ConnectTarget = FunctionReturnType<typeof api.platform.getStripeConnectTarget>;
type ConnectAttempt = FunctionReturnType<typeof api.platform.beginStripeConnectAccount>;
const CREATION_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const STRIPE_REQUEST_OPTIONS = {
	timeout: 10_000,
	maxNetworkRetries: 0,
} satisfies Stripe.RequestOptions;
const ACCOUNT_ID = /^acct_[A-Za-z0-9]{16,64}$/;

export interface StripeConnectStore {
	findClient: (siteUrl: string) => Promise<ConnectTarget>;
	readStatus: (
		siteUrl: string,
	) => Promise<FunctionReturnType<typeof api.platform.getStripeConnectStatus>>;
	beginAttempt: (args: {
		clientId: ConnectTarget["clientId"];
		platformAccountId: string;
		livemode: boolean;
	}) => Promise<ConnectAttempt>;
	bindAccount: (args: {
		clientId: ConnectTarget["clientId"];
		attemptId: string;
		platformAccountId: string;
		livemode: boolean;
		stripeConnectedAccountId: string;
	}) => Promise<unknown>;
}

export class StripeConnectOnboardingError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "StripeConnectOnboardingError";
		this.status = status;
	}
}

export function normalizeStripeConnectError(err: unknown) {
	if (err instanceof StripeConnectOnboardingError) return err;
	if (err && typeof err === "object" && "data" in err && err.data === "STRIPE_CONNECT_FORBIDDEN") {
		return new StripeConnectOnboardingError(
			403,
			"This login cannot manage payments for that website.",
		);
	}

	const message = getErrorMessage(err);
	if (!message) return null;

	if (message.includes("signed up for Connect")) {
		return new StripeConnectOnboardingError(
			400,
			"Stripe Connect is not enabled for this Stripe account. Finish Connect setup in the Angels Rest Stripe dashboard, then try again.",
		);
	}

	const stripeError = err as { type?: unknown; statusCode?: unknown };
	if (typeof stripeError.type === "string" && stripeError.type.startsWith("Stripe")) {
		return new StripeConnectOnboardingError(
			502,
			"Stripe could not complete this request. Please try again or contact Angels Rest.",
		);
	}

	return null;
}

export interface StripeConnectOnboardingOptions {
	siteUrl: unknown;
	platformOrigin: string;
	stripe: Stripe;
	store: StripeConnectStore;
	now?: () => number;
}

export type StripeConnectRefreshOptions = Omit<StripeConnectOnboardingOptions, "now">;

/** Read-only provider verification; visiting or returning cannot create an account. */
export async function readStripeConnectStatus({
	siteUrl: rawSiteUrl,
	stripe,
	store,
}: Pick<StripeConnectOnboardingOptions, "siteUrl" | "stripe"> & {
	store: Pick<StripeConnectStore, "findClient">;
}) {
	const client = await store.findClient(requireSiteUrl(rawSiteUrl));
	if (!client.stripeConnectedAccountId) {
		return { siteUrl: client.siteUrl, accountId: null, readiness: null };
	}
	if (!client.attempt || !client.tenantId) {
		throw new StripeConnectOnboardingError(
			409,
			"This Stripe connection needs an Angels Rest review.",
		);
	}
	assertAttemptContext(client.attempt, await readPlatformContext(stripe));
	const account = await stripe.accounts.retrieve(
		client.stripeConnectedAccountId,
		STRIPE_REQUEST_OPTIONS,
	);
	assertAccountMatchesAttempt(account, {
		...client,
		attempt: client.attempt,
		tenantId: client.tenantId,
	});
	return {
		siteUrl: client.siteUrl,
		accountId: account.id,
		readiness: readStripeConnectReadiness(account),
	};
}

export async function createStripeConnectOnboardingSession({
	siteUrl: rawSiteUrl,
	platformOrigin,
	stripe,
	store,
	now = Date.now,
}: StripeConnectOnboardingOptions) {
	const siteUrl = requireSiteUrl(rawSiteUrl);
	const client = await store.findClient(siteUrl);
	await assertConnectionCanOnboard(store, siteUrl);
	const context = await readPlatformContext(stripe);
	const prepared = await store.beginAttempt({ clientId: client.clientId, ...context });
	assertAttemptContext(prepared.attempt, context);
	let account: Stripe.Account;
	if (prepared.stripeConnectedAccountId) {
		account = await stripe.accounts.retrieve(
			prepared.stripeConnectedAccountId,
			STRIPE_REQUEST_OPTIONS,
		);
	} else {
		// Stripe may prune idempotency records after 24h. Never issue another
		// create after uncertainty has outlived our shorter automatic retry window.
		const age = now() - prepared.attempt.startedAt;
		if (!Number.isFinite(age) || age < -5 * 60 * 1000 || age >= CREATION_RETRY_WINDOW_MS) {
			throw new StripeConnectOnboardingError(
				409,
				"Stripe account creation needs an operator review before retrying. No new account was created.",
			);
		}
		account = await stripe.accounts.create(
			{
				controller: {
					fees: { payer: "account" },
					losses: { payments: "stripe" },
					requirement_collection: "stripe",
					stripe_dashboard: { type: "full" },
				},
				email: prepared.attempt.email,
				metadata: {
					siteUrl: prepared.attempt.siteUrl,
					platformClientId: prepared.clientId,
					commerceTenantId: prepared.tenantId,
					stripeConnectAttemptId: prepared.attempt.id,
				},
			},
			{
				idempotencyKey: `stripe-connect:full-v1:${prepared.clientId}:${prepared.attempt.id}`,
				timeout: 10_000,
				maxNetworkRetries: 0,
			},
		);
	}
	assertAccountMatchesAttempt(account, prepared);
	await store.bindAccount({
		clientId: prepared.clientId,
		attemptId: prepared.attempt.id,
		...context,
		stripeConnectedAccountId: account.id,
	});
	return {
		accountId: account.id,
		readiness: readStripeConnectReadiness(account),
		url: await createAccountLinkUrl(stripe, store, {
			accountId: account.id,
			siteUrl,
			platformOrigin,
		}),
	};
}

export async function refreshStripeConnectOnboardingSession({
	siteUrl: rawSiteUrl,
	platformOrigin,
	stripe,
	store,
}: StripeConnectRefreshOptions) {
	const siteUrl = requireSiteUrl(rawSiteUrl);
	const client = await store.findClient(siteUrl);
	if (!client.stripeConnectedAccountId || !client.attempt || !client.tenantId) {
		throw new StripeConnectOnboardingError(404, `No Stripe Connect account found for ${siteUrl}`);
	}
	await assertConnectionCanOnboard(store, siteUrl);
	const context = await readPlatformContext(stripe);
	assertAttemptContext(client.attempt, context);
	const account = await stripe.accounts.retrieve(
		client.stripeConnectedAccountId,
		STRIPE_REQUEST_OPTIONS,
	);
	assertAccountMatchesAttempt(account, {
		...client,
		attempt: client.attempt,
		tenantId: client.tenantId,
	});
	return {
		accountId: client.stripeConnectedAccountId,
		readiness: readStripeConnectReadiness(account),
		url: await createAccountLinkUrl(stripe, store, {
			accountId: client.stripeConnectedAccountId,
			siteUrl,
			platformOrigin,
		}),
	};
}

export function normalizeStripeConnectSiteUrl(value: unknown) {
	if (typeof value !== "string" || !value.trim()) return null;
	try {
		const url = new URL(value.includes("://") ? value.trim() : `https://${value.trim()}`);
		if (
			!["http:", "https:"].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.port ||
			url.pathname !== "/" ||
			url.search ||
			url.hash
		)
			return null;
		return url.hostname.toLowerCase().replace(/^www\./, "");
	} catch {
		return null;
	}
}

function requireSiteUrl(value: unknown) {
	const siteUrl = normalizeStripeConnectSiteUrl(value);
	if (!siteUrl) {
		throw new StripeConnectOnboardingError(400, "A valid client siteUrl is required");
	}
	return siteUrl;
}

async function readPlatformContext(stripe: Stripe) {
	const [platform, balance] = await Promise.all([
		stripe.accounts.retrieve(STRIPE_REQUEST_OPTIONS),
		stripe.balance.retrieve(STRIPE_REQUEST_OPTIONS),
	]);
	if (!ACCOUNT_ID.test(platform.id) || typeof balance.livemode !== "boolean") {
		throw new StripeConnectOnboardingError(502, "Stripe platform identity is unavailable");
	}
	return { platformAccountId: platform.id, livemode: balance.livemode };
}

function assertAttemptContext(
	attempt: ConnectAttempt["attempt"],
	context: { platformAccountId: string; livemode: boolean },
) {
	if (
		attempt.model !== "full-v1" ||
		attempt.platformAccountId !== context.platformAccountId ||
		attempt.livemode !== context.livemode
	)
		throw new StripeConnectOnboardingError(409, "Stripe connection environment does not match");
}

function assertAccountMatchesAttempt(account: Stripe.Account, prepared: ConnectAttempt) {
	const controller = account.controller;
	if (
		!ACCOUNT_ID.test(account.id) ||
		account.id === prepared.attempt.platformAccountId ||
		(prepared.stripeConnectedAccountId && prepared.stripeConnectedAccountId !== account.id) ||
		controller?.fees?.payer !== "account" ||
		controller.losses?.payments !== "stripe" ||
		controller.requirement_collection !== "stripe" ||
		controller.stripe_dashboard?.type !== "full" ||
		account.metadata?.platformClientId !== prepared.clientId ||
		account.metadata.commerceTenantId !== prepared.tenantId ||
		account.metadata.stripeConnectAttemptId !== prepared.attempt.id
	) {
		throw new StripeConnectOnboardingError(
			409,
			"Stripe account ownership or responsibility settings do not match this client connection",
		);
	}
}

/** Provider facts only; an account ID or a return redirect is never readiness proof. */
export function readStripeConnectReadiness(
	account: Pick<
		Stripe.Account,
		"charges_enabled" | "payouts_enabled" | "details_submitted" | "requirements"
	>,
): StripeConnectReadiness {
	const status: "ready" | "setup_required" | "restricted" | "pending_verification" =
		account.charges_enabled && account.payouts_enabled
			? "ready"
			: account.requirements?.disabled_reason &&
					account.requirements.disabled_reason !== "requirements.pending_verification"
				? "restricted"
				: !account.details_submitted || (account.requirements?.currently_due?.length ?? 0) > 0
					? "setup_required"
					: "pending_verification";
	return {
		status,
		chargesEnabled: account.charges_enabled,
		payoutsEnabled: account.payouts_enabled,
		detailsSubmitted: account.details_submitted,
	};
}

function getErrorMessage(err: unknown) {
	return err instanceof Error && typeof err.message === "string" ? err.message : null;
}

async function assertConnectionCanOnboard(store: StripeConnectStore, siteUrl: string) {
	if ((await store.readStatus(siteUrl))?.state.kind === "disconnected") {
		throw new StripeConnectOnboardingError(
			409,
			"This Stripe connection was disconnected. Contact Angels Rest to reconnect it.",
		);
	}
}

async function createAccountLinkUrl(
	stripe: Stripe,
	store: StripeConnectStore,
	{
		accountId,
		siteUrl,
		platformOrigin,
	}: {
		accountId: string;
		siteUrl: string;
		platformOrigin: string;
	},
) {
	const origin = platformOrigin.replace(/\/+$/, "");
	const accountLink = await stripe.accountLinks.create(
		{
			account: accountId,
			type: "account_onboarding",
			refresh_url: `${origin}/api/stripe-connect/onboard/refresh?siteUrl=${encodeURIComponent(siteUrl)}`,
			return_url: `${origin}/api/stripe-connect/callback?siteUrl=${encodeURIComponent(siteUrl)}`,
		},
		STRIPE_REQUEST_OPTIONS,
	);
	// Membership/disconnection can change while the provider issues a temporary link.
	await assertConnectionCanOnboard(store, siteUrl);
	return accountLink.url;
}
