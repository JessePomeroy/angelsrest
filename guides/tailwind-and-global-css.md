# Tailwind & Global CSS Guide

This guide explains how Tailwind CSS and global styles work together in the Angel's Rest project.

---

## Project Setup

The project uses:
- **Tailwind CSS v4** — utility-first CSS framework (via `@tailwindcss/vite`)
- **Skeleton UI** — component library built on Tailwind
- **Hamlindigo Theme** — single theme for both light and dark modes
- **Global CSS** — custom gradients, typography, and imports

All styles flow through `src/lib/styles/global.css`.

---

## The Global CSS File

### Structure

```css
/* 1. Tailwind import */
@import 'tailwindcss';

/* 2. Tailwind v4: Enable class-based dark mode */
@custom-variant dark (&:where(.dark, .dark *));

/* 3. Skeleton imports */
@import '@skeletonlabs/skeleton';
@import '@skeletonlabs/skeleton-svelte';

/* 4. Single theme for both light and dark modes */
@import '@skeletonlabs/skeleton/themes/hamlindigo';

/* 5. Base resets */
*, *::before, *::after { box-sizing: border-box; }

/* 6. Body styling with gradient backgrounds */
body {
  text-transform: lowercase;
  background-image: radial-gradient(...);
}

html.dark body {
  background-image: radial-gradient(...);
}

/* 7. Typography customizations */
h1, h2, h3, h4, h5, h6 { font-weight: 400; }

/* 8. Responsive adjustments */
@media (min-width: 768px) { ... }
```

### Key Design Decisions

| Decision | Reason |
|----------|--------|
| Single hamlindigo theme | Consistent colors, simpler code |
| Global lowercase text | Modern aesthetic |
| Radial gradient backgrounds | Subtle depth without distraction |
| Light heading weights | Elegant, minimal feel |
| Mobile-first gradients | Subtler on small screens |

---

## Tailwind v4 Dark Mode

Tailwind v4 defaults to `@media (prefers-color-scheme: dark)`. We override this to use class-based dark mode:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

This enables the `dark:` prefix to work when `.dark` class is on `<html>`.

---

## When to Use What

### Use Tailwind Classes When...

✅ Styling your own elements
```svelte
<div class="flex items-center gap-4 p-8 bg-surface-900 rounded-xl">
```

✅ Responsive design
```svelte
<div class="text-sm md:text-base lg:text-lg">
```

✅ Dark mode variants
```svelte
<p class="text-gray-600 dark:text-gray-300">
```

✅ Hover/focus states
```svelte
<a class="opacity-70 hover:opacity-100 transition-opacity">
```

✅ Conditional classes
```svelte
<div class={isActive ? 'bg-primary-500' : 'bg-surface-800'}>
```

### Use Global CSS When...

✅ Importing frameworks
```css
@import 'tailwindcss';
```

✅ Complex selectors
```css
html.dark body { ... }
```

