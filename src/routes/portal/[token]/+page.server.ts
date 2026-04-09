import { error } from "@sveltejs/kit";
import { api } from "$convex/api";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function load({ params }) {
	const { token } = params;

	const result = await convex.query(api.portal.getByToken, { token });

	if (!result) {
		throw error(404, "This link is not valid or has expired.");
	}

	if (result.expired) {
		throw error(410, "This link has expired.");
	}

	// Get the platform client name for display
	let businessName = result.token.siteUrl;
	try {
		const tierResult = await convex.query(api.platform.checkTier, {
			siteUrl: result.token.siteUrl,
		});
		if (tierResult.siteName) {
			businessName = tierResult.siteName;
		}
	} catch {
		// Fallback to siteUrl
	}

	return {
		token,
		type: result.token.type,
		document: result.document,
		client: result.client,
		used: result.token.used,
		businessName,
		siteUrl: result.token.siteUrl,
	};
}
