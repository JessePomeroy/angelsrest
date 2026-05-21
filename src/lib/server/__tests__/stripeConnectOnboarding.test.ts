import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import {
	createStripeConnectOnboardingSession,
	normalizeStripeConnectSiteUrl,
	refreshStripeConnectOnboardingSession,
	StripeConnectOnboardingError,
} from "$lib/server/stripeConnectOnboarding";

function makeStripe() {
	const accountsCreate = vi.fn().mockResolvedValue({ id: "acct_new" });
	const accountLinksCreate = vi
		.fn()
		.mockResolvedValue({ url: "https://connect.stripe.test/onboard" });
	const stripe = {
		accounts: { create: accountsCreate },
		accountLinks: { create: accountLinksCreate },
	} as unknown as Stripe;
	return { stripe, accountsCreate, accountLinksCreate };
}

const client = {
	_id: "platform-client-1",
	siteUrl: "zippymiggy.com",
	email: "hello@example.com",
	name: "Reflecting Pool",
};

describe("Stripe Connect onboarding", () => {
	it("normalizes URL-ish site values to bare domains", () => {
		expect(normalizeStripeConnectSiteUrl("https://www.zippymiggy.com/")).toBe("zippymiggy.com");
	});

	it("creates an Express account, stores it, and returns an onboarding link", async () => {
		const { stripe, accountsCreate, accountLinksCreate } = makeStripe();
		const saveAccountId = vi.fn();

		const result = await createStripeConnectOnboardingSession({
			siteUrl: "https://www.zippymiggy.com/",
			platformOrigin: "https://angelsrest.online/",
			stripe,
			listClients: vi.fn().mockResolvedValue([client]),
			saveAccountId,
		});

		expect(accountsCreate).toHaveBeenCalledWith({
			type: "express",
			country: "US",
			email: "hello@example.com",
			capabilities: {
				card_payments: { requested: true },
				transfers: { requested: true },
			},
			metadata: {
				siteUrl: "zippymiggy.com",
				platformClientId: "platform-client-1",
			},
		});
		expect(saveAccountId).toHaveBeenCalledWith({
			siteUrl: "zippymiggy.com",
			stripeConnectedAccountId: "acct_new",
		});
		expect(accountLinksCreate).toHaveBeenCalledWith({
			account: "acct_new",
			type: "account_onboarding",
			refresh_url:
				"https://angelsrest.online/api/stripe-connect/onboard/refresh?siteUrl=zippymiggy.com",
			return_url: "https://angelsrest.online/api/stripe-connect/callback?siteUrl=zippymiggy.com",
		});
		expect(result).toEqual({
			accountId: "acct_new",
			url: "https://connect.stripe.test/onboard",
		});
	});

	it("reuses an existing account instead of creating another one", async () => {
		const { stripe, accountsCreate } = makeStripe();
		const saveAccountId = vi.fn();

		const result = await createStripeConnectOnboardingSession({
			siteUrl: "zippymiggy.com",
			platformOrigin: "https://angelsrest.online",
			stripe,
			listClients: vi.fn().mockResolvedValue([
				{
					...client,
					stripeConnectedAccountId: "acct_existing",
				},
			]),
			saveAccountId,
		});

		expect(accountsCreate).not.toHaveBeenCalled();
		expect(saveAccountId).not.toHaveBeenCalled();
		expect(result.accountId).toBe("acct_existing");
	});

	it("refreshes an existing onboarding link", async () => {
		const { stripe } = makeStripe();

		const result = await refreshStripeConnectOnboardingSession({
			siteUrl: "zippymiggy.com",
			platformOrigin: "https://angelsrest.online",
			stripe,
			listClients: vi.fn().mockResolvedValue([
				{
					...client,
					stripeConnectedAccountId: "acct_existing",
				},
			]),
		});

		expect(result).toEqual({
			accountId: "acct_existing",
			url: "https://connect.stripe.test/onboard",
		});
	});

	it("throws typed errors for missing site and missing clients", async () => {
		const { stripe } = makeStripe();

		await expect(
			createStripeConnectOnboardingSession({
				siteUrl: undefined,
				platformOrigin: "https://angelsrest.online",
				stripe,
				listClients: vi.fn().mockResolvedValue([]),
				saveAccountId: vi.fn(),
			}),
		).rejects.toMatchObject(new StripeConnectOnboardingError(400, "Missing siteUrl"));

		await expect(
			createStripeConnectOnboardingSession({
				siteUrl: "missing.test",
				platformOrigin: "https://angelsrest.online",
				stripe,
				listClients: vi.fn().mockResolvedValue([]),
				saveAccountId: vi.fn(),
			}),
		).rejects.toMatchObject(
			new StripeConnectOnboardingError(404, "No platform client found for missing.test"),
		);
	});
});
