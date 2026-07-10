import type { ConvexHttpClient } from "convex/browser";
import type Stripe from "stripe";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import { ADMIN_EMAIL, SITE_DOMAIN } from "$lib/config/site";

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
	if (!accountId) {
		return {
			siteUrl: SITE_DOMAIN,
			notificationProfile: ANGELS_REST_COMMERCE_PROFILE,
		};
	}

	const webhookSecret = env.WEBHOOK_SECRET;
	if (!webhookSecret) {
		throw new Error("WEBHOOK_SECRET not configured");
	}

	const client = await convex.query(api.platform.getByStripeConnectedAccountId, {
		stripeConnectedAccountId: accountId,
		webhookSecret,
	});
	if (!client) {
		throw new Error(`No platform client found for Stripe account ${accountId}`);
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
