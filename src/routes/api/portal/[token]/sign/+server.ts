import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { getConvex } from "$lib/server/convexClient";

const convex = getConvex();

const MAX_SIGNER_NAME_BYTES = 200;
const MAX_SIGNER_EMAIL_BYTES = 254;
const MAX_SIGNATURE_DATA_BYTES = 256 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8ByteLength(value: string) {
	return new TextEncoder().encode(value).byteLength;
}

function optionalString(value: unknown, label: string): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string") throw error(400, `${label} is invalid`);
	return value;
}

export async function POST({ params, request }) {
	const { token } = params;
	const parsedBody: unknown = await request.json().catch(() => ({}));
	if (!isRecord(parsedBody)) throw error(400, "Invalid request body");
	const signerName = optionalString(parsedBody.signerName, "Signer name");
	const signerEmail = optionalString(parsedBody.signerEmail, "Signer email");
	const signatureData = optionalString(parsedBody.signatureData, "Signature data");

	if (!signerName?.trim()) {
		throw error(400, "Signer name is required");
	}
	if (/\p{Cc}/u.test(signerName.trim())) {
		throw error(400, "Signer name contains invalid characters");
	}
	if (
		signerEmail !== undefined &&
		(/\s|\p{Cc}/u.test(signerEmail.trim()) || !/^[^@]+@[^@]+$/.test(signerEmail.trim()))
	) {
		throw error(400, "Signer email is invalid");
	}
	if (signatureData?.includes("\u0000")) {
		throw error(400, "Signature data contains invalid characters");
	}
	if (
		utf8ByteLength(signerName.trim()) > MAX_SIGNER_NAME_BYTES ||
		(signerEmail !== undefined && utf8ByteLength(signerEmail.trim()) > MAX_SIGNER_EMAIL_BYTES) ||
		(signatureData !== undefined && utf8ByteLength(signatureData.trim()) > MAX_SIGNATURE_DATA_BYTES)
	) {
		throw error(400, "Signature evidence is too long");
	}

	try {
		// Atomic: Convex-side validates the token and exact normalized replay,
		// records signer evidence, and marks the token used in one transaction.
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
		if (
			message.includes("not for a") ||
			message.includes("required") ||
			message.includes("is invalid") ||
			message.includes("is too long") ||
			message.includes("invalid characters")
		) {
			throw error(400, message);
		}
		if (message.includes("replay does not match")) {
			throw error(409, message);
		}
		console.error("Failed to sign contract:", err);
		throw error(500, "Failed to sign contract");
	}
}
