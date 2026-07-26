import { error, type HttpError } from "@sveltejs/kit";

export interface ApiErrorBody {
	code: string;
	message: string;
	details?: Record<string, unknown>;
}

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
	CHECKOUT_ATTEMPT_REQUIRED: "CHECKOUT_ATTEMPT_REQUIRED",
	CHECKOUT_ATTEMPT_REJECTED: "CHECKOUT_ATTEMPT_REJECTED",
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
