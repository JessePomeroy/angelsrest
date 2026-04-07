import { json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function GET({ params }) {
	const { id } = params;

	try {
		const activity = await convex.query(api.activityLog.getClientActivity, {
			clientId: id as Id<"photographyClients">,
		});
		return json({ activity });
	} catch (err) {
		console.error("Failed to get client activity:", err);
		return json({ activity: [] });
	}
}
