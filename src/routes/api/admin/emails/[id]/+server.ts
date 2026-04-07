import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function PATCH({ params, request }) {
	const { id } = params;
	const data = await request.json();

	try {
		const updates: Record<string, unknown> = {};
		if (data.name !== undefined) updates.name = data.name;
		if (data.category !== undefined) updates.category = data.category;
		if (data.subject !== undefined) updates.subject = data.subject;
		if (data.body !== undefined) updates.body = data.body;
		if (data.variables !== undefined) updates.variables = data.variables;

		await convex.mutation(api.emailTemplates.update, {
			templateId: id as Id<"emailTemplates">,
			siteUrl: SITE_DOMAIN,
			...updates,
		});
		return json({ success: true });
	} catch (err) {
		console.error("Failed to update email template:", err);
		throw error(500, "Failed to update email template");
	}
}

export async function DELETE({ params }) {
	const { id } = params;

	try {
		await convex.mutation(api.emailTemplates.remove, {
			templateId: id as Id<"emailTemplates">,
			siteUrl: SITE_DOMAIN,
		});
		return json({ success: true });
	} catch (err) {
		console.error("Failed to delete email template:", err);
		throw error(500, "Failed to delete email template");
	}
}
