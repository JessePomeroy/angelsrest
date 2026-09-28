import type { QueryCtx } from "../_generated/server";
import { resolveTenantContext } from "./tenantContext";

/** Check the retained tenant identity on each public read, including old domain aliases. */
export async function isPublicSiteOffline(ctx: Pick<QueryCtx, "db">, siteUrl: string) {
	const tenant = await resolveTenantContext(ctx, { siteUrl });
	return tenant?.client.offboarding !== undefined;
}
