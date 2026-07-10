import { redirect } from "@sveltejs/kit";

export function load({ url }) {
	if (!url.searchParams.has("email")) return {};

	const cleanUrl = new URL(url);
	cleanUrl.searchParams.delete("email");
	throw redirect(303, `${cleanUrl.pathname}${cleanUrl.search}`);
}
