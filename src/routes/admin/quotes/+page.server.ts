import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function load() {
	const [quotes, clients, nextNumber, presets] = await Promise.all([
		convex.query(api.quotes.list, { siteUrl: SITE_DOMAIN }),
		convex.query(api.crm.listClients, { siteUrl: SITE_DOMAIN }),
		convex.query(api.quotes.getNextNumber, { siteUrl: SITE_DOMAIN }),
		convex.query(api.quotes.listPresets, { siteUrl: SITE_DOMAIN }),
	]);
	return { quotes, clients, nextNumber, presets };
}
