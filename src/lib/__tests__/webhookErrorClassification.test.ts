import { describe, expect, it } from "vitest";
import { LumaPrintsError } from "../server/lumaprints";
import {
	classifyLumaPrintsFailure,
	formatFailureForAdmin,
} from "../server/webhookErrorClassification";

// Audit #23 PR #3 — error classification for the webhook's permanent
// vs transient fallback path.

describe("classifyLumaPrintsFailure", () => {
	describe("LumaPrintsError", () => {
		it("classifies 4xx status codes as permanent", () => {
			const err = new LumaPrintsError("bad request", { statusCode: 400 });
			expect(classifyLumaPrintsFailure(err)).toBe("permanent");
		});

		it("classifies 401 as permanent", () => {
			const err = new LumaPrintsError("unauthorized", { statusCode: 401 });
			expect(classifyLumaPrintsFailure(err)).toBe("permanent");
		});

		it("classifies 422 as permanent", () => {
			const err = new LumaPrintsError("unprocessable", {
				statusCode: 422,
			});
			expect(classifyLumaPrintsFailure(err)).toBe("permanent");
		});

		it("classifies 5xx status codes as transient", () => {
			const err = new LumaPrintsError("server error", { statusCode: 500 });
			expect(classifyLumaPrintsFailure(err)).toBe("transient");
		});

		it("classifies 503 as transient", () => {
			const err = new LumaPrintsError("service unavailable", {
				statusCode: 503,
			});
			expect(classifyLumaPrintsFailure(err)).toBe("transient");
		});

		it("classifies validation-error message patterns as permanent even without status code", () => {
			const permanentMessages = [
				"Invalid subcategoryId for orderItems[0]",
				"width must be a positive number",
				"aspect ratio out of range",
				"resolution too low for print size",
				"subcategory 103099 not supported",
			];
			for (const message of permanentMessages) {
				const err = new LumaPrintsError("validation error", { message });
				expect(classifyLumaPrintsFailure(err)).toBe("permanent");
			}
		});

		it("classifies array-form validation messages as permanent", () => {
			const err = new LumaPrintsError("validation error", {
				message: ["orderItems.0.width must be a positive number", "recipient.zipCode is required"],
			});
			expect(classifyLumaPrintsFailure(err)).toBe("permanent");
		});

		it("defaults unknown LumaPrints errors to transient", () => {
			const err = new LumaPrintsError("mystery error", {
				message: "something weird happened",
			});
			expect(classifyLumaPrintsFailure(err)).toBe("transient");
		});

		it("handles LumaPrintsError with no details object", () => {
			const err = new LumaPrintsError("plain error");
			expect(classifyLumaPrintsFailure(err)).toBe("transient");
		});
	});

	describe("network / node errors", () => {
		it("classifies AbortError as transient", () => {
			const err = new Error("aborted");
			err.name = "AbortError";
			expect(classifyLumaPrintsFailure(err)).toBe("transient");
		});

		it("classifies TypeError (fetch network failures) as transient", () => {
			const err = new TypeError("fetch failed");
			expect(classifyLumaPrintsFailure(err)).toBe("transient");
		});

		it("classifies TimeoutError as transient", () => {
			const err = new Error("timed out");
			err.name = "TimeoutError";
			expect(classifyLumaPrintsFailure(err)).toBe("transient");
		});

		it("defaults generic Error instances to transient", () => {
			expect(classifyLumaPrintsFailure(new Error("mystery"))).toBe("transient");
		});

		it("handles non-Error thrown values as transient", () => {
			expect(classifyLumaPrintsFailure("string thrown")).toBe("transient");
			expect(classifyLumaPrintsFailure(42)).toBe("transient");
			expect(classifyLumaPrintsFailure(null)).toBe("transient");
			expect(classifyLumaPrintsFailure(undefined)).toBe("transient");
		});
	});
});

describe("formatFailureForAdmin", () => {
	it("includes LumaPrintsError details", () => {
		const err = new LumaPrintsError("Order submission failed", {
			statusCode: 400,
			message: "Invalid subcategoryId",
		});
		const formatted = formatFailureForAdmin(err);
		expect(formatted).toContain("Order submission failed");
		expect(formatted).toContain("Invalid subcategoryId");
		expect(formatted).toContain("400");
	});

	it("handles LumaPrintsError with no details", () => {
		const err = new LumaPrintsError("plain error");
		expect(formatFailureForAdmin(err)).toBe("plain error");
	});

	it("formats generic Error with name and message", () => {
		const err = new TypeError("fetch failed");
		expect(formatFailureForAdmin(err)).toBe("TypeError: fetch failed");
	});

	it("stringifies non-Error values", () => {
		expect(formatFailureForAdmin("boom")).toBe("boom");
		expect(formatFailureForAdmin(42)).toBe("42");
	});

	it("truncates very long error messages", () => {
		const longString = "x".repeat(1000);
		const formatted = formatFailureForAdmin(longString);
		expect(formatted.length).toBeLessThanOrEqual(500);
	});
});
