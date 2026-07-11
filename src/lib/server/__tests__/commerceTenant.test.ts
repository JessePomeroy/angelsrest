import type { ConvexHttpClient } from "convex/browser";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCommerceTenant } from "$lib/server/commerceTenant";
import { COMMERCE_TENANT_METADATA_KEY } from "$lib/server/stripeConnect";

vi.mock("$convex/api", () => ({
	api: {
		platform: {
			getByStripeConnectedAccountId: "platform.getByStripeConnectedAccountId",
			getCommerceProfileForSite: "platform.getCommerceProfileForSite",
		},
	},
}));

vi.mock("$env/dynamic/private", () => ({
	env: { WEBHOOK_SECRET: "test-webhook-secret" },
}));

vi.mock("$lib/config/site", () => ({
	ADMIN_EMAIL: "admin@example.com",
	SITE_DOMAIN: "angelsrest.online",
}));

function event(
	type: Stripe.Event.Type,
	metadata?: Record<string, string>,
	account?: string,
): Stripe.Event {
	return {
		id: "evt_test_123",
		type,
		account,
		data: { object: { id: "object_123", metadata } },
	} as unknown as Stripe.Event;
}

describe("commerce tenant resolution", () => {
	const query = vi.fn();
	const convex = { query } as unknown as ConvexHttpClient;

	beforeEach(() => {
		query.mockReset();
	});

	it("preserves the hub fallback for legacy events without tenant metadata", async () => {
		await expect(
			resolveCommerceTenant(event("checkout.session.completed"), convex),
		).resolves.toEqual({
			siteUrl: "angelsrest.online",
			notificationProfile: {
				siteName: "Angel's Rest",
				siteUrl: "angelsrest.online",
				adminEmail: "admin@example.com",
			},
		});
		expect(query).not.toHaveBeenCalled();
	});

	it("resolves a platform-account Checkout Session from its server-owned tenant marker", async () => {
		query.mockResolvedValue({
			siteName: "Reflecting Pool",
			siteUrl: "zippymiggy.com",
			adminEmail: "maggie@example.com",
		});

		await expect(
			resolveCommerceTenant(
				event("checkout.session.completed", {
					[COMMERCE_TENANT_METADATA_KEY]: "zippymiggy.com",
				}),
				convex,
			),
		).resolves.toEqual({
			siteUrl: "zippymiggy.com",
			notificationProfile: {
				siteName: "Reflecting Pool",
				siteUrl: "zippymiggy.com",
				adminEmail: "maggie@example.com",
			},
		});
		expect(query).toHaveBeenCalledWith("platform.getCommerceProfileForSite", {
			siteUrl: "zippymiggy.com",
			webhookSecret: "test-webhook-secret",
		});
	});

	it("uses the same marker on platform-account PaymentIntent failures", async () => {
		query.mockResolvedValue({
			siteName: "Reflecting Pool",
			siteUrl: "zippymiggy.com",
			adminEmail: "maggie@example.com",
		});

		await resolveCommerceTenant(
			event("payment_intent.payment_failed", {
				[COMMERCE_TENANT_METADATA_KEY]: "zippymiggy.com",
			}),
			convex,
		);

		expect(query).toHaveBeenCalledWith("platform.getCommerceProfileForSite", {
			siteUrl: "zippymiggy.com",
			webhookSecret: "test-webhook-secret",
		});
	});

	it("keeps connected-account routing authoritative and rejects conflicting metadata", async () => {
		query.mockResolvedValue({
			name: "Reflecting Pool",
			siteUrl: "zippymiggy.com",
			email: "owner@example.com",
			adminEmails: ["maggie@example.com"],
		});

		await expect(
			resolveCommerceTenant(
				event(
					"checkout.session.completed",
					{ [COMMERCE_TENANT_METADATA_KEY]: "other.example" },
					"acct_123",
				),
				convex,
			),
		).rejects.toThrow("Stripe account acct_123 does not match commerce tenant other.example");
	});

	it("fails closed when a marked platform tenant is not registered", async () => {
		query.mockResolvedValue(null);

		await expect(
			resolveCommerceTenant(
				event("checkout.session.completed", {
					[COMMERCE_TENANT_METADATA_KEY]: "unknown.example",
				}),
				convex,
			),
		).rejects.toThrow("No platform client found for unknown.example");
	});
});
