import { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import { getConvexUrl } from "$lib/server/runtimeConfig";
import type { StripeTenantAccount } from "$lib/server/stripeConnect";

type TenantLookup = (siteUrl: string) => Promise<StripeTenantAccount | null>;

interface ResolveStripeTenantOptions {
	lookup?: TenantLookup;
	requirePlatformClient?: boolean;
}

export async function resolveStripeTenantForSite(
	siteUrl: string,
	options: ResolveStripeTenantOptions = {},
): Promise<StripeTenantAccount> {
	const lookup = options.lookup ?? createConvexTenantLookup();
	const tenant = await lookup(siteUrl);

	if (tenant) {
		return {
			tenantId: tenant.tenantId,
			siteUrl: tenant.siteUrl || siteUrl,
			name: tenant.name,
			stripeConnectedAccountId: tenant.stripeConnectedAccountId,
		};
	}

	if (options.requirePlatformClient) {
		throw new Error(`No platform client found for ${siteUrl}`);
	}

	return { siteUrl };
}

function createConvexTenantLookup(): TenantLookup {
	const convex = new ConvexHttpClient(getConvexUrl());
	return async (siteUrl) => {
		return await convex.query(api.platform.getStripeAccountForSite, { siteUrl });
	};
}
