import { redirect } from "@sveltejs/kit";

export function GET({ url }) {
	const siteUrl = url.searchParams.get("siteUrl");
	const params = new URLSearchParams({ stripe_connect: "returned" });
	if (siteUrl) {
		params.set("siteUrl", siteUrl);
	}
	throw redirect(303, `/admin?${params.toString()}`);
}
