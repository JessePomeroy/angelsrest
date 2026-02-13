<!--
  ThemeSwitcher Component
  
  Clean implementation using hamlindigo theme for both light and dark modes.
  Only toggles the 'dark' class on <html> element.
-->

<script lang="ts">
  import { onMount } from "svelte";
  import { browser } from "$app/environment";
  import { SunIcon, MoonIcon } from "@lucide/svelte";
  import { isDark } from "$lib/stores/theme";

  onMount(() => {
    applyTheme($isDark);
  });

  function applyTheme(dark: boolean) {
    if (browser) {
      const html = document.documentElement;
      if (dark) {
        html.classList.add("dark");
      } else {
        html.classList.remove("dark");
      }
      // Always hamlindigo
      html.setAttribute("data-theme", "hamlindigo");
      localStorage.setItem("theme", dark ? "dark" : "light");
    }
  }

  function setLight() {
    isDark.setLight();
    applyTheme(false);
  }

  function setDark() {
    isDark.setDark();
    applyTheme(true);
  }
</script>

<!-- Use proper Skeleton design tokens -->
<div class="flex items-center bg-surface-200-700-token rounded-full p-0.5">
  <!-- Light mode button -->
  <button
    onclick={setLight}
    class="p-1.5 rounded-full transition-all duration-200 {!$isDark
      ? 'bg-surface-50 text-surface-900-50-token shadow-sm'
      : 'text-surface-500 hover:text-surface-600'}"
    aria-label="Light mode"
  >
    <SunIcon class="size-3" />
  </button>
  
  <!-- Dark mode button -->
  <button
    onclick={setDark}
    class="p-1.5 rounded-full transition-all duration-200 {$isDark
      ? 'bg-surface-900 text-surface-50 shadow-sm'
      : 'text-surface-500 hover:text-surface-600'}"
    aria-label="Dark mode"
  >
    <MoonIcon class="size-3" />
  </button>
</div>