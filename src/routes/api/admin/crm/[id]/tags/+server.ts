import { json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function GET({ params }) {
	const { id } = params;

	try {
		const tags = await convex.query(api.tags.getClientTags, {
			clientId: id as Id<"photographyClients">,
		});
		return json({ tags });
	} catch (err) {
		console.error("Failed to get client tags:", err);
		return json({ tags: [] });
	}
}
