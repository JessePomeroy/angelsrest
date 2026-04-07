import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";
import { trimString, validateEmail } from "$lib/server/validation";

const convex = getConvex();

export async function PATCH({ params, request }) {
	const { id } = params;
	const data = await request.json();

	if (data.email && !validateEmail(data.email)) {
		throw error(400, "Invalid email format");
	}

	const updates: Record<string, unknown> = {};
	if (data.name !== undefined) updates.name = trimString(data.name, 255);
	if (data.email !== undefined) updates.email = trimString(data.email, 255);
	if (data.phone !== undefined) updates.phone = trimString(data.phone, 50);
	if (data.category !== undefined) updates.category = data.category;
	if (data.type !== undefined) updates.type = trimString(data.type, 255);
	if (data.status !== undefined) updates.status = data.status;
	if (data.source !== undefined) updates.source = trimString(data.source, 255);
	if (data.notes !== undefined) updates.notes = trimString(data.notes, 5000);
	if (data.siteUrl_client !== undefined)
		updates.siteUrl_client = trimString(data.siteUrl_client, 255);

	try {
		await convex.mutation(api.crm.updateClient, {
			clientId: id as Id<"photographyClients">,
			siteUrl: SITE_DOMAIN,
			...updates,
		});
		return json({ success: true });
	} catch (err) {
		console.error("Failed to update client:", err);
		throw error(500, "Failed to update client");
	}
}

export async function DELETE({ params }) {
	const { id } = params;

	try {
		await convex.mutation(api.crm.deleteClient, {
			clientId: id as Id<"photographyClients">,
			siteUrl: SITE_DOMAIN,
		});
		return json({ success: true });
	} catch (err) {
		console.error("Failed to delete client:", err);
		throw error(500, "Failed to delete client");
	}
}
