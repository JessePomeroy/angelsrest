import { v } from "convex/values";

export const FEE_CAPTURE_INITIAL_DELAY_MS = 15_000;
export const FEE_CAPTURE_RETRY_DELAY_MS = 60_000;
export const FEE_CAPTURE_MAX_ATTEMPTS = 3;

export type StripeFeeCaptureError =
	| "authority_configuration_invalid"
	| "balance_transaction_not_ready"
	| "stripe_api_error"
	| "stripe_secret_key_missing"
	| "payment_intent_missing";

export const stripeFeeCaptureErrorValidator = v.union(
	v.literal("authority_configuration_invalid"),
	v.literal("balance_transaction_not_ready"),
	v.literal("stripe_api_error"),
	v.literal("stripe_secret_key_missing"),
	v.literal("payment_intent_missing"),
);

export function getFeeCaptureRetryDelayMs(attempt: number): number | null {
	return attempt >= 1 && attempt < FEE_CAPTURE_MAX_ATTEMPTS
		? FEE_CAPTURE_RETRY_DELAY_MS
		: null;
}
