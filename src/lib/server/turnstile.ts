import { TURNSTILE_VERIFY_URL } from "$lib/config/turnstile";

const MAX_TURNSTILE_TOKEN_LENGTH = 2_048;

export type TurnstileVerification =
	| { success: true }
	| { success: false; reason: "missing" | "rejected" | "unavailable" };

interface VerifyTurnstileOptions {
	token: unknown;
	remoteIp?: string;
	fetchImpl?: typeof fetch;
}

export async function verifyTurnstileToken({
	token,
	remoteIp,
	fetchImpl = fetch,
}: VerifyTurnstileOptions): Promise<TurnstileVerification> {
	if (typeof token !== "string") {
		return { success: false, reason: "missing" };
	}
	const normalizedToken = token.trim();
	if (normalizedToken.length === 0) return { success: false, reason: "missing" };
	if (normalizedToken.length > MAX_TURNSTILE_TOKEN_LENGTH) {
		return { success: false, reason: "rejected" };
	}

	try {
		const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token: normalizedToken, remoteip: remoteIp }),
			signal: AbortSignal.timeout(5_000),
		});

		if (!response.ok) return { success: false, reason: "unavailable" };

		const result = (await response.json()) as { success?: boolean };
		return result.success === true ? { success: true } : { success: false, reason: "rejected" };
	} catch (error) {
		console.error("[turnstile] verification request failed", error);
		return { success: false, reason: "unavailable" };
	}
}
