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
		const clients = await convex.query(api.platform.listAll, {});
		const siteClient = clients.find(
			(c: { siteUrl: string }) => c.siteUrl === result.token.siteUrl,
		);
		if (siteClient) {
			businessName = siteClient.name;
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
