import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function load() {
	const [clients, stats, tags] = await Promise.all([
		convex.query(api.crm.listClients, { siteUrl: SITE_DOMAIN }),
		convex.query(api.crm.getStats, { siteUrl: SITE_DOMAIN }),
		convex.query(api.tags.listTags, { siteUrl: SITE_DOMAIN }),
	]);
	return { clients, stats, tags };
}
