import type { ConvexHttpClient } from "convex/browser";
import type Stripe from "stripe";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import { ADMIN_EMAIL, SITE_DOMAIN } from "$lib/config/site";
import {
	COMMERCE_TENANT_METADATA_KEY,
	normalizeCommerceTenantSiteUrl,
} from "$lib/server/stripeConnect";

export interface CommerceNotificationProfile {
	siteName: string;
	siteUrl: string;
	adminEmail: string;
}

export interface ResolvedCommerceTenant {
	siteUrl: string;
	notificationProfile: CommerceNotificationProfile;
	stripeRequestOptions?: Stripe.RequestOptions;
}

export const ANGELS_REST_COMMERCE_PROFILE: CommerceNotificationProfile = {
	siteName: "Angel's Rest",
	siteUrl: SITE_DOMAIN,
	adminEmail: ADMIN_EMAIL,
};

/** Resolve the tenant account and non-secret notification identity for one Stripe event. */
export async function resolveCommerceTenant(
	event: Stripe.Event,
	convex: ConvexHttpClient,
): Promise<ResolvedCommerceTenant> {
	const accountId = typeof event.account === "string" ? event.account : undefined;
	const metadataSiteUrl = readMetadataSiteUrl(event);
	if (!accountId && !metadataSiteUrl) {
		return {
			siteUrl: SITE_DOMAIN,
			notificationProfile: ANGELS_REST_COMMERCE_PROFILE,
		};
	}

	if (!accountId && isHubSite(metadataSiteUrl)) {
		return {
			siteUrl: SITE_DOMAIN,
			notificationProfile: ANGELS_REST_COMMERCE_PROFILE,
		};
	}

	const webhookSecret = requireWebhookSecret();
	if (accountId) {
		const client = await convex.query(api.platform.getByStripeConnectedAccountId, {
			stripeConnectedAccountId: accountId,
			webhookSecret,
		});
		if (!client) {
			throw new Error(`No platform client found for Stripe account ${accountId}`);
		}
		if (
			metadataSiteUrl &&
			normalizeCommerceTenantSiteUrl(metadataSiteUrl) !==
				normalizeCommerceTenantSiteUrl(client.siteUrl)
		) {
			throw new Error(
				`Stripe account ${accountId} does not match commerce tenant ${metadataSiteUrl}`,
			);
		}

		return {
			siteUrl: client.siteUrl,
			notificationProfile: {
				siteName: client.name || client.siteUrl,
				siteUrl: client.siteUrl,
				adminEmail: client.adminEmails?.[0] || client.email || ADMIN_EMAIL,
			},
			stripeRequestOptions: { stripeAccount: accountId },
		};
	}

	if (!metadataSiteUrl) throw new Error("Commerce tenant metadata missing");
	const profile = await convex.query(api.platform.getCommerceProfileForSite, {
		siteUrl: metadataSiteUrl,
		webhookSecret,
	});
	if (!profile) throw new Error(`No platform client found for ${metadataSiteUrl}`);

	return {
		siteUrl: profile.siteUrl,
		notificationProfile: profile,
	};
}

function readMetadataSiteUrl(event: Stripe.Event) {
	const object = event.data.object as { metadata?: Record<string, string> | null };
	const value = object.metadata?.[COMMERCE_TENANT_METADATA_KEY];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isHubSite(siteUrl: string | undefined) {
	if (!siteUrl) return false;
	const normalized = normalizeCommerceTenantSiteUrl(siteUrl);
	return normalized === SITE_DOMAIN || normalized === "localhost" || normalized === "127.0.0.1";
}

function requireWebhookSecret() {
	const webhookSecret = env.WEBHOOK_SECRET;
	if (!webhookSecret) throw new Error("WEBHOOK_SECRET not configured");
	return webhookSecret;
}
