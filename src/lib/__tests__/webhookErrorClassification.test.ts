import { describe, expect, it } from "vitest";
import { CatalogBoundaryError } from "../server/catalogCommerceClients";
import { FulfillmentValidationError } from "../server/fulfillmentValidationError";
import { LumaPrintsError } from "../server/lumaprints";
import {
	classifyLumaPrintsFailure,
	formatFailureForAdmin,
} from "../server/webhookErrorClassification";

describe("fulfillment error classification", () => {
	it.each([
		[400, "permanent"],
		[401, "permanent"],
		[422, "permanent"],
		[500, "transient"],
		[503, "transient"],
	] as const)("classifies provider status %s as %s", (statusCode, expected) => {
		expect(classifyLumaPrintsFailure(new LumaPrintsError("provider", { statusCode }))).toBe(
			expected,
		);
	});

	it("recognizes only provider-specific validation messages", () => {
		for (const message of [
			"Invalid subcategoryId for orderItems[0]",
			"width must be a positive number",
			"aspect ratio out of range",
			"resolution too low for print size",
			["orderItems.0.width must be positive", "recipient.zipCode is required"],
		]) {
			expect(classifyLumaPrintsFailure(new LumaPrintsError("validation", { message }))).toBe(
				"permanent",
			);
		}
		expect(
			classifyLumaPrintsFailure(
				new LumaPrintsError("unknown", { message: "something weird happened" }),
			),
		).toBe("transient");
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
			formatFailureForAdmin(new LumaPrintsError("raw", { statusCode: 400, message: secret })),
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
