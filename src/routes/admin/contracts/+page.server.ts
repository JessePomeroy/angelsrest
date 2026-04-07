import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function load() {
	const [contracts, clients, templates] = await Promise.all([
		convex.query(api.contracts.list, { siteUrl: SITE_DOMAIN }),
		convex.query(api.crm.listClients, { siteUrl: SITE_DOMAIN }),
		convex.query(api.contracts.listTemplates, {
			siteUrl: SITE_DOMAIN,
		}),
	]);
	return { contracts, clients, templates };
}
