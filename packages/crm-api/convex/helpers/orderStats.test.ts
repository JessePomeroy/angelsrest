import { describe, expect, it } from "vitest";
import { resolveBoundedOrderStatsScan } from "./orderStats";

describe("resolveBoundedOrderStatsScan", () => {
	it("reports a complete result when the sentinel row is absent", () => {
		expect(resolveBoundedOrderStatsScan(["newest", "older"], 2)).toEqual({
			orders: ["newest", "older"],
			isTruncated: false,
		});
	});

	it("removes the sentinel row and reports a partial result", () => {
		expect(resolveBoundedOrderStatsScan(["newest", "older", "sentinel"], 2)).toEqual({
			orders: ["newest", "older"],
			isTruncated: true,
		});
	});

	it("rejects invalid limits", () => {
		expect(() => resolveBoundedOrderStatsScan([], 0)).toThrow(
			"Order stats scan limit must be a positive integer",
		);
	});
});
