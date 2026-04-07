import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";
import { trimString, validatePositiveNumber } from "$lib/server/validation";

const convex = getConvex();

export async function POST({ request }) {
	const data = await request.json();

	try {
		if (data._type === "template") {
			const templateName = trimString(data.name, 255);
			const templateBody = trimString(data.body, 50000);
			if (!templateName || !templateBody) {
				throw error(400, "Template name and body are required");
			}
			const variables = data.variables?.length ? data.variables : undefined;
			const id = await convex.mutation(api.contracts.createTemplate, {
				siteUrl: SITE_DOMAIN,
				name: templateName,
				body: templateBody,
				variables,
			});
			return json({ success: true, id });
		}

		const title = trimString(data.title, 255);
		const body = trimString(data.body, 50000);
		if (!title || !data.clientId || !body) {
			throw error(400, "Title, client, and body are required");
		}

		const args: Record<string, unknown> = {
			siteUrl: SITE_DOMAIN,
			title,
			clientId: data.clientId as Id<"photographyClients">,
			body,
			category: data.category || undefined,
			templateId: data.templateId
				? (data.templateId as Id<"contractTemplates">)
				: undefined,
			eventDate: trimString(data.eventDate, 255) || undefined,
			eventLocation: trimString(data.eventLocation, 255) || undefined,
			totalPrice:
				data.totalPrice !== undefined
					? validatePositiveNumber(data.totalPrice, "totalPrice")
					: undefined,
			depositAmount:
				data.depositAmount !== undefined
					? validatePositiveNumber(data.depositAmount, "depositAmount")
					: undefined,
		};

		// biome-ignore lint/suspicious/noExplicitAny: dynamic args built from request body
		const id = await convex.mutation(api.contracts.create, args as any);
		return json({ success: true, id });
	} catch (err) {
		console.error("Failed to create contract:", err);
		throw error(500, "Failed to create contract");
	}
}
