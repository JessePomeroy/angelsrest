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
		if (data._type === "template") {
			const updates: Record<string, unknown> = {};
			if (data.name !== undefined) updates.name = data.name;
			if (data.body !== undefined) updates.body = data.body;
			if (data.variables !== undefined) updates.variables = data.variables;
			await convex.mutation(api.contracts.updateTemplate, {
				templateId: id as Id<"contractTemplates">,
				siteUrl: SITE_DOMAIN,
				...updates,
			});
			return json({ success: true });
		}

		if (data.action === "send") {
			await convex.mutation(api.contracts.markSent, {
				contractId: id as Id<"contracts">,
				siteUrl: SITE_DOMAIN,
			});
		} else if (data.action === "sign") {
			await convex.mutation(api.contracts.markSigned, {
				contractId: id as Id<"contracts">,
				siteUrl: SITE_DOMAIN,
			});
		} else {
			await convex.mutation(api.contracts.update, {
				contractId: id as Id<"contracts">,
				siteUrl: SITE_DOMAIN,
				...data,
			});
		}
		return json({ success: true });
	} catch (err) {
		console.error("Failed to update contract:", err);
		throw error(500, "Failed to update contract");
	}
}

export async function DELETE({ params, request }) {
	const { id } = params;

	try {
		let isTemplate = false;
		try {
			const body = await request.json();
			isTemplate = body._type === "template";
		} catch {
			// No body means contract
		}

		if (isTemplate) {
			await convex.mutation(api.contracts.removeTemplate, {
				templateId: id as Id<"contractTemplates">,
				siteUrl: SITE_DOMAIN,
			});
		} else {
			await convex.mutation(api.contracts.remove, {
				contractId: id as Id<"contracts">,
				siteUrl: SITE_DOMAIN,
			});
		}
		return json({ success: true });
	} catch (err) {
		console.error("Failed to delete:", err);
		throw error(500, "Failed to delete");
	}
}
