import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function POST({ request }) {
	const { clientId, targetColumnId, targetPosition } = await request.json();

	if (!clientId || !targetColumnId || targetPosition === undefined) {
		throw error(
			400,
			"clientId, targetColumnId, and targetPosition are required",
		);
	}

	try {
		await convex.mutation(api.kanban.moveCard, {
			clientId,
			siteUrl: SITE_DOMAIN,
			targetColumnId,
			targetPosition,
		});
		return json({ success: true });
	} catch (err) {
		console.error("Failed to move card:", err);
		throw error(500, "Failed to move card");
	}
}
