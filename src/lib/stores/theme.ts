/**
 * Theme Store
 * 
 * A Svelte store that manages the light/dark theme state.
 * - Persists user preference to localStorage
 * - Falls back to system preference (prefers-color-scheme)
 * - Provides reactive state for components that need to respond to theme changes
 */

import { writable } from 'svelte/store';
import { browser } from '$app/environment';

function createThemeStore() {
  // Default to dark mode
  let initial = true;
  
  // On client-side, check for saved preference or system preference
  if (browser) {
    const stored = localStorage.getItem('theme');
    if (stored) {
      // User has a saved preference
      initial = stored === 'dark';
    } else {
      // Fall back to system preference
      initial = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
  }

  const { subscribe, set } = writable(initial);

  return {
    subscribe,
    setDark: () => set(true),
    setLight: () => set(false),
    set
  };
}

// Export the store - true = dark mode, false = light mode
export const isDark = createThemeStore();
