import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function load() {
	let newInquiryCount = 0;
	try {
		newInquiryCount = await convex.query(api.inquiries.countNew, {
			siteUrl: SITE_DOMAIN,
		});
	} catch (err) {
		console.error("Failed to fetch inquiry count:", err);
	}

	return {
		newInquiryCount,
	};
}
