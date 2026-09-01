import { describe, expect, it } from "vitest";
import {
	quoteAcceptanceIsOpen,
	quoteValidUntilExclusiveUtcMs,
} from "./quoteValidity";

describe("quote date-only validity", () => {
	it("uses the next UTC midnight as an exclusive boundary", () => {
		const boundary = Date.UTC(2026, 8, 2);
		expect(quoteValidUntilExclusiveUtcMs("2026-09-01")).toBe(boundary);
		expect(quoteAcceptanceIsOpen("2026-09-01", boundary - 1)).toBe(true);
		expect(quoteAcceptanceIsOpen("2026-09-01", boundary)).toBe(false);
	});

	it("handles leap dates and rejects malformed calendar values", () => {
		expect(quoteValidUntilExclusiveUtcMs("2028-02-29")).toBe(Date.UTC(2028, 2, 1));
		expect(quoteValidUntilExclusiveUtcMs("2027-02-29")).toBeNull();
		expect(quoteValidUntilExclusiveUtcMs("09/01/2026")).toBeNull();
		expect(quoteAcceptanceIsOpen("not-a-date", 0)).toBe(false);
		expect(quoteAcceptanceIsOpen(undefined, Number.MAX_SAFE_INTEGER)).toBe(true);
	});
});