✅ Background gradients (can't do radial gradients easily with Tailwind)
```css
body {
  background-image: radial-gradient(ellipse 80% 60% at 30% 20%, ...);
}
```

✅ Global text transformations
```css
body {
  text-transform: lowercase;
}
```

✅ Overriding framework styles
```css
.btn {
  text-transform: lowercase !important;  /* Override Skeleton's uppercase */
}
```

---

## Color Patterns

### Explicit Tailwind Colors (Recommended for Consistency)

For reliable light/dark mode styling, use explicit Tailwind colors with dark variants:

```svelte
<div class="bg-gray-100 dark:bg-gray-800">
<p class="text-gray-700 dark:text-gray-300">
<span class="text-gray-500 dark:text-gray-400">
```

### Skeleton Design Tokens

Skeleton provides semantic color classes that automatically adapt:

```svelte
<!-- Responsive tokens (auto light/dark) -->
<div class="text-surface-600-300-token">
<div class="bg-surface-100-800-token">

<!-- Semi-transparent backgrounds -->
<div class="bg-surface-500/10 border border-surface-500/20">
```

### Skeleton Button Variants

```svelte
<button class="btn variant-filled-primary">Primary filled</button>
<button class="btn variant-soft-surface">Soft surface</button>
<button class="btn variant-ghost-surface">Ghost</button>
```

---

## Common Patterns

### Centered Container
```svelte
<div class="max-w-[1400px] mx-auto px-4 md:px-8">
```

### Flex Center
```svelte
<div class="flex items-center justify-center">
```

### Card (Matching Site Style)
```svelte
<div class="bg-surface-500/10 border border-surface-500/20 rounded-lg p-4 hover:border-surface-400/40 transition-all">
```

### Hidden/Shown by Breakpoint
```svelte
<!-- Mobile only -->
<div class="md:hidden">

<!-- Desktop only -->
<div class="hidden md:block">
```

### Grid Layouts
```svelte
<!-- Two columns on mobile, three on desktop -->
<div class="grid grid-cols-2 md:grid-cols-3 gap-4">

<!-- Masonry-style columns -->
<div class="columns-2 md:columns-3 gap-4">
```

### Transitions
```svelte
<a class="transition-colors duration-200">
<div class="transition-opacity duration-300">
<button class="transition-all duration-200">
```

---

## Responsive Prefixes

Mobile-first breakpoints:

| Prefix | Min Width | Usage |
|--------|-----------|-------|
| (none) | 0px | Mobile default |
| `sm:` | 640px | Small tablets |
| `md:` | 768px | Tablets |
| `lg:` | 1024px | Laptops |
| `xl:` | 1280px | Desktops |
| `2xl:` | 1536px | Large screens |

```svelte
<!-- Different padding per breakpoint -->
<main class="px-2 md:px-8 lg:px-16">

<!-- Stack on mobile, row on desktop -->
<div class="flex flex-col md:flex-row">
```

---

## Important Modifier

Prefix with `!` to add `!important`:

```svelte
<div class="!mx-auto">  <!-- margin: auto !important -->
<div class="!px-6">     <!-- padding-x: 1.5rem !important -->
```

---

## Arbitrary Values

Use brackets for custom values:

```svelte
<div class="max-w-[1400px]">
<div class="w-[200px]">
<div class="grid-cols-[1fr_2fr_1fr]">
<div class="text-[13px]">
<div class="bg-[#1a1a2e]">
<div class="tracking-[0.15em]">
```

---

## Skeleton UI Colors

Skeleton provides semantic color scales via CSS variables:

### Surface Colors (grays)
```
surface-50   ████  lightest
surface-100  ████
surface-200  ████
surface-300  ████
surface-400  ████
surface-500  ████  mid
surface-600  ████
surface-700  ████
surface-800  ████
surface-900  ████
surface-950  ████  darkest
```

### Semantic Colors
- `primary-*` — brand color (indigo in hamlindigo)
- `secondary-*` — accent color
- `tertiary-*` — third accent
- `success-*` — green (for positive states)
- `warning-*` — yellow/orange
- `error-*` — red (for errors, out of stock)

---

## Debugging Tips

### Classes Not Applying?

1. **Check spelling** — typos are common
2. **Check specificity** — use `!important` modifier if needed
3. **Check cascade** — global CSS might override
4. **Check dark mode** — ensure `dark:` variant is correct

### Dark Mode Not Working?

1. Check if `dark` class is on `<html>` element
2. Check if `@custom-variant dark` is in global.css
3. Check CSS specificity

### Skeleton Classes Not Working?

Some Skeleton classes have built-in styles that override Tailwind:

```svelte
<!-- Skeleton's btn has uppercase, override with inline style -->
<button 
  class="btn variant-soft-surface" 
  style="text-transform: lowercase !important;"
>
  lowercase button
</button>
```

---

## File Organization

```
src/lib/styles/
└── global.css          # All global styles in one file

No separate files for:
- variables (use Skeleton's built-in CSS variables)
- resets (included in global.css)
- themes (single theme import)
```

---

## Resources

- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [Skeleton UI Docs](https://www.skeleton.dev/docs)
- [Hamlindigo Theme Reference](https://www.skeleton.dev/docs/themes)
- [Tailwind Cheat Sheet](https://tailwindcomponents.com/cheatsheet/)