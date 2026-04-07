import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";
import { trimString, validateEmail } from "$lib/server/validation";

const convex = getConvex();

export async function POST({ request }) {
	const data = await request.json();

	const name = trimString(data.name, 255);
	if (!name || !data.category) {
		throw error(400, "Name and category are required");
	}

	if (data.email && !validateEmail(data.email)) {
		throw error(400, "Invalid email format");
	}

	try {
		const id = await convex.mutation(api.crm.createClient, {
			siteUrl: SITE_DOMAIN,
			name,
			email: trimString(data.email, 255) || undefined,
			phone: trimString(data.phone, 50) || undefined,
			category: data.category,
			type: trimString(data.type, 255) || undefined,
			source: trimString(data.source, 255) || undefined,
			notes: trimString(data.notes, 5000) || undefined,
			siteUrl_client: trimString(data.siteUrl_client, 255) || undefined,
		});
		return json({ success: true, id });
	} catch (err) {
		console.error("Failed to create client:", err);
		throw error(500, "Failed to create client");
	}
}
