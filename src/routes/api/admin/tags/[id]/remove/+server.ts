import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function POST({ params, request }) {
	const { id } = params;
	const data = await request.json();

	if (!data.clientId) {
		throw error(400, "clientId is required");
	}

	try {
		await convex.mutation(api.tags.removeTag, {
			siteUrl: SITE_DOMAIN,
			clientId: data.clientId as Id<"photographyClients">,
			tagId: id as Id<"clientTags">,
		});
		return json({ success: true });
	} catch (err) {
		console.error("Failed to remove tag:", err);
		throw error(500, "Failed to remove tag");
	}
}
