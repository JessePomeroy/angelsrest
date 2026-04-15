import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function load() {
	let inquiries: any[] = [];
	try {
		inquiries = await convex.query(api.inquiries.list, {
			siteUrl: SITE_DOMAIN,
		});
	} catch (err) {
		console.error("Failed to fetch inquiries:", err);
	}

	return {
		inquiries,
	};
}
