# AGENTS.md - angelsrest

Rules for working on this codebase.

## Project Context

- **Stack:** SvelteKit 5 (runes) + Tailwind CSS v4 + Sanity CMS + Convex + Stripe + LumaPrints + Resend
- **Frontend:** `~/Documents/work/angelsrest` → https://angelsrest.online
- **Studio:** `~/Documents/work/angelsrest-studio` → https://angelsrest.sanity.studio
- **CRM Spec:** `~/Documents/quilt/02_reference/projects/photographer_crm/implementation-spec.md`
- **User Guide:** `~/Documents/quilt/02_reference/projects/photographer_crm/crm-user-guide.md`

## Tech Constraints

- SvelteKit 5 with Svelte 5 runes (`$props()`, `$state()`, `$derived()`, `$effect()`)
- Tailwind CSS v4, Tailwind-first. Do NOT use Skeleton component classes (`.btn`, `.card`, `.input`, etc.) — use plain Tailwind utilities. The only thing we borrow from Skeleton is its surface color scale, which is exposed as CSS custom properties (`--color-surface-50` … `--color-surface-900`). Reference those via `var(--color-surface-X)` in scoped `<style>` blocks or through Tailwind's arbitrary-property syntax.
- Use `$env/dynamic/private` for env vars in hooks, not `$env/static/private`
- Biome linter enforced via husky — run checks before reporting done
- Admin pages use scoped `<style>` blocks with `--admin-*` CSS custom properties, NOT Tailwind

## Key Files

- **Convex client helper:** `src/lib/server/convexClient.ts` — use `getConvex()` instead of instantiating ConvexHttpClient
- **Site config:** `src/lib/config/site.ts` — `SITE_DOMAIN`, `SITE_URL`, `SITE_URL_WWW`
- **Convex path alias:** `$convex` → `./convex/_generated` (configured in svelte.config.js)
- **Stripe webhook:** `src/routes/api/webhooks/stripe/+server.ts`
- **Sanity client:** `src/lib/sanity/client.ts` (read), `src/lib/sanity/adminClient.ts` (write)
- **Sanity preview client:** `src/lib/sanity/previewClient.ts` (draft-aware)
- **LumaPrints client:** `src/lib/lumaprints/client.ts`
- **Server hooks:** `src/hooks.server.ts` (admin auth + preview mode)

## Data Layer

- **Sanity:** Content only — galleries, products, collections, about, blog, inquiries, siteSettings, contactPage
- **Convex:** Operations — orders, CRM clients, invoices, quotes, contracts, email templates, platform clients, messages

## Admin Dashboard

All admin pages at `/admin/*` protected by HTTP Basic Auth.

| Page | Route | Data Source |
|------|-------|-------------|
| Dashboard | `/admin` | Convex orders |
| Orders | `/admin/orders` | Convex orders |
| Inquiries | `/admin/inquiries` | Sanity inquiries |
| Galleries | `/admin/galleries` | Sanity galleries |
| Clients (CRM) | `/admin/crm` | Convex photographyClients |
| Invoicing | `/admin/invoicing` | Convex invoices |
| Quotes | `/admin/quotes` | Convex quotes + quotePresets |
| Contracts | `/admin/contracts` | Convex contracts + contractTemplates |
| Email Templates | `/admin/emails` | Convex emailTemplates |
| Messages | `/admin/messages` | Convex platformMessages |
| Platform Clients | `/admin/platform` | Convex platformClients |

## Admin Design System

- Fonts: "Chillax" for headings, "Synonym" for body
- All text lowercase
- No card-style bordered boxes — use whitespace and typography
- Status indicators: small colored dots + text, not bordered pill badges
- Tables: subtle borders, generous padding, no card wrapper
- Modals: backdrop-filter: blur(8px) with rgba(0,0,0,0.4) overlay
- CSS custom properties defined in `+layout.svelte`: `--admin-bg`, `--admin-surface`, `--admin-heading`, `--admin-text`, `--admin-text-muted`, `--admin-text-subtle`, `--admin-border`, `--admin-border-strong`, `--admin-accent`, `--status-*`

## Preview / Visual Editing

- **Enable:** `GET /api/draft/enable` — validates Sanity preview secret, sets cookie
- **Disable:** `GET /api/draft/disable` — clears cookie
- **Env var:** `SANITY_PREVIEW_TOKEN` (Viewer role token from Sanity)

## Running Checks

```bash
cd ~/Documents/work/angelsrest
pnpm biome check --write src/
npx svelte-check
pnpm build
```

## Branching

- Create a branch: `git checkout -b feature/name`
- Commit and push
- Tell Jesse to review
- Don't push to main without permission

## Platform Context

This site is the **hub** of the photographer CRM platform:
- **angelsrest** = personal site + platform management server
- **angelsrest-studio** = Sanity CMS (content only)
- **Convex** = operational backend (orders, CRM, messages, tiers)
- **admin-dashboard** = shared admin package (to be extracted when stable)
- **reflecting-pool** = first client template

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
