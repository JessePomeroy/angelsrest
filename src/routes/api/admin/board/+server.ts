import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";
import { trimString } from "$lib/server/validation";

const convex = getConvex();

export async function POST({ request }) {
	const { projectType } = await request.json();

	const trimmedType = trimString(projectType, 255);
	if (!trimmedType) {
		throw error(400, "projectType is required");
	}

	try {
		const configId = await convex.mutation(api.kanban.initializeBoard, {
			siteUrl: SITE_DOMAIN,
			projectType: trimmedType,
		});
		return json({ success: true, configId });
	} catch (err) {
		console.error("Failed to initialize board:", err);
		throw error(500, "Failed to initialize board");
	}
}
