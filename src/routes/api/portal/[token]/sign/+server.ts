import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

export async function POST({ params, request }) {
	const { token } = params;
	const body = await request.json().catch(() => ({}));
	const signerName: string | undefined = body?.signerName;
	const signerEmail: string | undefined = body?.signerEmail;
	const signatureData: string | undefined = body?.signatureData;

	if (!signerName?.trim()) {
		throw error(400, "Signer name is required");
	}

	try {
		// Atomic: Convex-side validates token (exists, not expired, not used,
		// type=contract), records signerName/signerEmail/signatureData on the
		// contract, marks token used — all in one transaction.
		await convex.mutation(api.portal.signContract, {
			token,
			signerName: signerName.trim(),
			signerEmail: signerEmail?.trim() || undefined,
			signatureData: signatureData || undefined,
		});
		return json({ success: true });
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to sign contract";
		if (
			message.includes("Invalid token") ||
			message.includes("expired") ||
			message.includes("already used")
		) {
			throw error(404, message);
		}
		if (message.includes("not for a") || message.includes("required")) {
			throw error(400, message);
		}
		console.error("Failed to sign contract:", err);
		throw error(500, "Failed to sign contract");
	}
}
