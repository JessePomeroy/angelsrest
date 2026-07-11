# AGENTS.md — angelsrest

Canonical rules for working in this repository.

## Project context

- **Stack:** SvelteKit 5 (runes), Tailwind CSS v4, Sanity, Convex, Stripe,
  LumaPrints, Resend, and Cloudflare R2
- **Frontend and platform hub:** `~/Documents/work/angelsrest` →
  <https://angelsrest.online>
- **Sanity Studio:** `~/Documents/work/angelsrest-studio` →
  <https://angelsrest.sanity.studio>
- **Current architecture:** `docs/ARCHITECTURE.md`
- **CRM spec:**
  `~/Documents/quilt/02_reference/projects/photographer_crm/implementation-spec.md`
- **User guide:**
  `~/Documents/quilt/02_reference/projects/photographer_crm/crm-user-guide.md`

## Technical constraints

- Use Svelte 5 runes (`$props()`, `$state()`, `$derived()`, `$effect()`).
- Use Tailwind CSS v4 utilities. Do not use Skeleton component classes such as
  `.btn`, `.card`, or `.input`. The retained Skeleton surface color variables
  (`--color-surface-50` through `--color-surface-900`) may be referenced from
  scoped styles or Tailwind arbitrary values.
- Admin pages use scoped styles and `--admin-*` variables, not Tailwind.
- Server secrets use `$env/dynamic/private`. Never import private env modules
  from browser-reachable code.
- Do not hand-edit generated Convex files.
- Biome and Svelte checks are enforced. Run relevant checks before reporting a
  change complete.

## System boundaries

- **Sanity owns editorial content:** public portfolio galleries, products,
  collections, blog, about, site settings, and contact-page copy.
- **Convex owns operations:** orders, inquiries, CRM clients, invoices, quotes,
  contracts, email templates, platform clients/messages, and private delivery
  galleries.
- **SvelteKit owns transport and composition:** SSR/load functions, public and
  admin HTTP routes, webhook verification, and external-client composition.
- **The hub owns commerce webhooks:** this repository's commerce webhook is the
  single order-intake owner for Angels Rest and Stripe Connect client sites.
  Client spokes may request Checkout sessions through the signed bridge, but
  must not run a second `checkout.session.completed` order/fulfillment path.
- **External systems:** Stripe, LumaPrints, Resend, Sanity, Convex, and the
  gallery worker are network boundaries. Make their failure and retry behavior
  explicit; avoid speculative interfaces around pure in-process code.

There are two gallery domains:

- **Portfolio galleries** are public Sanity content under `/gallery` and the
  admin portfolio tab.
- **Delivery galleries** are private Convex records and R2 objects under
  `/delivery/[token]` and the admin delivery tab.

Use these full names in new code and documentation when the distinction matters.

## Key files

- Convex client helper: `src/lib/server/convexClient.ts`
- Convex schema/functions: `packages/crm-api/convex/`
- Site config: `src/lib/config/site.ts`
- Sanity published client: `src/lib/sanity/client.ts`
- Sanity preview client: `src/lib/sanity/client.server.ts`
- Commerce webhook: `src/routes/api/webhooks/stripe/+server.ts`
- Webhook orchestration: `src/lib/server/orderIntake.ts`
- Print fulfillment: `src/lib/server/printFulfillment.ts`
- LumaPrints client/payload builder: `src/lib/server/lumaprints.ts`
- Admin host config: `src/lib/config/admin.ts` and `admin.server.ts`
- Server hooks: `src/hooks.server.ts` (security headers, preview state, errors)

The `$convex` alias points to
`packages/crm-api/convex/_generated` through `svelte.config.js`.

## Admin authentication and transport

All `/admin/*` pages use Better Auth. `src/routes/admin/+layout.server.ts`
validates the session **and stored site membership** before child loaders fetch
sensitive data, and the shared `AuthGuard` handles login/session UI.

The browser Convex WebSocket is authenticated manually in
`src/routes/admin/+layout.svelte` with `setupConvex` and `setupAuth`. This avoids
the historical `createSvelteAuthClient` session-pause race during SvelteKit
navigation. Do not replace the manual setup without explicitly reproducing and
testing navigation/session behavior.

Admin mutations use HTTP:

- `src/routes/api/admin/mutation/+server.ts` validates the Better Auth cookie.
- `AdminConfig.mutationTransport` is `"http"`.
- The shared package forwards each mutation through a fresh authenticated
  `ConvexHttpClient`, avoiding shared `setAuth` state between requests.
- Authenticated server loaders use `createAuthenticatedConvexClient(token)`;
  never call `setAuth` on the cached `getConvex()` client.
- Queries continue over the authenticated browser WebSocket.

New admin server handlers must authorize the required creator/site membership;
token validity alone is authentication, not authorization. Use the host's
per-request site-admin verifier for shared HTTP handlers; do not restore an
identity-only `verifyAdmin` callback.

Public inquiry writes must enter through `/api/contact`. That route validates
Turnstile through the managed siteverify Worker and supplies the server-only
`WEBHOOK_SECRET` to Convex. Do not make `inquiries.create` directly writable by
the browser or move Turnstile verification into browser-only code. The temporary
missing-secret compatibility path used for the staged rollout has been removed.

| Admin area | Primary source |
|---|---|
| Dashboard, orders | Convex orders |
| Inquiries | Convex inquiries |
| Galleries: portfolio tab | Sanity galleries |
| Galleries: delivery tab | Convex galleries + gallery worker/R2 |
| CRM, board | Convex photography clients/kanban |
| Invoices, quotes, contracts | Convex |
| Email templates, messages, platform | Convex |

## Preview and visual editing

- Enable: `GET /api/draft/enable` validates the Sanity preview secret and sets
  the preview cookie.
- Disable: `GET /api/draft/disable` clears it.
- `SANITY_PREVIEW_TOKEN` must be a viewer token that can read drafts.
- Keep preview-token access in `.server.ts` modules.

## Checks

```bash
pnpm lint
pnpm check
pnpm test
pnpm --filter @jessepomeroy/print-catalog check
pnpm --filter @jessepomeroy/print-catalog test
pnpm --filter @jessepomeroy/crm-api exec tsc -p tsconfig.json --noEmit
```

Use `pnpm build` when production bundling is relevant. Do not run Biome with
`--write` during an audit or other read-only task.

## Git workflow

- Work on a focused branch unless the user specifies another workflow.
- Do not push to `main` without explicit permission.
- Do not add AI-assistant co-author trailers.
- Preserve unrelated user changes in a dirty worktree.

## Platform context

- **angelsrest** is the public site and platform hub.
- **angelsrest-studio** owns Sanity schemas/editorial workflows.
- **packages/crm-api** owns the shared Convex schema/functions and publishable
  generated API surface.
- **@jessepomeroy/admin** is an installed shared admin package.
- **reflecting-pool** is a spoke/client site that consumes the shared platform.

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its operational backend.

Before inspecting or editing Convex code, read
`packages/crm-api/convex/_generated/ai/guidelines.md` completely. Its rules
override assumptions learned elsewhere.
<!-- convex-ai-end -->
