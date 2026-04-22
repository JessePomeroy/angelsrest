import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function POST({ params }) {
	const { token } = params;
	try {
		// Atomic: Convex-side validates token (exists, not expired, not used,
		// type=quote), patches quote to accepted, marks token used — all in
		// a single transaction. No split-brain if one half fails.
		await convex.mutation(api.portal.acceptQuote, { token });
		return json({ success: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to accept quote";
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
		console.error("Failed to accept quote:", err);
		throw error(500, "Failed to accept quote");
	}
}
