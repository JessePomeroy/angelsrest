import type { ConvexHttpClient } from "convex/browser";
import type Stripe from "stripe";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import { ADMIN_EMAIL, SITE_DOMAIN } from "$lib/config/site";
import { logStructured } from "$lib/server/logger";
import {
	COMMERCE_TENANT_ID_METADATA_KEY,
	COMMERCE_TENANT_ID_PATTERN,
	COMMERCE_TENANT_METADATA_KEY,
	normalizeCommerceTenantSiteUrl,
} from "$lib/server/stripeConnect";

export interface CommerceNotificationProfile {
	siteName: string;
	siteUrl: string;
	adminEmail: string;
}

export interface ResolvedCommerceTenant {
	tenantId?: string;
	siteUrl: string;
	notificationProfile: CommerceNotificationProfile;
	stripeRequestOptions?: Stripe.RequestOptions;
}

/** A permanent conflict in signed commerce tenant identity. */
export class CommerceTenantIdentityError extends Error {}

export const ANGELS_REST_COMMERCE_PROFILE: CommerceNotificationProfile = {
	siteName: "Angel's Rest",
	siteUrl: SITE_DOMAIN,
	adminEmail: ADMIN_EMAIL,
};

export async function resolveCommerceTenant(
	event: Stripe.Event,
	convex: ConvexHttpClient,
	routedSiteUrl?: string,
	routedTenantId?: string,
): Promise<ResolvedCommerceTenant> {
	const accountId = typeof event.account === "string" ? event.account : undefined;
	const metadataSiteUrl = routedSiteUrl ?? readMetadataSiteUrl(event);
	const metadataTenantId = routedTenantId ?? readMetadataTenantId(event);
	return resolveCommerceContext(convex, accountId, metadataSiteUrl, metadataTenantId);
}

/** Resume only the tenant/account already authenticated and stored at paid-order intake. */
export function resolveStoredCommerceTenant(
	order: { siteUrl: string; tenantId?: string; stripeConnectedAccountId?: string },
	convex: ConvexHttpClient,
) {
	return resolveCommerceContext(
		convex,
		order.stripeConnectedAccountId,
		order.siteUrl,
		order.tenantId,
	);
}

async function resolveCommerceContext(
	convex: ConvexHttpClient,
	accountId: string | undefined,
	metadataSiteUrl: string | undefined,
	metadataTenantId: string | undefined,
): Promise<ResolvedCommerceTenant> {
	const identityContext = metadataTenantId
		? await resolvePairedTenantContext(convex, metadataTenantId, metadataSiteUrl)
		: undefined;
	if (!accountId && !metadataSiteUrl) {
		return {
			siteUrl: SITE_DOMAIN,
			notificationProfile: ANGELS_REST_COMMERCE_PROFILE,
		};
	}

	if (!accountId && (isHubSite(metadataSiteUrl) || isHubSite(identityContext?.siteUrl))) {
		return {
			...(metadataTenantId ? { tenantId: metadataTenantId } : {}),
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
			throw new CommerceTenantIdentityError(
				`No platform client found for Stripe account ${accountId}`,
			);
		}
		if (
			!identityContext &&
			metadataSiteUrl &&
			normalizeCommerceTenantSiteUrl(metadataSiteUrl) !==
				normalizeCommerceTenantSiteUrl(client.siteUrl)
		) {
			identityConflict("connected_site_mismatch", { accountId: true });
		}
		if (identityContext && identityContext.tenantId !== client.tenantId) {
			identityConflict("connected_tenant_id_mismatch", { accountId: true });
		}

		return {
			...(client.tenantId ? { tenantId: client.tenantId } : {}),
			siteUrl: client.siteUrl,
			notificationProfile: {
				siteName: client.name || client.siteUrl,
				siteUrl: client.siteUrl,
				adminEmail: client.adminEmails?.[0] || client.email || ADMIN_EMAIL,
			},
			stripeRequestOptions: { stripeAccount: accountId },
		};
	}

	if (!metadataSiteUrl) throw new CommerceTenantIdentityError("Commerce tenant metadata missing");
	const profile = await convex.query(api.platform.getCommerceProfileForSite, {
		siteUrl: identityContext?.siteUrl ?? metadataSiteUrl,
		webhookSecret,
	});
	if (!profile) {
		throw new CommerceTenantIdentityError(`No platform client found for ${metadataSiteUrl}`);
	}
	if (identityContext && identityContext.tenantId !== profile.tenantId) {
		identityConflict("platform_tenant_id_mismatch", { accountId: false });
	}

	return {
		...(profile.tenantId ? { tenantId: profile.tenantId } : {}),
		siteUrl: profile.siteUrl,
		notificationProfile: {
			siteName: profile.siteName,
			siteUrl: profile.siteUrl,
			adminEmail: profile.adminEmail,
		},
	};
}

function readMetadataSiteUrl(event: Stripe.Event) {
	const object = event.data.object as { metadata?: Record<string, string> | null };
	const value = object.metadata?.[COMMERCE_TENANT_METADATA_KEY];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readMetadataTenantId(event: Stripe.Event) {
	const object = event.data.object as { metadata?: Record<string, string> | null };
	const value = object.metadata?.[COMMERCE_TENANT_ID_METADATA_KEY];
	if (value === undefined) return undefined;
	if (!COMMERCE_TENANT_ID_PATTERN.test(value)) {
		identityConflict("invalid_tenant_id", { accountId: typeof event.account === "string" });
	}
	return value;
}

async function resolvePairedTenantContext(
	convex: ConvexHttpClient,
	tenantId: string,
	siteUrl: string | undefined,
) {
	if (!siteUrl) identityConflict("tenant_id_without_site", { accountId: false });
	const webhookSecret = requireWebhookSecret();
	const [byId, bySiteUrl] = await Promise.all([
		convex.query(api.platform.getTenantRoutingContext, { tenantId, webhookSecret }),
		convex.query(api.platform.getTenantRoutingContext, { siteUrl, webhookSecret }),
	]);
	if (!byId || !bySiteUrl || byId.tenantId !== bySiteUrl.tenantId) {
		identityConflict("tenant_id_domain_mismatch", { accountId: false });
	}
	return byId;
}

function identityConflict(reason: string, meta: Record<string, unknown>): never {
	const error = new CommerceTenantIdentityError("Commerce tenant identity does not match");
	logStructured({
		event: "commerce.tenant_identity_mismatch",
		level: "error",
		stage: "checkout_tenant",
		error,
		meta: { reason, ...meta },
	});
	throw error;
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
