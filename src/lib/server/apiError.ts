/**
 * Standardized API error helper (audit M8).
 *
 * Before this: every API route threw `error(400, "some string")` so
 * clients had to parse the message text to branch on what went wrong.
 * After this: `apiError(400, "INVALID_COUPON", "Coupon exceeds price")`
 * produces an error body `{ code, message }` that clients can branch on
 * stably (the `code` part) while still rendering a human-readable
 * `message`.
 *
 * The SvelteKit runtime accepts an object body on `error()` — the shape
 * is just re-JSON'd into the response. The `status` still drives the
 * HTTP status code.
 *
 * Migration plan: this helper is adopted incrementally. New routes
 * should use `apiError`; existing routes can be migrated as they're
 * touched. Both shapes (string body + {code, message} body) work in
 * the client; callers that care about branching can check for `.code`
 * before falling back to message parsing.
 */

import { error, type HttpError } from "@sveltejs/kit";

export interface ApiErrorBody {
	code: string;
	message: string;
	/** Optional structured payload for the client (e.g., retryAfter, fieldErrors). */
	details?: Record<string, unknown>;
}

/**
 * Throw a SvelteKit error with a standardized JSON body. The status
 * code drives the HTTP response; `code` is a stable machine-readable
 * identifier; `message` is the human-readable explanation.
 *
 * Example:
 *   throw apiError(400, "INVALID_COUPON", "Coupon exceeds item price");
 */
export function apiError(
	status: number,
	code: string,
	message: string,
	details?: Record<string, unknown>,
): HttpError {
	const body: ApiErrorBody = { code, message };
	if (details) body.details = details;
	return error(status, body);
}

/**
 * Common error codes used across the API. Keep these stable — client
 * code branches on them. If you need to change the meaning, introduce
 * a new code rather than repurposing an existing one.
 */
export const ApiErrorCode = {
	// 400-range
	MISSING_FIELD: "MISSING_FIELD",
	INVALID_INPUT: "INVALID_INPUT",
	INVALID_COUPON: "INVALID_COUPON",
	INVALID_EMAIL: "INVALID_EMAIL",
	INVALID_SESSION: "INVALID_SESSION",
	INVALID_PAPER_CONFIG: "INVALID_PAPER_CONFIG",
	PAYMENT_INCOMPLETE: "PAYMENT_INCOMPLETE",
	FILE_TOO_LARGE: "FILE_TOO_LARGE",
	UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
	// 401 / 403
	UNAUTHORIZED: "UNAUTHORIZED",
	FORBIDDEN: "FORBIDDEN",
	SESSION_EXPIRED: "SESSION_EXPIRED",
	// 404
	NOT_FOUND: "NOT_FOUND",
	// 409
	CONFLICT: "CONFLICT",
	// 413 / 415
	PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
	UNSUPPORTED_CONTENT: "UNSUPPORTED_CONTENT",
	// 500-range
	UPSTREAM_FAILED: "UPSTREAM_FAILED",
	NOT_CONFIGURED: "NOT_CONFIGURED",
	INTERNAL: "INTERNAL",
	// 503
	UNAVAILABLE: "UNAVAILABLE",
} as const;
export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];
