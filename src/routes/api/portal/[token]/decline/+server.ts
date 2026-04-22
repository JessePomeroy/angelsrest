import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function POST({ params }) {
	const { token } = params;
	try {
		await convex.mutation(api.portal.declineQuote, { token });
		return json({ success: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to decline quote";
		if (
			message.includes("Invalid token") ||
			message.includes("expired") ||
			message.includes("already used")
		) {
			throw error(404, message);
		}
		if (message.includes("not for a")) {
			throw error(400, message);
		}
		console.error("Failed to decline quote:", err);
		throw error(500, "Failed to decline quote");
	}
}
