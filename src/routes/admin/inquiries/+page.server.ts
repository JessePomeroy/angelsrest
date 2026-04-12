import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function load() {
	const inquiries = await convex.query(api.inquiries.list, {
		siteUrl: SITE_DOMAIN,
	});

	return {
		inquiries,
	};
}
