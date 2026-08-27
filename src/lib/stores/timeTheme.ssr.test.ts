import { describe, expect, it, vi } from "vitest";

vi.mock("$app/environment", () => ({ browser: false }));

import { getTimeTheme } from "./timeTheme.svelte";

describe("getTimeTheme during SSR", () => {
	it("returns the stable no-op server interface without scheduling work", async () => {
		vi.useFakeTimers();
		const theme = getTimeTheme();

		expect(getTimeTheme()).toBe(theme);
		expect(theme.period).toBe("afternoon");
		expect(vi.getTimerCount()).toBe(0);
		expect(() => theme.apply()).not.toThrow();
		expect(() => theme.destroy()).not.toThrow();
		expect(vi.getTimerCount()).toBe(0);

		vi.useRealTimers();
	});
});
