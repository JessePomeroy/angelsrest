import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function load() {
	const templates = await convex.query(api.emailTemplates.list, {
		siteUrl: SITE_DOMAIN,
	});
	return { templates };
}
