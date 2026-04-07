import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function POST({ params, request }) {
	const { token } = params;

	const result = await convex.query(api.portal.getByToken, { token });
	if (!result || result.expired) {
		throw error(404, "Invalid or expired token");
	}
	if (result.token.type !== "contract") {
		throw error(400, "This token is not for a contract");
	}

	const body = await request.json();
	if (!body.signerName?.trim()) {
		throw error(400, "Signer name is required");
	}

	try {
		await convex.mutation(api.contracts.markSigned, {
			contractId: result.token.documentId as Id<"contracts">,
			siteUrl: result.token.siteUrl,
		});
		await convex.mutation(api.portal.markUsed, { token });
		return json({ success: true });
	} catch (err) {
		console.error("Failed to sign contract:", err);
		throw error(500, "Failed to sign contract");
	}
}
