import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_ON_DEMAND_ZIP_BYTES } from "./downloadPolicy";

describe("gallery download policy", () => {
	it("keeps the client-side on-demand ZIP cap aligned with the Worker default", () => {
		expect(DEFAULT_MAX_ON_DEMAND_ZIP_BYTES).toBe(1024 * 1024 * 1024);
	});
});
