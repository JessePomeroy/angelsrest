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
        html.setAttribute("data-theme", "hamlindigo");
      } else {
        html.classList.remove("dark");
        html.setAttribute("data-theme", "pine");
      }
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

<div class="flex items-center bg-surface-200 dark:bg-surface-800 rounded-full p-0.5">
  <button
    onclick={setLight}
    class="p-1.5 rounded-full transition-all duration-200 {!$isDark
      ? 'bg-white text-surface-900 shadow-sm'
      : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200'}"
    aria-label="Light mode"
  >
    <SunIcon class="size-3" />
  </button>
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
