/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$app/environment", () => ({ browser: true }));

import { getTimeTheme } from "./timeTheme.svelte";

describe("getTimeTheme in the browser", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 7, 27, 6, 30));
	});

	afterEach(() => {
		document.documentElement.removeAttribute("data-time-period");
		vi.useRealTimers();
	});

	it("owns one reactive timer and applies its current period", async () => {
		const theme = getTimeTheme();

		expect(getTimeTheme()).toBe(theme);
		expect(theme.period).toBe("dawn");
		expect(vi.getTimerCount()).toBe(1);

		theme.apply();
		expect(document.documentElement.getAttribute("data-time-period")).toBe("dawn");

		vi.setSystemTime(new Date(2026, 7, 27, 9));
		await vi.advanceTimersByTimeAsync(60_000);
		expect(theme.period).toBe("morning");

		theme.apply();
		expect(document.documentElement.getAttribute("data-time-period")).toBe("morning");

		theme.destroy();
		expect(vi.getTimerCount()).toBe(0);
	});
});
