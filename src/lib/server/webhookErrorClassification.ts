/**
 * Classifies webhook fulfillment errors as **permanent** (refund the
 * customer, mark the order fulfillment_error, do NOT retry) vs
 * **transient** (let the webhook throw so Stripe retries with backoff).
 *
 * This is the core decision for the 3-signal fallback path added in
 * audit #23 PR #3:
 *   - permanent  → auto-refund + admin email + fulfillment_error status
 *   - transient  → re-throw + Stripe retries (audit #1 behavior preserved)
 *
 * The classification is conservative: we only mark errors as permanent
 * when we have strong evidence that retrying won't help (4xx response
 * codes, validation failures, malformed payload rejections). Unknown
 * errors default to transient, because retrying at worst wastes compute
 * and at best recovers from a flaky API.
 */

import { LumaPrintsError } from "./lumaprints";

export type FailureClassification = "permanent" | "transient";

/**
 * Classify an arbitrary error thrown during LumaPrints submission.
 * Handles `LumaPrintsError` with HTTP-status-bearing details, generic
 * `Error` instances, and unknown thrown values.
 */
export function classifyLumaPrintsFailure(err: unknown): FailureClassification {
	if (err instanceof LumaPrintsError) {
		return classifyLumaPrintsErrorDetails(err.details);
	}

	if (err instanceof Error) {
		// Node's fetch throws AbortError / TypeError for network-layer issues.
		// These are always transient.
		const name = err.name;
		if (name === "AbortError" || name === "TimeoutError" || name === "TypeError") {
			return "transient";
		}
		// Any other generic Error — unknown cause, default to transient so we
		// don't refund customers based on bugs in our own error surfacing.
		return "transient";
	}

	return "transient";
}

/**
 * LumaPrints error details are loosely-typed JSON from the API response.
 * We look for HTTP status codes and specific error messages that indicate
 * permanent failures. Everything else is transient.
 */
function classifyLumaPrintsErrorDetails(details: unknown): FailureClassification {
	if (!details || typeof details !== "object") {
		return "transient";
	}

	const obj = details as Record<string, unknown>;

	// Explicit HTTP status code on the details object (if we ever attach one)
	if (typeof obj.statusCode === "number") {
		// 4xx = client error = the request itself is bad, retrying won't help
		if (obj.statusCode >= 400 && obj.statusCode < 500) {
			return "permanent";
		}
		// 5xx = server error = transient, retry with backoff
		return "transient";
	}

	// LumaPrints validation-error message patterns are permanent.
	// These are messages the API returns when the payload itself is invalid
	// (bad subcategory ID, bad dimensions, rejected image, etc.)
	const message = extractMessageString(obj);
	if (message) {
		const lower = message.toLowerCase();
		const permanentPatterns = [
			"invalid",
			"not found",
			"must be",
			"required",
			"out of range",
			"not supported",
			"bad request",
			"unauthorized",
			"forbidden",
			"unprocessable",
			"aspect ratio",
			"resolution",
			"subcategory",
		];
		if (permanentPatterns.some((pattern) => lower.includes(pattern))) {
			return "permanent";
		}
	}

	return "transient";
}

/**
 * LumaPrints sometimes returns `message` as a string, sometimes as an
 * array of strings (for validation errors with multiple fields). Handle
 * both.
 */
function extractMessageString(obj: Record<string, unknown>): string | null {
	if (typeof obj.message === "string") return obj.message;
	if (Array.isArray(obj.message)) {
		return obj.message.filter((m): m is string => typeof m === "string").join("; ");
	}
	return null;
}

/**
 * Format a human-readable summary of the error for admin notification
 * emails and error logs. Never includes raw payload to avoid leaking PII.
 */
export function formatFailureForAdmin(err: unknown): string {
	if (err instanceof LumaPrintsError) {
		const message = err.message;
		const detailsStr = err.details ? `\nDetails: ${JSON.stringify(err.details).slice(0, 500)}` : "";
		return `${message}${detailsStr}`;
	}
	if (err instanceof Error) {
		return `${err.name}: ${err.message}`;
	}
	return String(err).slice(0, 500);
}
