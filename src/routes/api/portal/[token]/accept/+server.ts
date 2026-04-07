import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function POST({ params }) {
	const { token } = params;

	const result = await convex.query(api.portal.getByToken, { token });
	if (!result || result.expired) {
		throw error(404, "Invalid or expired token");
	}
	if (result.token.type !== "quote") {
		throw error(400, "This token is not for a quote");
	}

	try {
		await convex.mutation(api.quotes.markAccepted, {
			quoteId: result.token.documentId as Id<"quotes">,
			siteUrl: result.token.siteUrl,
		});
		await convex.mutation(api.portal.markUsed, { token });
		return json({ success: true });
	} catch (err) {
		console.error("Failed to accept quote:", err);
		throw error(500, "Failed to accept quote");
	}
}
