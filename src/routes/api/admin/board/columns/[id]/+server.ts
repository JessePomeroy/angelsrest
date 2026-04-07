import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";
import { trimString } from "$lib/server/validation";

const convex = getConvex();

export async function PATCH({ params, request }) {
	const { configId, name: rawName } = await request.json();
	const name = trimString(rawName, 255);

	if (!configId || !name) {
		throw error(400, "configId and name are required");
	}

	try {
		await convex.mutation(api.kanban.renameColumn, {
			configId,
			siteUrl: SITE_DOMAIN,
			columnId: params.id,
			name,
		});
		return json({ success: true });
	} catch (err) {
		console.error("Failed to rename column:", err);
		throw error(500, "Failed to rename column");
	}
}

export async function DELETE({ params, request }) {
	const { configId, moveToColumnId } = await request.json();

	if (!configId) {
		throw error(400, "configId is required");
	}

	try {
		await convex.mutation(api.kanban.deleteColumn, {
			configId,
			siteUrl: SITE_DOMAIN,
			columnId: params.id,
			moveToColumnId,
		});
		return json({ success: true });
	} catch (err) {
		console.error("Failed to delete column:", err);
		throw error(500, "Failed to delete column");
	}
}
