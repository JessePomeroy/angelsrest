import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";
import { trimString } from "$lib/server/validation";

const convex = getConvex();

export async function POST({ request }) {
	const data = await request.json();

	try {
		const name = trimString(data.name, 255);
		const subject = trimString(data.subject, 255);
		const body = trimString(data.body, 50000);

		if (!name || !data.category || !subject || !body) {
			throw error(400, "Name, category, subject, and body are required");
		}

		const variables = data.variables?.length ? data.variables : undefined;

		const id = await convex.mutation(api.emailTemplates.create, {
			siteUrl: SITE_DOMAIN,
			name,
			category: data.category,
			subject,
			body,
			variables,
		});
		return json({ success: true, id });
	} catch (err) {
		console.error("Failed to create email template:", err);
		throw error(500, "Failed to create email template");
	}
}
