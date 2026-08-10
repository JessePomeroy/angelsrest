export interface CheckoutAttempt {
	attempt: string;
	attemptStartedAt: number;
	attemptProof: string;
}

const MAX_LOCAL_AGE_MS = (23 * 60 + 25) * 60 * 1000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const CHECKOUT_ATTEMPT_REQUIRED = "CHECKOUT_ATTEMPT_REQUIRED";

export class CheckoutAttemptTracker {
	#current: (CheckoutAttempt & { intent: string; retainedAt: number }) | null = null;

	constructor(private readonly now = () => Date.now()) {}

	forIntent(intent: unknown, challenge: CheckoutAttempt): CheckoutAttempt {
		const serialized = JSON.stringify(intent);
		const now = this.now();
		if (
			!this.#current ||
			this.#current.intent !== serialized ||
			now - this.#current.retainedAt >= MAX_LOCAL_AGE_MS
		) {
			if (
				!UUID_V4.test(challenge.attempt) ||
				!Number.isSafeInteger(challenge.attemptStartedAt) ||
				!/^[0-9a-f]{64}$/.test(challenge.attemptProof)
			) {
				throw new Error("checkout failed");
			}
			this.#current = { ...challenge, intent: serialized, retainedAt: now };
		}
		return {
			attempt: this.#current.attempt,
			attemptStartedAt: this.#current.attemptStartedAt,
			attemptProof: this.#current.attemptProof,
		};
	}

	discard(attempt: string) {
		if (this.#current?.attempt === attempt) this.#current = null;
	}
}

export function checkoutAttemptResponse(result: unknown) {
	if (!result || typeof result !== "object" || Array.isArray(result)) return null;
	const record = result as Record<string, unknown>;
	const body =
		typeof record.code === "string"
			? record
			: record.message && typeof record.message === "object" && !Array.isArray(record.message)
				? (record.message as Record<string, unknown>)
				: null;
	if (!body || typeof body.code !== "string") return null;
	const details = body.details;
	let attempt: CheckoutAttempt | null = null;
	if (
		body.code === CHECKOUT_ATTEMPT_REQUIRED &&
		details &&
		typeof details === "object" &&
		!Array.isArray(details)
	) {
		const candidate = details as Record<string, unknown>;
		if (
			typeof candidate.attempt === "string" &&
			typeof candidate.attemptStartedAt === "number" &&
			typeof candidate.attemptProof === "string"
		) {
			attempt = {
				attempt: candidate.attempt,
				attemptStartedAt: candidate.attemptStartedAt,
				attemptProof: candidate.attemptProof,
			};
		}
	}
	return { code: body.code, attempt };
}

export async function postCheckoutWithChallenge(
	path: string,
	payload: Record<string, unknown>,
	intent: unknown,
	tracker: CheckoutAttemptTracker,
) {
	const send = (body: object) =>
		fetch(path, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	let response = await send(payload);
	let result = (await response.json()) as Record<string, unknown>;
	const challenge = checkoutAttemptResponse(result);
	let attempt: CheckoutAttempt | null = null;
	if (challenge?.code === CHECKOUT_ATTEMPT_REQUIRED && challenge.attempt) {
		attempt = tracker.forIntent(intent, challenge.attempt);
		response = await send({ ...payload, ...attempt });
		result = (await response.json()) as Record<string, unknown>;
	}
	if (
		attempt &&
		(typeof result.url === "string" || (response.status >= 400 && response.status < 500))
	) {
		tracker.discard(attempt.attempt);
	}
	return result;
}

export function checkoutError(result: Record<string, unknown>, fallback: string) {
	if (typeof result.error === "string") return result.error;
	if (typeof result.message === "string") return result.message;
	if (result.message && typeof result.message === "object") {
		const message = (result.message as Record<string, unknown>).message;
		if (typeof message === "string") return message;
	}
	return fallback;
}

export function checkoutTenantIntent() {
	return typeof location === "undefined" ? "same-origin" : location.origin;
}
