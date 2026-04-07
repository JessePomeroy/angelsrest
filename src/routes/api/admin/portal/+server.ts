import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function POST({ request }) {
	const data = await request.json();

	if (!data.type || !data.documentId || !data.clientId) {
		throw error(400, "type, documentId, and clientId are required");
	}

	const validTypes = ["invoice", "quote", "contract"];
	if (!validTypes.includes(data.type)) {
		throw error(400, "Invalid type");
	}

	try {
		const token = await convex.mutation(api.portal.createToken, {
			siteUrl: SITE_DOMAIN,
			type: data.type,
			documentId: data.documentId,
			clientId: data.clientId as Id<"photographyClients">,
			expiresAt: data.expiresAt,
		});
		return json({ success: true, token });
	} catch (err) {
		console.error("Failed to create portal token:", err);
		throw error(500, "Failed to create portal token");
	}
}
