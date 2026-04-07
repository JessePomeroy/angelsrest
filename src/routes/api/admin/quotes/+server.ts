import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function POST({ request }) {
	const data = await request.json();

	if (data._type === "preset") {
		if (!data.name || !data.packages?.length) {
			throw error(400, "Preset name and at least one package required");
		}
		try {
			const id = await convex.mutation(api.quotes.createPreset, {
				siteUrl: SITE_DOMAIN,
				name: data.name,
				category: data.category || undefined,
				packages: data.packages,
			});
			return json({ success: true, id });
		} catch (err) {
			console.error("Failed to create preset:", err);
			throw error(500, "Failed to create preset");
		}
	}

	if (!data.quoteNumber || !data.clientId || !data.packages?.length) {
		throw error(400, "Quote number, client, and at least one package required");
	}

	try {
		const args: Record<string, unknown> = {
			siteUrl: SITE_DOMAIN,
			quoteNumber: data.quoteNumber,
			clientId: data.clientId as Id<"photographyClients">,
			packages: data.packages,
		};

		if (data.category) args.category = data.category;
		if (data.validUntil) args.validUntil = data.validUntil;
		if (data.notes) args.notes = data.notes;

		// biome-ignore lint/suspicious/noExplicitAny: dynamic args built from request body
		const id = await convex.mutation(api.quotes.create, args as any);
		return json({ success: true, id });
	} catch (err) {
		console.error("Failed to create quote:", err);
		throw error(500, "Failed to create quote");
	}
}
