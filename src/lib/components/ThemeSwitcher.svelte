<!--
  ThemeSwitcher Component
  
  Uses the site palette for both light and dark modes.
  The shared theme store owns DOM updates and persistence.
-->

<script lang="ts">
import { MoonIcon, SunIcon } from "@lucide/svelte";
import { isDark } from "$lib/stores/theme";
</script>

<div class="theme-switcher">
  <button
    onclick={isDark.setLight}
    aria-pressed={!$isDark}
    class="light-mode"
    aria-label="Light mode"
  >
    <SunIcon size="0.75rem" />
  </button>
  <button
    onclick={isDark.setDark}
    aria-pressed={$isDark}
    class="dark-mode"
    aria-label="Dark mode"
  >
    <MoonIcon size="0.75rem" />
  </button>
</div>

<style>
  .theme-switcher {
    display: flex;
    align-items: center;
    background: var(--color-surface-200);
    border-radius: 9999px;
    padding: 0.125rem;
  }
  button {
    padding: 0.375rem;
    border-radius: 9999px;
    color: var(--color-surface-500);
    transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  button[aria-pressed="true"] {
    box-shadow: 0 1px 3px rgb(0 0 0 / 10%), 0 1px 2px -1px rgb(0 0 0 / 10%);
  }
  .light-mode[aria-pressed="true"] {
    background: var(--color-surface-50);
    color: var(--color-surface-900);
  }
  .dark-mode[aria-pressed="true"] {
    background: var(--color-surface-900);
    color: var(--color-surface-50);
  }
  :global(.dark) .theme-switcher { background: var(--color-surface-700); }
  :global(.dark) .light-mode[aria-pressed="true"] { color: var(--color-surface-50); }
  @media (hover: hover) {
    button[aria-pressed="false"]:hover { color: var(--color-surface-600); }
  }
</style>
