import { describe, expect, test } from "vitest";
import {
	FEE_CAPTURE_INITIAL_DELAY_MS,
	FEE_CAPTURE_MAX_ATTEMPTS,
	FEE_CAPTURE_RETRY_DELAY_MS,
	getFeeCaptureRetryDelayMs,
} from "./stripeFeeCapture";

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
});
