import { v } from "convex/values";

export const FEE_CAPTURE_INITIAL_DELAY_MS = 15_000;
export const FEE_CAPTURE_RETRY_DELAY_MS = 60_000;
export const FEE_CAPTURE_MAX_ATTEMPTS = 3;
export const FEE_CAPTURE_PROVENANCE_VERSION = 1;

export type StripeFeeCaptureError =
	| "authority_configuration_invalid"
	| "balance_transaction_not_ready"
	| "fee_breakdown_not_ready"
	| "stripe_api_error"
	| "stripe_secret_key_missing"
	| "payment_intent_missing"
	| "payment_not_ready"
	| "payment_projection_invalid"
	| "provider_object_mismatch";

export const stripeFeeCaptureErrorValidator = v.union(
	v.literal("authority_configuration_invalid"),
	v.literal("balance_transaction_not_ready"),
	v.literal("fee_breakdown_not_ready"),
	v.literal("stripe_api_error"),
	v.literal("stripe_secret_key_missing"),
	v.literal("payment_intent_missing"),
	v.literal("payment_not_ready"),
	v.literal("payment_projection_invalid"),
	v.literal("provider_object_mismatch"),
);

export function isNonnegativeSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isStripeCurrency(value: unknown): value is string {
	return typeof value === "string" && /^[a-z]{3}$/.test(value);
}

/** Match the hostname-only tenant marker stamped into signed Stripe metadata. */
export function normalizeCommerceTenantSiteUrl(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	try {
		const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
		const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
		return hostname || null;
	} catch {
		const normalized = trimmed
			.toLowerCase()
			.replace(/^www\./, "")
			.replace(/\/+$/, "");
		return normalized || null;
	}
}

const STRIPE_FEE_DETAIL_TYPES = new Set([
	"application_fee",
	"payment_method_passthrough_fee",
	"stripe_fee",
	"tax",
]);

/** Isolate Stripe's processing component from aggregate provider fee details. */
export function extractStripeProcessingFeeMinorUnits(value: {
	fee: unknown;
	currency: unknown;
	fee_details: unknown;
}): number | null {
	if (
		!isNonnegativeSafeInteger(value.fee)
		|| !isStripeCurrency(value.currency)
		|| !Array.isArray(value.fee_details)
	) return null;
	let aggregateMinorUnits = 0;
	let stripeProcessingMinorUnits = 0;
	for (const detail of value.fee_details) {
		if (
			typeof detail !== "object"
			|| detail === null
			|| !("amount" in detail)
			|| !("currency" in detail)
			|| !("type" in detail)
			|| !isNonnegativeSafeInteger(detail.amount)
			|| detail.currency !== value.currency
			|| typeof detail.type !== "string"
			|| !STRIPE_FEE_DETAIL_TYPES.has(detail.type)
		) return null;
		aggregateMinorUnits += detail.amount;
		if (!isNonnegativeSafeInteger(aggregateMinorUnits)) return null;
		if (detail.type === "stripe_fee") {
			stripeProcessingMinorUnits += detail.amount;
			if (!isNonnegativeSafeInteger(stripeProcessingMinorUnits)) return null;
		}
	}
	return aggregateMinorUnits === value.fee ? stripeProcessingMinorUnits : null;
}

export function getFeeCaptureRetryDelayMs(attempt: number): number | null {
	return attempt >= 1 && attempt < FEE_CAPTURE_MAX_ATTEMPTS
		? FEE_CAPTURE_RETRY_DELAY_MS
		: null;
}
