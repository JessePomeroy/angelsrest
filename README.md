# Angel's Rest

Angel's Rest is Jesse Pomeroy's portfolio, shop, and the hub application for a
multi-tenant photographer CRM platform. The production site is
[angelsrest.online](https://angelsrest.online).

## System overview

- **SvelteKit 5** renders the public site, admin host, and HTTP integrations.
- **Sanity** owns editorial content: portfolio galleries, products,
  collections, blog, about, and site copy.
- **Convex** owns operational data: orders, inquiries, CRM clients, invoices,
  quotes, contracts, messages, platform tenants, and private delivery galleries.
- **Stripe** handles shop, invoice, and platform payments, including connected
  tenant accounts.
- **LumaPrints** fulfills eligible print orders.
- **Resend** sends transactional email.
- **Cloudflare R2**, behind the gallery worker, stores private delivery assets.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for boundary and request-flow
details.

## Workspace packages

| Package | Responsibility |
|---|---|
| `@jessepomeroy/crm-api` | Convex schema/functions plus generated API and data-model exports shared with spoke sites |
| `@jessepomeroy/print-catalog` | Print materials, sizes, LumaPrints identifiers, and pricing helpers shared with the site and Studio |
| `@jessepomeroy/admin` | Installed shared admin UI and server-handler package |

## Local development

Requirements are Node 22+ and the pnpm version declared in `package.json`.

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Use test-mode Stripe credentials and `LUMAPRINTS_USE_SANDBOX=true` locally.
Convex development commands run from `packages/crm-api/`; its local deployment
configuration lives in `packages/crm-api/.env.local`.

## Checks

```bash
pnpm lint
pnpm check
pnpm test
pnpm --filter @jessepomeroy/print-catalog check
pnpm --filter @jessepomeroy/print-catalog test
pnpm --filter @jessepomeroy/crm-api exec tsc -p tsconfig.json --noEmit
```

CI runs the same lint, type-check, and test layers plus the orders lookup smoke
test. Use `pnpm build` when a change needs a production-build verification.

## Documentation

- [AGENTS.md](AGENTS.md) — canonical repository rules and implementation constraints
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — current ownership, dependency, auth, and transport boundaries
- [LUMAPRINTS.md](LUMAPRINTS.md) — current print-fulfillment integration
- [packages/crm-api/README.md](packages/crm-api/README.md) — shared Convex package and release workflow
- [docs/archive/README.md](docs/archive/README.md) — historical documents retained for context only

The Sanity Studio is a separate repository at `~/Documents/work/angelsrest-studio`.

The wider platform also includes `reflecting-pool`, `reflecting-pool-studio`,
`sanity-studio-template`, `admin-dashboard`, and `gallery-worker`; ownership and
dependency direction are documented in `docs/ARCHITECTURE.md`.
