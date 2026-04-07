import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function load() {
	const [boardConfigs, clients] = await Promise.all([
		convex.query(api.kanban.listBoardConfigs, { siteUrl: SITE_DOMAIN }),
		convex.query(api.crm.listClients, { siteUrl: SITE_DOMAIN }),
	]);
	return { boardConfigs, clients };
}
