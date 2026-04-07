# AGENTS.md - angelsrest

Rules for working on this codebase.

## Project Context

- **Stack:** SvelteKit 5 (runes) + Tailwind CSS v4 + Sanity CMS + Stripe + LumaPrints + Resend
- **Frontend:** `~/Documents/work/angelsrest` → https://angelsrest.online
- **Studio:** `~/Documents/work/angelsrest-studio` → https://angelsrest.sanity.studio
- **CRM Spec:** `~/Documents/quilt/02_reference/projects/photographer_crm/implementation-spec.md`

## Tech Constraints

- SvelteKit 5 with Svelte 5 runes (`$props()`, `$state()`, `$derived()`, `$effect()`)
- Tailwind CSS v4 — avoid Skeleton component classes, use plain Tailwind
- Use `$env/dynamic/private` for env vars in hooks, not `$env/static/private`
- Biome linter enforced via husky — run checks before reporting done

## Key Files

- **Stripe webhook:** `src/routes/api/webhooks/stripe/+server.ts`
- **Admin orders:** `src/routes/admin/orders/+page.svelte`
- **Order lookup:** `src/routes/orders/+page.svelte`
- **Sanity client:** `src/lib/sanity/client.ts` (read), `src/lib/sanity/adminClient.ts` (write)
- **Sanity preview client:** `src/lib/sanity/previewClient.ts` (draft-aware, for visual editing)
- **LumaPrints client:** `src/lib/lumaprints/client.ts`
- **Server hooks:** `src/hooks.server.ts` (admin auth + preview mode detection)
- **Root layout:** `src/routes/+layout.svelte` (visual editing overlay when previewing)
- **Root layout server:** `src/routes/+layout.server.ts` (passes isPreview to all pages)

## Preview / Visual Editing

Sanity Presentation plugin connects Studio to this frontend for live preview:

- **Enable:** `GET /api/draft/enable` — validates Sanity preview secret, sets `__sanity_preview` cookie
- **Disable:** `GET /api/draft/disable` — clears cookie
- **Detection:** `hooks.server.ts` reads cookie → sets `locals.isPreview`
- **Overlay:** `+layout.svelte` calls `enableVisualEditing()` in onMount when `data.isPreview` is true
- **Env var:** `SANITY_PREVIEW_TOKEN` (Viewer role token from Sanity)

## Running Checks

```bash
cd ~/Documents/work/angelsrest
pnpm biome check --write src/
pnpm svelte-check
pnpm build
```

## Branching

- Create a branch: `git checkout -b feature/name`
- Commit and push
- Tell Jesse to review
- Don't push to main without permission

## Current Features

- Shop with Stripe checkout
- Order creation via webhook
- Customer + admin order emails via Resend
- Admin dashboard at `/admin/orders` (Basic Auth protected)
- Order lookup page at `/orders`
- Sanity visual editing / live preview via Presentation plugin
- LumaPrints integration (paper selection, fulfillment)

## Platform Context

This site is the **hub** of the photographer CRM platform:
- **angelsrest** = your personal site + platform management server
- **angelsrest-studio** = your Sanity CMS (content only)
- **Convex** = operational backend (orders, CRM, messages, tiers) — coming soon
- **admin-dashboard** = shared admin package for all client sites — coming soon
- **reflecting-pool** = first client template — coming soon

Platform admin routes will be added at `/admin/clients`, `/admin/messages`, and `/api/platform/*`.
