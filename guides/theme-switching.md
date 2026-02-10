# Theme Switching Guide

This guide explains how the light/dark theme switching works in the Angel's Rest website.

---

## Overview

The site supports two themes:
- **Dark mode** → Skeleton's `hamlindigo` theme
- **Light mode** → Skeleton's `pine` theme (with font overrides to match hamlindigo)

The theme switcher is a pill-shaped toggle with sun/moon icons. It appears:
- **Desktop**: In the top navigation bar (all pages)
- **Mobile**: Fixed position above the bottom nav (homepage only)

---

## How It Works

### 1. Theme Store (`src/lib/stores/theme.ts`)

A Svelte store that holds the current theme state (`true` = dark, `false` = light).

```typescript
import { isDark } from '$lib/stores/theme';

// Read the current theme
$isDark // true or false

// Set the theme
isDark.setDark();
isDark.setLight();
```

The store initializes by checking:
1. `localStorage.getItem('theme')` — saved user preference
2. `window.matchMedia('(prefers-color-scheme: dark)')` — system preference
3. Defaults to dark if neither is available

---

### 2. Theme Switcher Component (`src/lib/components/ThemeSwitcher.svelte`)

The UI toggle that lets users switch themes. When clicked, it:

1. Updates the `isDark` store
2. Toggles the `dark` class on `<html>` (for Tailwind dark mode)
3. Sets `data-theme` attribute on `<html>` (for Skeleton themes)
4. Saves preference to `localStorage`

```svelte
<script>
  import ThemeSwitcher from '$lib/components/ThemeSwitcher.svelte';
</script>

<ThemeSwitcher />
```

---

### 3. Preventing Flash of Wrong Theme (`src/app.html`)

An inline script runs before the page renders to set the correct theme immediately:

```html
<script>
  (function() {
    const stored = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = stored ? stored === 'dark' : prefersDark;
    if (isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'hamlindigo');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-theme', 'pine');
    }
  })();
</script>
```

This prevents the "flash" where users briefly see the wrong theme before JavaScript loads.

---

### 4. Theme-Aware Styles (`src/lib/styles/global.css`)

#### Body Colors
```css
/* Light mode */
body {
  background-color: var(--body-background-color);
  color: var(--base-font-color);
}

/* Dark mode */
.dark body {
  background-color: var(--body-background-color-dark);
  color: var(--base-font-color-dark);
}
```

#### Font Override for Pine Theme
Pine uses serif fonts by default, so we override them to match hamlindigo:

```css
[data-theme='pine'] {
  --base-font-family: Seravek, 'Gill Sans Nova', Ubuntu, Calibri, 'DejaVu Sans', source-sans-pro, sans-serif;
  --heading-font-family: 'Iowan Old Style', 'Palatino Linotype', 'URW Palladio L', P052, serif;
  --heading-font-weight: bold;
}
```

#### Light Mode Accessibility Fixes
```css
/* Desktop nav - force dark text */
@media (min-width: 768px) {
  html:not(.dark) nav a {
    color: #111827 !important;
  }
}

/* Mobile bottom nav - lighter background and text */
html:not(.dark) .bottom-nav {
  background-color: var(--color-surface-50) !important;
}
html:not(.dark) .bottom-nav a,
html:not(.dark) .bottom-nav span,
html:not(.dark) .bottom-nav svg {
  color: var(--color-surface-400) !important;
}
```

---

## Theme-Aware Assets

Some images switch based on the current theme:

### Homepage Hero Gif (`src/routes/+page.svelte`)
```svelte
<script>
  import heroGifDark from "$lib/assets/clouds2.gif";
  import heroGifLight from "$lib/assets/clouds3.gif";
  import { isDark } from "$lib/stores/theme";
</script>

<img src={$isDark ? heroGifDark : heroGifLight} alt="Angel's Rest" />
```

### Header Gif on Other Pages (`src/routes/+layout.svelte`)
```svelte
<script>
  import headerGifDark from "$lib/assets/ponyolovesham.gif";
  import headerGifLight from "$lib/assets/ponyolovesham2.gif";
  import { isDark } from "$lib/stores/theme";
</script>

<img src={$isDark ? headerGifDark : headerGifLight} alt="" />
```

---

## File Summary

| File | Purpose |
|------|---------|
| `src/lib/stores/theme.ts` | Svelte store for theme state |
| `src/lib/components/ThemeSwitcher.svelte` | Toggle UI component |
| `src/app.html` | Inline script to prevent theme flash |
| `src/lib/styles/global.css` | Theme-aware styles and overrides |
| `src/routes/+layout.svelte` | Mobile switcher placement, theme-aware header gif |
| `src/routes/+page.svelte` | Theme-aware hero gif |

---

## Adding Theme-Aware Elements

To make any element respond to theme changes:

### Option 1: Tailwind Dark Variant
```svelte
<div class="bg-white dark:bg-surface-900">
  <!-- Light: white background, Dark: dark background -->
</div>
```

### Option 2: Reactive with Store
```svelte
<script>
  import { isDark } from '$lib/stores/theme';
</script>

{#if $isDark}
  <DarkComponent />
{:else}
  <LightComponent />
{/if}
```

### Option 3: CSS Variables
```css
.my-element {
  background: var(--body-background-color);
}
.dark .my-element {
  background: var(--body-background-color-dark);
}
```

---

## Skeleton Theme Reference

Both themes are imported in `global.css`:
```css
@import '@skeletonlabs/skeleton/themes/hamlindigo';
@import '@skeletonlabs/skeleton/themes/pine';
```

Skeleton themes provide CSS variables like:
- `--color-surface-50` through `--color-surface-950`
- `--color-primary-*`, `--color-secondary-*`, etc.
- `--body-background-color` / `--body-background-color-dark`
- `--base-font-color` / `--base-font-color-dark`

See [Skeleton Themes Docs](https://www.skeleton.dev/docs/themes) for full reference.
