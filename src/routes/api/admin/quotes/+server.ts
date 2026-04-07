import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { SITE_DOMAIN } from "$lib/config/site";
import { getConvex } from "$lib/server/convexClient";
import { trimString, validatePositiveNumber } from "$lib/server/validation";

const convex = getConvex();

function validatePackages(packages: unknown[]) {
	for (const pkg of packages) {
		const p = pkg as Record<string, unknown>;
		if (!p.name || typeof p.name !== "string") {
			throw error(400, "Each package must have a name");
		}
		p.name = p.name.trim().slice(0, 255);
		if (p.description) {
			p.description = String(p.description).trim().slice(0, 5000);
		}
		p.price = validatePositiveNumber(p.price, "package price");
	}
}

export async function POST({ request }) {
	const data = await request.json();

	if (data._type === "preset") {
		const presetName = trimString(data.name, 255);
		if (!presetName || !data.packages?.length) {
			throw error(400, "Preset name and at least one package required");
		}
		validatePackages(data.packages);
		try {
			const id = await convex.mutation(api.quotes.createPreset, {
				siteUrl: SITE_DOMAIN,
				name: presetName,
				category: data.category || undefined,
				packages: data.packages,
			});
			return json({ success: true, id });
		} catch (err) {
			console.error("Failed to create preset:", err);
			throw error(500, "Failed to create preset");
		}
	}

	const quoteNumber = trimString(data.quoteNumber, 255);
	if (!quoteNumber || !data.clientId || !data.packages?.length) {
		throw error(400, "Quote number, client, and at least one package required");
	}

	validatePackages(data.packages);

	try {
		const args: Record<string, unknown> = {
			siteUrl: SITE_DOMAIN,
			quoteNumber,
			clientId: data.clientId as Id<"photographyClients">,
			packages: data.packages,
		};

		if (data.category) args.category = data.category;
		if (data.validUntil) args.validUntil = trimString(data.validUntil, 255);
		if (data.notes) args.notes = trimString(data.notes, 5000);

		// biome-ignore lint/suspicious/noExplicitAny: dynamic args built from request body
		const id = await convex.mutation(api.quotes.create, args as any);
		return json({ success: true, id });
	} catch (err) {
		console.error("Failed to create quote:", err);
		throw error(500, "Failed to create quote");
	}
}
