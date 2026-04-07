import { error, json } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { env as publicEnv } from "$env/dynamic/public";
import { api } from "../../../../../convex/_generated/api";

const convex = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL!);

export async function POST({ request }) {
	const data = await request.json();

	if (!data.name || !data.category) {
		throw error(400, "Name and category are required");
	}

	try {
		const id = await convex.mutation(api.crm.createClient, {
			siteUrl: "angelsrest.online",
			name: data.name,
			email: data.email || undefined,
			phone: data.phone || undefined,
			category: data.category,
			type: data.type || undefined,
			source: data.source || undefined,
			notes: data.notes || undefined,
			siteUrl_client: data.siteUrl_client || undefined,
		});
		return json({ success: true, id });
	} catch (err) {
		console.error("Failed to create client:", err);
		throw error(500, "Failed to create client");
	}
}
