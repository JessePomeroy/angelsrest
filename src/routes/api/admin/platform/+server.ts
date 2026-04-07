import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function POST({ request }) {
	const data = await request.json();

	if (!data.name || !data.email || !data.siteUrl) {
		throw error(400, "Name, email, and site URL are required");
	}

	try {
		const id = await convex.mutation(api.platform.createClient, {
			name: data.name,
			email: data.email,
			siteUrl: data.siteUrl,
			sanityProjectId: data.sanityProjectId || undefined,
			tier: data.tier || "basic",
			subscriptionStatus: data.subscriptionStatus || "none",
			adminEmails: data.adminEmails || [],
			notes: data.notes || undefined,
		});
		return json({ success: true, id });
	} catch (err) {
		console.error("Failed to create platform client:", err);
		throw error(500, "Failed to create platform client");
	}
}
