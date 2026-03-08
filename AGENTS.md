# AGENTS.md - angelsrest

Rules for working on this codebase.

## Project Context

- **Stack:** SvelteKit + Tailwind CSS + Skeleton UI + Sanity CMS + Stripe
- **Frontend:** `~/Documents/work/angelsrest` → https://angelsrest.online
- **Studio:** `~/Documents/work/angelsrest-studio` → https://angelsrest.sanity.studio
- **Spec:** `~/Documents/quilt/02_reference/projects/lumaprints-angelsrest.md`

## Tech Constraints

- Use SvelteKit 2 (not Svelte 5 for pages/components, but runes for new code)
- Tailwind CSS v4 — avoid Skeleton component classes, use plain Tailwind
- Use `$env/dynamic/private` for env vars in hooks, not `$env/static/private`
- Biome linter enforced via husky — run checks before reporting done

## Key Files

- **Stripe webhook:** `src/routes/api/webhooks/stripe/+server.ts`
- **Admin orders:** `src/routes/admin/orders/+page.svelte`
- **Order lookup:** `src/routes/orders/+page.svelte`
- **Sanity client:** `src/lib/sanity/client.ts` (read), `src/lib/sanity/adminClient.ts` (write)
- **LumaPrints client:** `src/lib/lumaprints/client.ts`

## Running Checks

```bash
cd ~/Documents/work/angelsrest
pnpm biome check --write src/
pnpm svelte-check
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
- LumaPrints integration (in progress)
