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

import { browser } from '$app/environment';

export type TimePeriod = 'dawn' | 'morning' | 'afternoon' | 'golden' | 'evening' | 'night';

function getTimePeriod(hour: number): TimePeriod {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 20) return 'golden';
  if (hour >= 20 && hour < 22) return 'evening';
  return 'night';
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
      document.documentElement.setAttribute('data-time-period', this.period);
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

// Singleton instance
export const timeTheme = new TimeTheme();

/** Get time period for a given hour (useful for testing/preview) */
export function getTimePeriodForHour(hour: number): TimePeriod {
  return getTimePeriod(hour);
}
