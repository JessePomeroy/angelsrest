import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";
import { trimString } from "$lib/server/validation";

const convex = getConvex();

export async function POST({ request }) {
	const { configId, name: rawName } = await request.json();
	const name = trimString(rawName, 255);

	if (!configId || !name) {
		throw error(400, "configId and name are required");
	}

	try {
		const columnId = await convex.mutation(api.kanban.addColumn, {
			configId,
			siteUrl: SITE_DOMAIN,
			name,
		});
		return json({ success: true, columnId });
	} catch (err) {
		console.error("Failed to add column:", err);
		throw error(500, "Failed to add column");
	}
}

export async function PATCH({ request }) {
	const { configId, columnIds } = await request.json();

	if (!configId || !columnIds) {
		throw error(400, "configId and columnIds are required");
	}

	try {
		await convex.mutation(api.kanban.reorderColumns, {
			configId,
			siteUrl: SITE_DOMAIN,
			columnIds,
		});
		return json({ success: true });
	} catch (err) {
		console.error("Failed to reorder columns:", err);
		throw error(500, "Failed to reorder columns");
	}
}
