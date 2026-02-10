# Tailwind & Global CSS Guide

This guide explains how Tailwind CSS and global styles work together in the Angel's Rest project.

---

## Project Setup

The project uses:
- **Tailwind CSS v4** — utility-first CSS framework
- **Skeleton UI** — component library built on Tailwind
- **Global CSS** — custom overrides and imports

All styles flow through `src/lib/styles/global.css`.

---

## The Global CSS File

### Structure

```css
/* 1. Framework imports */
@import 'tailwindcss';
@import '@skeletonlabs/skeleton';
@import '@skeletonlabs/skeleton-svelte';

/* 2. Theme imports */
@import '@skeletonlabs/skeleton/themes/hamlindigo';
@import '@skeletonlabs/skeleton/themes/pine';

/* 3. Base resets */
*, *::before, *::after { ... }
body { ... }

/* 4. Theme customizations */
[data-theme='pine'] { ... }

/* 5. Accessibility fixes */
html:not(.dark) nav a { ... }
```

### Why We Need It

| Purpose | Why Global CSS? |
|---------|-----------------|
| Import Tailwind | Required entry point |
| Import Skeleton themes | Can't import in components |
| CSS variable overrides | Theme-level customizations |
| Complex selectors | `:not()`, `[data-theme]`, etc. |
| Third-party component styling | Can't add classes to Skeleton internals |

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
<p class="text-gray-600 dark:text-surface-400">
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

✅ Overriding CSS variables
```css
[data-theme='pine'] {
  --base-font-family: system-ui, sans-serif;
}
```

✅ Complex selectors that Tailwind can't express
```css
html:not(.dark) .bottom-nav a { ... }
```

✅ Styling third-party component internals
```css
/* Can't add classes to Skeleton's internal markup */
.bottom-nav [data-navigation] { ... }
```

✅ Base element resets
```css
img {
  max-width: 100%;
  display: block;
}
```

---

## Tailwind Basics

### Utility Classes

Tailwind provides single-purpose utility classes:

```svelte
<!-- Spacing -->
<div class="p-4 m-2 gap-8">      <!-- padding, margin, gap -->

<!-- Flexbox -->
<div class="flex items-center justify-between">

<!-- Grid -->
<div class="grid grid-cols-3 gap-4">

<!-- Typography -->
<p class="text-sm font-bold tracking-wide lowercase">

<!-- Colors -->
<div class="bg-surface-900 text-surface-50 border-surface-500">

<!-- Sizing -->
<div class="w-full max-w-[1400px] h-screen">

<!-- Borders -->
<div class="rounded-xl border border-surface-500/20">
```

### Responsive Prefixes

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
<!-- Hidden on mobile, flex on desktop -->
<nav class="hidden md:flex">

<!-- Different padding per breakpoint -->
<main class="px-2 md:px-8 lg:px-16">

<!-- Stack on mobile, row on desktop -->
<div class="flex flex-col md:flex-row">
```

### Dark Mode

Use the `dark:` prefix for dark mode styles:

```svelte
<div class="bg-white dark:bg-surface-900">
<p class="text-gray-900 dark:text-surface-50">
<a class="text-gray-600 hover:text-gray-900 dark:text-surface-400 dark:hover:text-surface-50">
```

### Arbitrary Values

Use brackets for custom values:

```svelte
<div class="max-w-[1400px]">
<div class="w-[200px]">
<div class="grid-cols-[1fr_2fr_1fr]">
<div class="text-[13px]">
<div class="bg-[#1a1a2e]">
```

### Important Modifier

Prefix with `!` to add `!important`:

```svelte
<div class="!mx-auto">  <!-- margin-left: auto !important; margin-right: auto !important; -->
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

### Usage
```svelte
<div class="bg-surface-900 text-surface-50 border-surface-500/20">
```

### Other Color Scales
- `primary-*` — brand color
- `secondary-*` — accent color
- `tertiary-*` — third accent
- `success-*` — green
- `warning-*` — yellow/orange
- `error-*` — red

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

### Card
```svelte
<div class="bg-surface-800 rounded-xl p-6 border border-surface-500/20">
```

### Button
```svelte
<a class="btn preset-filled-surface-50 px-8 py-3 text-xs tracking-wider uppercase">
```

### Hidden/Shown by Breakpoint
```svelte
<!-- Mobile only -->
<div class="md:hidden">

<!-- Desktop only -->
<div class="hidden md:block">
<!-- or -->
<div class="hidden md:flex">
```

### Transitions
```svelte
<a class="transition-colors duration-200">
<div class="transition-opacity duration-300">
<button class="transition-all duration-200">
```

---

## Debugging Tips

### See What Classes Are Applied
Use browser DevTools → Elements panel → look at the element's classes

### Tailwind Not Working?
1. Check if class name is correct (typos)
2. Check if it's being overridden (use `!important` modifier)
3. Check if the value exists (arbitrary values need brackets)
4. Check breakpoint logic (mobile-first!)

### Dark Mode Not Working?
1. Check if `dark` class is on `<html>`
2. Check if using `dark:` prefix correctly
3. Check CSS specificity (global css might override)

---

## Resources

- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [Skeleton UI Docs](https://www.skeleton.dev/docs)
- [Tailwind Cheat Sheet](https://tailwindcomponents.com/cheatsheet/)
