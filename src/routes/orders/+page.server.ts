import { error, redirect } from "@sveltejs/kit";
import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

export async function load({ url }) {
	if (!url.searchParams.has("email")) {
		const siteUrl = url.searchParams.get("site") ?? SITE_DOMAIN;
		if (!/^[a-z0-9][a-z0-9.-]{0,252}$/.test(siteUrl)) error(404, "Store not found");
		if (siteUrl === SITE_DOMAIN) return { siteUrl, siteName: "Angel's Rest" };
		const site = await getConvex().query(api.platform.getFeatureAccess, { siteUrl });
		if (!site) error(404, "Store not found");
		return { siteUrl: site.siteUrl, siteName: site.siteName };
	}

	const cleanUrl = new URL(url);
	cleanUrl.searchParams.delete("email");
	throw redirect(303, `${cleanUrl.pathname}${cleanUrl.search}`);
}
