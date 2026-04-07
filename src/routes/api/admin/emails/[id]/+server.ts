import { error, json } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { env as publicEnv } from "$env/dynamic/public";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";

const convex = new ConvexHttpClient(publicEnv.PUBLIC_CONVEX_URL || "");

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
		});
		return json({ success: true });
	} catch (err) {
		console.error("Failed to delete email template:", err);
		throw error(500, "Failed to delete email template");
	}
}
