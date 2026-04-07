import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function load() {
	const [invoices, clients, nextNumber] = await Promise.all([
		convex.query(api.invoices.list, { siteUrl: SITE_DOMAIN }),
		convex.query(api.crm.listClients, { siteUrl: SITE_DOMAIN }),
		convex.query(api.invoices.getNextNumber, {
			siteUrl: SITE_DOMAIN,
		}),
	]);
	return { invoices, clients, nextNumber };
}
