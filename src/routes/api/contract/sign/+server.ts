import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function POST({ request }) {
	try {
		const { contractId, signedByName, signedByEmail, signatureData } = await request.json();

		if (!contractId || !signedByName) {
			throw error(400, "Missing required fields");
		}

		// biome-ignore lint/suspicious/noExplicitAny: Convex Id type
		await convex.mutation(api.contracts.sign, {
			contractId: contractId as any,
			signedByName,
			signedByEmail: signedByEmail || undefined,
			signatureData: signatureData || undefined,
		});

		return json({ success: true });
	} catch (err) {
		if (err && typeof err === "object" && "status" in err) {
			throw err;
		}
		const message = err instanceof Error ? err.message : "Failed to sign contract";
		console.error("Contract sign error:", message);
		throw error(500, message);
	}
}
