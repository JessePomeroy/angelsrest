/**
 * Time-Aware Theme Store (Svelte 5 Runes)
 *
 * Detects the current time period and provides reactive state for
 * time-based theming. Works alongside light/dark mode.
 *
 * Periods:
 * - dawn (5-8): warm pinks, soft oranges
 * - morning (8-12): bright, clear
 * - afternoon (12-17): neutral, balanced
 * - golden (17-20): warm amber tones
 * - evening (20-22): deep purple/blue
 * - night (22-5): cool, muted
 */

import { browser } from "$app/environment";

export type TimePeriod = "dawn" | "morning" | "afternoon" | "golden" | "evening" | "night";

function getTimePeriod(hour: number): TimePeriod {
	if (hour >= 5 && hour < 8) return "dawn";
	if (hour >= 8 && hour < 12) return "morning";
	if (hour >= 12 && hour < 17) return "afternoon";
	if (hour >= 17 && hour < 20) return "golden";
	if (hour >= 20 && hour < 22) return "evening";
	return "night";
}

class TimeTheme {
	#hour = $state(browser ? new Date().getHours() : 12);
	#intervalId: ReturnType<typeof setInterval> | null = null;

	period = $derived<TimePeriod>(getTimePeriod(this.#hour));

	constructor() {
		if (browser) {
			// Update every minute to catch hour changes
			this.#intervalId = setInterval(() => {
				this.#hour = new Date().getHours();
			}, 60_000);
		}
	}

	/** Apply the time period to the document */
	apply() {
		if (browser) {
			document.documentElement.setAttribute("data-time-period", this.period);
		}
	}

	/** Clean up interval (call in onDestroy if needed) */
	destroy() {
		if (this.#intervalId) {
			clearInterval(this.#intervalId);
			this.#intervalId = null;
		}
	}
}

// Audit M18: lazy client-only singleton.
//
// A module-top `new TimeTheme()` is risky in SvelteKit SSR because the
// underlying `$state` cell is shared across all concurrent server
// requests. This particular class only *mutates* its state inside a
// `browser`-guarded setInterval, so the server instance never changes
// in practice — but the shape of the pattern is still load-bearing, and
// a future edit that sets `#hour` from a load function would silently
// corrupt state across requests.
//
// Defer instantiation to first access. On SSR we return a frozen stub
// with the public readable surface only (period, apply, destroy); the
// proxy falls through to the real instance once we're in the browser.
interface TimeThemePublic {
	readonly period: TimePeriod;
	apply(): void;
	destroy(): void;
}

const SSR_TIME_THEME_STUB: TimeThemePublic = {
	period: "afternoon",
	apply: () => {},
	destroy: () => {},
};

let _timeTheme: TimeTheme | null = null;
export function getTimeTheme(): TimeThemePublic {
	if (!browser) return SSR_TIME_THEME_STUB;
	if (!_timeTheme) _timeTheme = new TimeTheme();
	return _timeTheme;
}

/** @deprecated Kept for backward compat — prefer `getTimeTheme()`. */
export const timeTheme: TimeThemePublic = new Proxy(SSR_TIME_THEME_STUB, {
	get(_target, prop: keyof TimeThemePublic) {
		const instance = getTimeTheme();
		return instance[prop];
	},
});

/** Get time period for a given hour (useful for testing/preview) */
export function getTimePeriodForHour(hour: number): TimePeriod {
	return getTimePeriod(hour);
}
