import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function POST({ request }) {
	const data = await request.json();

	try {
		if (data._type === "template") {
			const variables = data.variables?.length ? data.variables : undefined;
			const id = await convex.mutation(api.contracts.createTemplate, {
				siteUrl: SITE_DOMAIN,
				name: data.name,
				body: data.body,
				variables,
			});
			return json({ success: true, id });
		}

		if (!data.title || !data.clientId || !data.body) {
			throw error(400, "Title, client, and body are required");
		}

		const args: Record<string, unknown> = {
			siteUrl: SITE_DOMAIN,
			title: data.title,
			clientId: data.clientId as Id<"photographyClients">,
			body: data.body,
			category: data.category || undefined,
			templateId: data.templateId
				? (data.templateId as Id<"contractTemplates">)
				: undefined,
			eventDate: data.eventDate || undefined,
			eventLocation: data.eventLocation || undefined,
			totalPrice: data.totalPrice || undefined,
			depositAmount: data.depositAmount || undefined,
		};

		// biome-ignore lint/suspicious/noExplicitAny: dynamic args built from request body
		const id = await convex.mutation(api.contracts.create, args as any);
		return json({ success: true, id });
	} catch (err) {
		console.error("Failed to create contract:", err);
		throw error(500, "Failed to create contract");
	}
}
