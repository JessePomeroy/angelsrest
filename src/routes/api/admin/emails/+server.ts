import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function POST({ request }) {
	const data = await request.json();

	try {
		if (!data.name || !data.category || !data.subject || !data.body) {
			throw error(400, "Name, category, subject, and body are required");
		}

		const variables = data.variables?.length ? data.variables : undefined;

		const id = await convex.mutation(api.emailTemplates.create, {
			siteUrl: SITE_DOMAIN,
			name: data.name,
			category: data.category,
			subject: data.subject,
			body: data.body,
			variables,
		});
		return json({ success: true, id });
	} catch (err) {
		console.error("Failed to create email template:", err);
		throw error(500, "Failed to create email template");
	}
}
