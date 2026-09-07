<!--
  ThemeSwitcher Component
  
  Uses the site palette for both light and dark modes.
  The shared theme store owns DOM updates and persistence.
-->

<script lang="ts">
import { MoonIcon, SunIcon } from "@lucide/svelte";
import { isDark } from "$lib/stores/theme";
</script>

<!-- Site-owned surface colors -->
<div class="flex items-center bg-surface-200 dark:bg-surface-700 rounded-full p-0.5">
  <!-- Light mode button -->
  <button
    onclick={isDark.setLight}
    aria-pressed={!$isDark}
    class="p-1.5 rounded-full transition-all duration-200 {!$isDark
      ? 'bg-surface-50 text-surface-900 dark:text-surface-50 shadow-sm'
      : 'text-surface-500 hover:text-surface-600'}"
    aria-label="Light mode"
  >
    <SunIcon class="size-3" />
  </button>
  
  <!-- Dark mode button -->
  <button
    onclick={isDark.setDark}
    aria-pressed={$isDark}
    class="p-1.5 rounded-full transition-all duration-200 {$isDark
      ? 'bg-surface-900 text-surface-50 shadow-sm'
      : 'text-surface-500 hover:text-surface-600'}"
    aria-label="Dark mode"
  >
    <MoonIcon class="size-3" />
  </button>
</div>