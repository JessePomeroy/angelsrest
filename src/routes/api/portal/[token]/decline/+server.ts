import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { getConvex } from "$lib/server/convexClient";
import { validatePortalToken } from "$lib/server/portalToken";

const convex = getConvex();

export async function POST({ params }) {
	const { token } = params;

	const result = await validatePortalToken(convex, token, "quote");

	try {
		await convex.mutation(api.quotes.markDeclined, {
			quoteId: result.token.documentId as Id<"quotes">,
			siteUrl: result.token.siteUrl,
		});
		await convex.mutation(api.portal.markUsed, { token });
		return json({ success: true });
	} catch (err) {
		console.error("Failed to decline quote:", err);
		throw error(500, "Failed to decline quote");
	}
}
