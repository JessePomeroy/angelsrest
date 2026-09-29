import { describe, expect, it } from "vitest";
import { previewClientPrintRefund } from "./clientPrintRefunds";

const order = {
	lines: [
		{ kind: "print" as const, remainingCents: 500 },
		{ kind: "digital_download" as const, remainingCents: 200 },
	],
	otherRemainingCents: 100,
	printRefundedCents: 19,
	feeReturnedCents: 0,
};

describe("client print-refund preview", () => {
	it("uses cumulative print-only rounding and excludes other charges", () => {
		expect(previewClientPrintRefund(order, ["0.01", "1.00"], "0.50")).toEqual({
			valid: true,
			totalCents: 151,
			feeCents: 1,
		});
		expect(
			previewClientPrintRefund({ ...order, feeReturnedCents: 1 }, ["0.01", "0.00"], "0.00"),
		).toEqual({
			valid: true,
			totalCents: 1,
			feeCents: 0,
		});
	});

	it("rejects invalid or over-remaining allocations before enabling submission", () => {
		const invalidAllocations: Array<{ lines: string[]; other: string }> = [
			{ lines: ["0.001", "0.00"], other: "0.00" },
			{ lines: ["5.01", "0.00"], other: "0.00" },
			{ lines: ["0.00", "0.00"], other: "1.01" },
			{ lines: ["0.00"], other: "0.00" },
		];
		for (const { lines, other } of invalidAllocations) {
			expect(previewClientPrintRefund(order, lines, other).valid).toBe(false);
		}
	});
});
