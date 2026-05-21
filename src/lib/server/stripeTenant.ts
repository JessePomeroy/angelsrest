import { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import { env as publicEnv } from "$env/dynamic/public";
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
	const convexUrl = publicEnv.PUBLIC_CONVEX_URL;
	if (!convexUrl) {
		return async () => null;
	}

	const convex = new ConvexHttpClient(convexUrl);
	return async (siteUrl) => {
		return await convex.query(api.platform.getStripeAccountForSite, { siteUrl });
	};
}
