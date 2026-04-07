import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { getConvex } from "$lib/server/convexClient";
import { trimString, validateEmail } from "$lib/server/validation";

const convex = getConvex();

export async function POST({ request }) {
	const data = await request.json();

	const name = trimString(data.name, 255);
	const email = trimString(data.email, 255);
	const siteUrl = trimString(data.siteUrl, 255);

	if (!name || !email || !siteUrl) {
		throw error(400, "Name, email, and site URL are required");
	}

	if (!validateEmail(email)) {
		throw error(400, "Invalid email format");
	}

	// Validate admin emails if provided
	if (data.adminEmails?.length) {
		for (const adminEmail of data.adminEmails) {
			if (!validateEmail(adminEmail)) {
				throw error(400, `Invalid admin email format: ${adminEmail}`);
			}
		}
	}

	try {
		const id = await convex.mutation(api.platform.createClient, {
			name,
			email,
			siteUrl,
			sanityProjectId: trimString(data.sanityProjectId, 255) || undefined,
			tier: data.tier || "basic",
			subscriptionStatus: data.subscriptionStatus || "none",
			adminEmails: data.adminEmails || [],
			notes: trimString(data.notes, 5000) || undefined,
		});
		return json({ success: true, id });
	} catch (err) {
		console.error("Failed to create platform client:", err);
		throw error(500, "Failed to create platform client");
	}
}
