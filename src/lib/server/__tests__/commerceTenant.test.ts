import type { ConvexHttpClient } from "convex/browser";
import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveCommerceTenant } from "$lib/server/commerceTenant";
import {
	COMMERCE_TENANT_ID_METADATA_KEY,
	COMMERCE_TENANT_METADATA_KEY,
} from "$lib/server/stripeConnect";

const TENANT_ID = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b";

vi.mock("$convex/api", () => ({
	api: {
		platform: {
			getByStripeConnectedAccountId: "platform.getByStripeConnectedAccountId",
			getCommerceProfileForSite: "platform.getCommerceProfileForSite",
			getTenantRoutingContext: "platform.getTenantRoutingContext",
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

	it("dual-reads the claimed hub identity and compatibility domain", async () => {
		query.mockResolvedValue({ tenantId: TENANT_ID, siteUrl: "angelsrest.online" });

		await expect(
			resolveCommerceTenant(
				event("checkout.session.completed", {
					[COMMERCE_TENANT_METADATA_KEY]: "angelsrest.online",
					[COMMERCE_TENANT_ID_METADATA_KEY]: TENANT_ID,
				}),
				convex,
			),
		).resolves.toMatchObject({ tenantId: TENANT_ID, siteUrl: "angelsrest.online" });
		expect(query).toHaveBeenNthCalledWith(1, "platform.getTenantRoutingContext", {
			tenantId: TENANT_ID,
			webhookSecret: "test-webhook-secret",
		});
		expect(query).toHaveBeenNthCalledWith(2, "platform.getTenantRoutingContext", {
			siteUrl: "angelsrest.online",
			webhookSecret: "test-webhook-secret",
		});
	});

	it("accepts a retained domain alias when it resolves to the same tenant ID", async () => {
		query.mockResolvedValue({ tenantId: TENANT_ID, siteUrl: "angelsrest.online" });

		await expect(
			resolveCommerceTenant(
				event("checkout.session.completed", {
					[COMMERCE_TENANT_METADATA_KEY]: "old-angels.example",
					[COMMERCE_TENANT_ID_METADATA_KEY]: TENANT_ID,
				}),
				convex,
			),
		).resolves.toMatchObject({ tenantId: TENANT_ID, siteUrl: "angelsrest.online" });
	});

	it("rejects a claimed ID whose domain resolves to another tenant", async () => {
		query
			.mockResolvedValueOnce({ tenantId: TENANT_ID, siteUrl: "angelsrest.online" })
			.mockResolvedValueOnce({
				tenantId: "tenant_15eb6092-5d8c-43ce-ad26-1a59522bd07b",
				siteUrl: "other.example",
			});

		await expect(
			resolveCommerceTenant(
				event("checkout.session.completed", {
					[COMMERCE_TENANT_METADATA_KEY]: "angelsrest.online",
					[COMMERCE_TENANT_ID_METADATA_KEY]: TENANT_ID,
				}),
				convex,
			),
		).rejects.toThrow("Commerce tenant identity does not match");
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
		).rejects.toThrow("Commerce tenant identity does not match");
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
