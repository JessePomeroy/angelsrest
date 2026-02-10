import { writable } from 'svelte/store';
import { browser } from '$app/environment';

function createThemeStore() {
  // Default to dark
  let initial = true;
  
  if (browser) {
    const stored = localStorage.getItem('theme');
    if (stored) {
      initial = stored === 'dark';
    } else {
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

export const isDark = createThemeStore();
