# AGENTS.md — angelsrest

Photography portfolio and shop for Jesse Pomeroy (angelsrest.online).
Deployed on Vercel. Content managed via Sanity CMS.

---

## Stack

- **Framework:** SvelteKit (Svelte 5, runes mode)
- **Styling:** Tailwind 4 + Skeleton UI (v2)
- **CMS:** Sanity (`@sanity/client`, `@sanity/image-url`)
- **Commerce:** Stripe (`stripe`, `@stripe/stripe-js`)
- **Email:** Resend
- **Linting:** Biome (JS/TS only) + `svelte-check` (Svelte files)
- **Analytics:** `@vercel/analytics`
- **Icons:** `@lucide/svelte`

---

## Critical Rules

### Svelte files — never touch with Biome
Biome does NOT lint or format `.svelte` files. `biome.json` explicitly ignores them.
- Use `svelte-check` for type checking Svelte files: `pnpm svelte-check`
- Do NOT add `*.svelte` back to Biome's scope — this caused a production outage before

### Svelte 5 runes — always use runes syntax
- Use `$state`, `$derived`, `$effect`, `$props` — not the legacy Options API
- Use `$app/state` for page store — NOT `$app/stores`
- No `export let` for props — use `let { prop } = $props()`

### Skeleton UI
- Themes: `hamlindigo` (dark), `pine` (light)
- Import components from `@skeletonlabs/skeleton-svelte`
- Tailwind dark mode is class-based — check `dark` is on `<html>`, not `data-theme`

### Sanity
- Project ID: `n7rvza4g`, dataset: `production`
- Studio lives in the separate `angelsrest-studio` repo — do not edit schema here
- GROQ queries live in `src/lib/sanity/`
- Images always go through `@sanity/image-url` builder — never use raw asset URLs

### Git
- Branch: `main` (production)
- Do NOT push to `main` without explicit instruction from Jesse
- Keep commits atomic and descriptive
- Never force-push or squash public commits

---

## Project Structure

```
src/
  lib/
    assets/       # Static assets
    components/   # Shared Svelte components
    sanity/       # GROQ queries + Sanity client setup
    stores/       # Svelte stores (legacy — prefer runes in new code)
    styles/       # Global CSS
  routes/
    +layout.svelte
    +page.svelte
    about/
    api/          # Server-side API routes (Stripe webhooks, etc.)
    blog/
    checkout/
    gallery/
    shop/
```

---

## Commands

```bash
pnpm dev          # Dev server
pnpm build        # Production build
pnpm preview      # Preview production build
pnpm svelte-check # Type-check Svelte files
pnpm biome check  # Lint JS/TS (not .svelte)
```

---

## Known Gotchas

- Tailwind 4's `dark:` variant can fail with `!important` — use reactive CSS variables as workaround
- Biome rewrote 36 Svelte files in commit `cdcde2d` causing a production outage — `cf2c23f` fixed it
- The `Nav` component must be imported correctly — it was the symptom of the Biome outage
