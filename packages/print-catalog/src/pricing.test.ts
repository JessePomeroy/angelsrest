import { describe, expect, it } from "vitest";
import { buildFramedMarginSummary, buildMarginSummary, computeFeeBreakdown } from "./pricing";

const feeConfig = {
	platformFeePct: 0.05,
	stripeFeePct: 0.029,
	stripeFeeFixedCents: 30,
};

describe("print pricing helpers", () => {
	it("computes Stripe, platform, and take-home fees", () => {
		const result = computeFeeBreakdown(100, 20, feeConfig);

		expect(result.stripeFee).toBeCloseTo(3.2);
		expect(result.platformFee).toBe(5);
		expect(result.takeHome).toBeCloseTo(71.8);
	});

	it("builds margin summaries for unset, loss, and profitable retail prices", () => {
		expect(buildMarginSummary({ retail: 0, wholesale: 20, feeConfig })).toBe(
			"Wholesale: $20.00 · set a retail price to see take-home.",
		);
		expect(buildMarginSummary({ retail: 15, wholesale: 20, feeConfig })).toBe(
			"Wholesale: $20.00 · LOSS: $5.00 per unit.",
		);
		expect(buildMarginSummary({ retail: 100, wholesale: 20, feeConfig })).toBe(
			"Wholesale: $20.00 · Stripe fee: $3.20 · Platform fee: $5.00 · Take-home: $71.80 (71.8%)",
		);
	});

	it("builds framed margin summaries", () => {
		expect(
			buildFramedMarginSummary({
				retail: 100,
				wholesale: 20,
				feeConfig,
				frameCost: 25,
				frameMarkupMultiplier: 2,
			}),
		).toBe(
			"Framed (0.875\"): retail $150.00 · wholesale $45.00 · Stripe $4.65 · Take-home: $92.85 (61.9%)",
		);
	});
});
