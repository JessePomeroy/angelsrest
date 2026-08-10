import { describe, expect, test } from "vitest";
import {
	FEE_CAPTURE_INITIAL_DELAY_MS,
	FEE_CAPTURE_MAX_ATTEMPTS,
	FEE_CAPTURE_RETRY_DELAY_MS,
	extractStripeProcessingFeeMinorUnits,
	getFeeCaptureRetryDelayMs,
	isNonnegativeSafeInteger,
	isStripeCurrency,
	normalizeCommerceTenantSiteUrl,
} from "./stripeFeeCapture";

describe("Stripe fee capture tenant binding", () => {
	test("normalizes equivalent signed tenant site markers", () => {
		expect(normalizeCommerceTenantSiteUrl("https://WWW.Tenant.Example/path/"))
			.toBe("tenant.example");
		expect(normalizeCommerceTenantSiteUrl("tenant.example/"))
			.toBe("tenant.example");
		expect(normalizeCommerceTenantSiteUrl("  ")).toBeNull();
	});
});

describe("Stripe fee capture retry policy", () => {
	test("keeps the initial Stripe read off the webhook hot path", () => {
		expect(FEE_CAPTURE_INITIAL_DELAY_MS).toBe(15_000);
	});

	test("retries attempts one and two after the configured delay", () => {
		expect(FEE_CAPTURE_RETRY_DELAY_MS).toBe(60_000);
		expect(getFeeCaptureRetryDelayMs(1)).toBe(60_000);
		expect(getFeeCaptureRetryDelayMs(2)).toBe(60_000);
	});

	test("makes the third attempt terminal", () => {
		expect(FEE_CAPTURE_MAX_ATTEMPTS).toBe(3);
		expect(getFeeCaptureRetryDelayMs(3)).toBeNull();
		expect(getFeeCaptureRetryDelayMs(4)).toBeNull();
	});

	test("isolates Stripe processing fees from application and other fee details", () => {
		expect(extractStripeProcessingFeeMinorUnits({
			fee: 850,
			currency: "usd",
			fee_details: [
				{ type: "stripe_fee", amount: 321, currency: "usd" },
				{ type: "application_fee", amount: 500, currency: "usd" },
				{ type: "payment_method_passthrough_fee", amount: 20, currency: "usd" },
				{ type: "tax", amount: 9, currency: "usd" },
			],
		})).toBe(321);
	});

	test("accepts an authoritative zero-fee breakdown", () => {
		expect(extractStripeProcessingFeeMinorUnits({
			fee: 0,
			currency: "usd",
			fee_details: [],
		})).toBe(0);
	});

	test.each([
		{
			fee: 321, currency: "usd",
			fee_details: [{ type: "stripe_fee", amount: 320, currency: "usd" }],
		},
		{
			fee: 321, currency: "usd",
			fee_details: [{ type: "stripe_fee", amount: 321, currency: "eur" }],
		},
		{
			fee: 321, currency: "usd",
			fee_details: [{ type: "unknown", amount: 321, currency: "usd" }],
		},
	])("rejects an incomplete or malformed provider fee breakdown", (value) => {
		expect(extractStripeProcessingFeeMinorUnits(value)).toBeNull();
	});
});

describe("Stripe fee capture value validation", () => {
	test("accepts zero and nonnegative safe-integer minor units", () => {
		expect(isNonnegativeSafeInteger(0)).toBe(true);
		expect(isNonnegativeSafeInteger(Number.MAX_SAFE_INTEGER)).toBe(true);
	});

	test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
		"rejects unsafe fee value %s",
		(value) => expect(isNonnegativeSafeInteger(value)).toBe(false),
	);

	test("accepts only normalized three-letter Stripe currencies", () => {
		expect(isStripeCurrency("usd")).toBe(true);
		expect(isStripeCurrency("USD")).toBe(false);
		expect(isStripeCurrency("us")).toBe(false);
	});
});
