import type Stripe from "stripe";

interface PlatformClient {
	_id: string;
	siteUrl: string;
	email: string;
	name: string;
	stripeConnectedAccountId?: string;
}

type ListClients = () => Promise<PlatformClient[]>;
type SaveStripeAccount = (args: {
	siteUrl: string;
	stripeConnectedAccountId: string;
}) => Promise<unknown>;

export class StripeConnectOnboardingError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "StripeConnectOnboardingError";
		this.status = status;
	}
}

export interface StripeConnectOnboardingOptions {
	siteUrl: string | undefined;
	platformOrigin: string;
	stripe: Stripe;
	listClients: ListClients;
	saveAccountId: SaveStripeAccount;
}

export interface StripeConnectRefreshOptions {
	siteUrl: string | undefined;
	platformOrigin: string;
	stripe: Stripe;
	listClients: ListClients;
}

export async function createStripeConnectOnboardingSession({
	siteUrl: rawSiteUrl,
	platformOrigin,
	stripe,
	listClients,
	saveAccountId,
}: StripeConnectOnboardingOptions) {
	const siteUrl = requireSiteUrl(rawSiteUrl);
	const client = await findClient(listClients, siteUrl);

	const accountId =
		client.stripeConnectedAccountId ||
		(
			await stripe.accounts.create({
				type: "express",
				country: "US",
				email: client.email,
				capabilities: {
					card_payments: { requested: true },
					transfers: { requested: true },
				},
				metadata: {
					siteUrl: client.siteUrl,
					platformClientId: client._id,
				},
			})
		).id;

	if (!client.stripeConnectedAccountId) {
		await saveAccountId({
			siteUrl,
			stripeConnectedAccountId: accountId,
		});
	}

	return {
		accountId,
		url: await createAccountLinkUrl(stripe, {
			accountId,
			siteUrl,
			platformOrigin,
		}),
	};
}

export async function refreshStripeConnectOnboardingSession({
	siteUrl: rawSiteUrl,
	platformOrigin,
	stripe,
	listClients,
}: StripeConnectRefreshOptions) {
	const siteUrl = requireSiteUrl(rawSiteUrl);
	const client = await findClient(listClients, siteUrl);
	if (!client.stripeConnectedAccountId) {
		throw new StripeConnectOnboardingError(404, `No Stripe Connect account found for ${siteUrl}`);
	}

	return {
		accountId: client.stripeConnectedAccountId,
		url: await createAccountLinkUrl(stripe, {
			accountId: client.stripeConnectedAccountId,
			siteUrl,
			platformOrigin,
		}),
	};
}

export function normalizeStripeConnectSiteUrl(value: string | undefined) {
	if (!value) return null;
	return value
		.trim()
		.replace(/^https?:\/\//, "")
		.replace(/^www\./, "")
		.replace(/\/+$/, "");
}

async function findClient(listClients: ListClients, siteUrl: string) {
	const clients = await listClients();
	const client = clients.find((row) => row.siteUrl === siteUrl);
	if (!client) {
		throw new StripeConnectOnboardingError(404, `No platform client found for ${siteUrl}`);
	}
	return client;
}

function requireSiteUrl(value: string | undefined) {
	const siteUrl = normalizeStripeConnectSiteUrl(value);
	if (!siteUrl) {
		throw new StripeConnectOnboardingError(400, "Missing siteUrl");
	}
	return siteUrl;
}

async function createAccountLinkUrl(
	stripe: Stripe,
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
	const accountLink = await stripe.accountLinks.create({
		account: accountId,
		type: "account_onboarding",
		refresh_url: `${origin}/api/stripe-connect/onboard/refresh?siteUrl=${encodeURIComponent(siteUrl)}`,
		return_url: `${origin}/api/stripe-connect/callback?siteUrl=${encodeURIComponent(siteUrl)}`,
	});
	return accountLink.url;
}
