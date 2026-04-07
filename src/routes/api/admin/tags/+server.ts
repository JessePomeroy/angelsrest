import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function POST({ request }) {
	const data = await request.json();

	if (!data.name) {
		throw error(400, "Tag name is required");
	}

	try {
		const id = await convex.mutation(api.tags.createTag, {
			siteUrl: SITE_DOMAIN,
			name: data.name,
			color: data.color || undefined,
		});
		return json({ success: true, id });
	} catch (err) {
		console.error("Failed to create tag:", err);
		throw error(500, "Failed to create tag");
	}
}
