# Theme Switching Guide

This guide explains how the light/dark theme switching works in the Angel's Rest website.

---

## Overview

The site uses a **single theme** approach:
- **Skeleton's `hamlindigo` theme** for both light and dark modes
- The theme automatically provides different color values for light/dark
- Switching only toggles the `dark` class on `<html>`

This simplified approach eliminates:
- Multiple theme imports
- Theme-specific overrides
- Inconsistent styling between modes

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
3. Keeps `data-theme="hamlindigo"` (always the same)
4. Saves preference to `localStorage`

```svelte
<script>
  import ThemeSwitcher from '$lib/components/ThemeSwitcher.svelte';
</script>

<ThemeSwitcher />
```

**Placement:**
- **Desktop**: In the top navigation bar (all pages)
- **Mobile**: Fixed position above the bottom nav (homepage only)

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
    } else {
      document.documentElement.classList.remove('dark');
    }
    
    // Always use hamlindigo theme
    document.documentElement.setAttribute('data-theme', 'hamlindigo');
  })();
</script>
```

This prevents the "flash" where users briefly see the wrong theme before JavaScript loads.

---

### 4. Global Styles (`src/lib/styles/global.css`)

#### Tailwind v4 Dark Mode Configuration

```css
/* Enable class-based dark mode in Tailwind v4 */
@custom-variant dark (&:where(.dark, .dark *));
```

This tells Tailwind to use the `.dark` class selector instead of the default `@media (prefers-color-scheme: dark)`.

#### Background Gradients

The site uses subtle radial gradients for visual depth:

```css
/* Light mode background */
body {
  text-transform: lowercase;
  background-color: #f1f5f9 !important;
  background-image: 
    radial-gradient(
      ellipse 80% 60% at 30% 20%,
      rgba(99, 102, 241, 0.08) 0%,
      transparent 50%
    ),
    radial-gradient(
      ellipse 60% 80% at 80% 70%,
      rgba(139, 92, 246, 0.06) 0%,
      transparent 50%
    ) !important;
  background-attachment: fixed;
}

/* Dark mode background */
html.dark body {
  background-color: #1e293b !important;
  background-image: 
    radial-gradient(
      ellipse 80% 60% at 30% 20%,
      rgba(129, 140, 248, 0.12) 0%,
      transparent 50%
    ),
    radial-gradient(
      ellipse 60% 80% at 80% 70%,
      rgba(167, 139, 250, 0.08) 0%,
      transparent 50%
    ) !important;
  background-attachment: fixed;
}
```

**Mobile Optimization:**
Gradients are more subtle on mobile to reduce visual noise on smaller screens. Desktop gets increased intensity via media query.

---

## Theme-Aware Styling Patterns

### Pattern 1: Tailwind Dark Variant

```svelte
<div class="bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100">
  Automatically switches colors based on theme
</div>
```

### Pattern 2: Skeleton Design Tokens

Skeleton provides responsive tokens that automatically adapt:

```svelte
<!-- These classes respond to light/dark automatically -->
<div class="bg-surface-500/10 text-surface-600-300-token">
  Uses Skeleton's built-in responsive tokens
</div>
```

Common responsive tokens:
- `text-surface-600-300-token` — darker in light mode, lighter in dark mode
- `bg-surface-100-800-token` — light gray in light mode, dark gray in dark mode

### Pattern 3: CSS Variables

```css
.my-element {
  background: var(--color-surface-50);
}

html.dark .my-element {
  background: var(--color-surface-900);
}
```

### Pattern 4: Reactive with Store

```svelte
<script>
  import { isDark } from '$lib/stores/theme';
</script>

{#if $isDark}
  <span>🌙 Dark mode active</span>
{:else}
  <span>☀️ Light mode active</span>
{/if}
```

---

## File Summary

| File | Purpose |
|------|---------|
| `src/lib/stores/theme.ts` | Svelte store for theme state |
| `src/lib/components/ThemeSwitcher.svelte` | Toggle UI component |
| `src/app.html` | Inline script to prevent theme flash |
| `src/lib/styles/global.css` | Theme-aware styles, gradients, lowercase |
| `src/routes/+layout.svelte` | Mobile switcher placement |

---

## Common Tasks

### Adding a Theme-Aware Component

```svelte
<!-- Use Tailwind's dark: variant -->
<button class="bg-blue-500 text-white dark:bg-blue-600">
  Click me
</button>
```

### Checking Current Theme in Code

```svelte
<script>
  import { isDark } from '$lib/stores/theme';
  
  function doSomething() {
    if ($isDark) {
      console.log('User prefers dark mode');
    }
  }
</script>
```

### Force a Specific Style Regardless of Theme

```svelte
<!-- Use !important or avoid dark: variant -->
<div class="bg-black text-white">
  Always black background, white text
</div>
```

---

## Skeleton Theme Reference

The hamlindigo theme is imported in `global.css`:

```css
@import '@skeletonlabs/skeleton/themes/hamlindigo';
```

Skeleton themes provide CSS variables like:
- `--color-surface-50` through `--color-surface-950`
- `--color-primary-*`, `--color-secondary-*`, etc.
- Various typography and spacing variables

See [Skeleton Themes Docs](https://www.skeleton.dev/docs/themes) for full reference.

---

## Why Single Theme?

Previous approach used:
- `hamlindigo` for dark mode
- `pine` for light mode

**Problems:**
- Inconsistent colors between themes
- Many CSS overrides needed
- Font differences between themes
- Complex theme switching logic

**Current approach:**
- Single `hamlindigo` theme for both modes
- Hamlindigo has built-in light/dark color values
- Only toggle the `dark` class
- Consistent design, simpler code

---

## Design Decisions

### Global Lowercase Text

All text is transformed to lowercase for a consistent, modern aesthetic:

```css
body {
  text-transform: lowercase;
}
```

Some elements override this when needed (e.g., form inputs).

### Background Gradients

Subtle indigo/violet gradients add depth without being distracting:
- Top-left: Indigo glow
- Bottom-right: Violet glow
- Fixed attachment so gradients don't scroll

### Heading Weights

Headings use normal weight (400) for a lighter, more elegant feel:

```css
h1, h2, h3, h4, h5, h6 {
  font-weight: 400;
  letter-spacing: -0.02em;
  line-height: 1.2;
}
```