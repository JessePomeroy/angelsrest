import { describe, expect, it } from "vitest";
import { CatalogBoundaryError } from "../server/catalogCommerceClients";
import { FulfillmentValidationError } from "../server/fulfillmentValidationError";
import { LumaPrintsError, LumaPrintsSubmissionError } from "../server/lumaprints";
import {
	classifyLumaPrintsFailure,
	formatFailureForAdmin,
} from "../server/webhookErrorClassification";

describe("fulfillment error classification", () => {
	it("maps the submission subclass disposition instead of generic status or message heuristics", () => {
		expect(
			classifyLumaPrintsFailure(
				new LumaPrintsSubmissionError("provider", "definitely_rejected", {
					phase: "status",
					statusCode: 400,
				}),
			),
		).toBe("permanent");
		expect(
			classifyLumaPrintsFailure(
				new LumaPrintsSubmissionError("provider", "uncertain", {
					phase: "status",
					statusCode: 400,
				}),
			),
		).toBe("transient");
		for (const details of [
			{ statusCode: 400 },
			{ statusCode: 422, message: "invalid subcategory" },
			{ message: "bad request" },
		]) {
			expect(classifyLumaPrintsFailure(new LumaPrintsError("generic", details))).toBe("transient");
		}
	});

	it.each([
		["rejected", "permanent"],
		["unavailable", "transient"],
		["refunded", "refunded"],
	] as const)("preserves the redacted catalog %s outcome", (kind, expected) => {
		expect(classifyLumaPrintsFailure(new CatalogBoundaryError(kind))).toBe(expected);
	});

	it("keeps local validation permanent and unknown/network failures transient", () => {
		expect(classifyLumaPrintsFailure(new FulfillmentValidationError("invalid"))).toBe("permanent");
		const failures: unknown[] = [
			new Error("unknown"),
			new TypeError("fetch failed"),
			"thrown",
			42,
			null,
		];
		for (const failure of failures) expect(classifyLumaPrintsFailure(failure)).toBe("transient");
	});

	it("returns only bounded summaries without provider bodies or source URLs", () => {
		const secret = "https://opaque.example/private?token=secret";
		const summaries = [
			formatFailureForAdmin(
				new LumaPrintsSubmissionError("raw", "definitely_rejected", {
					phase: "status",
					statusCode: 400,
				}),
			),
			formatFailureForAdmin(new LumaPrintsError(secret)),
			formatFailureForAdmin(new CatalogBoundaryError("rejected")),
			formatFailureForAdmin(new TypeError(secret)),
		];
		expect(summaries).toEqual([
			"Print provider rejected fulfillment",
			"Print provider temporarily unavailable",
			"Fulfillment validation rejected",
			"Print fulfillment unavailable",
		]);
		for (const value of summaries) {
			expect(value).not.toContain("opaque.example");
			expect(value.length).toBeLessThan(64);
		}
	});
});
