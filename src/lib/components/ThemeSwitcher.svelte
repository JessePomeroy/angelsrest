<!--
  ThemeSwitcher Component
  
  A pill-shaped toggle for switching between light and dark themes.
  - Uses sun/moon icons from Lucide
  - Syncs with the isDark store for reactive updates across the app
  - Updates both the 'dark' class and 'data-theme' attribute on <html>
  - Light mode: pine theme | Dark mode: hamlindigo theme
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { SunIcon, MoonIcon } from "@lucide/svelte";
  import { isDark } from "$lib/stores/theme";

  // Apply theme on component mount
  onMount(() => {
    applyTheme($isDark);
  });

  /**
   * Apply the theme to the document
   * - Toggles 'dark' class on <html> for Tailwind dark mode
   * - Sets 'data-theme' attribute for Skeleton theme switching
   * - Saves preference to localStorage
   */
  function applyTheme(dark: boolean) {
    if (browser) {
      const html = document.documentElement;
      if (dark) {
        html.classList.add("dark");
        html.setAttribute("data-theme", "hamlindigo");
      } else {
        html.classList.remove("dark");
        html.setAttribute("data-theme", "pine");
      }
      localStorage.setItem("theme", dark ? "dark" : "light");
    }
  }

  // Theme setter functions - update store and apply
  function setLight() {
    isDark.setLight();
    applyTheme(false);
  }

  function setDark() {
    isDark.setDark();
    applyTheme(true);
  }
</script>

<!-- Pill container with theme-aware background -->
<div class="flex items-center bg-surface-200 dark:bg-surface-800 rounded-full p-0.5">
  <!-- Light mode button -->
  <button
    onclick={setLight}
    class="p-1.5 rounded-full transition-all duration-200 {!$isDark
      ? 'bg-white text-surface-900 shadow-sm'
      : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'}"
    aria-label="Light mode"
  >
    <SunIcon class="size-3" />
  </button>
  <!-- Dark mode button -->
  <button
    onclick={setDark}
    class="p-1.5 rounded-full transition-all duration-200 {$isDark
      ? 'bg-surface-900 text-surface-50 shadow-sm'
      : 'text-surface-500 hover:text-surface-700'}"
    aria-label="Dark mode"
  >
    <MoonIcon class="size-3" />
  </button>
</div>
