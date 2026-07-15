# Angel's Rest

Angel's Rest is Jesse Pomeroy's photography portfolio and shop, and the
composition root for a hub-and-spoke platform used by independently branded
photographer websites. The production site is
[angelsrest.online](https://angelsrest.online).

The platform combines a public SvelteKit site, a tenant-aware administration
area, shared operational services, and integrations for commerce, print
fulfillment, email, and private gallery delivery.

## Platform at a glance

| Area | Current owner |
|---|---|
| Public pages and HTTP composition | SvelteKit 5 |
| Editorial content and portfolio galleries | Sanity |
| CRM, orders, inquiries, documents, and tenant records | Convex |
| Admin sessions and site membership | Better Auth + Convex |
| Shop, invoice, and platform payments | Stripe |
| Print fulfillment | LumaPrints |
| Transactional email | Resend |
| Private delivery-gallery files | Cloudflare R2 through the gallery worker |
| Error and performance telemetry | Sentry |

Sanity remains the production editorial source today. A replacement CMS
embedded in the existing admin dashboard is being planned, but that migration
has not started and the current Sanity boundary must remain intact until an
explicit cutover.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the authoritative system
map, ownership rules, and request flows.

## Hub-and-spoke model

This repository owns the platform composition root and shared Convex backend.
It is also the single commerce-webhook and LumaPrints shipment-intake owner.
Spoke websites reuse platform packages and services while retaining their own
brand, content, administrators, and public origin.

| Repository | Responsibility |
|---|---|
| `angelsrest` | Angel's Rest public site, platform hub, Convex backend, and shared domain packages |
| `admin-dashboard` | Source for the shared `@jessepomeroy/admin` UI and server adapters |
| `gallery-worker` | Cloudflare Worker and R2 boundary for private gallery assets and prepared downloads |
| `reflecting-pool` | Client spoke and tenant admin host; currently in pre-handoff production testing |
| `sanity-studio-template` | Shared Sanity schemas, desk structure, components, and actions |
| `angelsrest-studio` | Current Angel's Rest Sanity Studio |
| `reflecting-pool-studio` | Current Reflecting Pool Sanity Studio |

Cross-repository contracts are changed in their owning upstream repository
first, then adopted and verified by affected consumers.

## Workspace packages

| Package | Responsibility |
|---|---|
| `@jessepomeroy/crm-api` | Convex schema, functions, and generated API/data-model surface shared with spoke sites |
| `@jessepomeroy/print-catalog` | Pure print materials, sizes, LumaPrints identifiers, and pricing helpers |
| `@jessepomeroy/gallery-delivery` | Shared private-gallery delivery contracts and helpers |
| `@jessepomeroy/admin` | Installed shared admin UI and authenticated server-handler package |

The first three packages live in this workspace. `@jessepomeroy/admin` is
published from the separate `admin-dashboard` repository.

## Important boundaries

- Portfolio galleries are public editorial content currently stored in Sanity.
- Delivery galleries are private Convex records backed by protected R2 objects.
- Browser code never receives server secrets or broad service credentials.
- Every admin route requires both a valid session and stored site membership.
- Admin queries use an authenticated Convex WebSocket; mutations use the
  authenticated SvelteKit HTTP boundary.
- Spoke sites request checkout through the signed tenant bridge. They do not
  duplicate Stripe order intake or LumaPrints shipment processing.
- External failures and retries are treated as network-boundary behavior, not
  hidden behind speculative in-process abstractions.

## Local development

### Requirements

- Node.js 22 or newer
- pnpm 10.34.5 or newer
- Development credentials for the services exercised by the change

### Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

The example environment file groups the required application, Convex, auth,
Sanity, Stripe, Resend, LumaPrints, gallery-worker, Turnstile, and observability
configuration. Keep real credentials in local or provider-managed secret
stores; never commit them.

Use Stripe test credentials and `LUMAPRINTS_USE_SANDBOX=true` for local work.
Convex development commands run from `packages/crm-api/`, whose deployment
configuration lives in `packages/crm-api/.env.local`.

## Verification

Run the checks relevant to the changed boundary before opening or merging a
pull request:

```bash
pnpm lint
pnpm check
pnpm test
pnpm --filter @jessepomeroy/print-catalog check
pnpm --filter @jessepomeroy/print-catalog test
pnpm --filter @jessepomeroy/crm-api exec tsc -p tsconfig.json --noEmit
```

Use `pnpm build` when production bundling is relevant. End-to-end and focused
smoke checks are available through the scripts in `package.json` and should be
run when their flows are affected.

## Documentation

- [AGENTS.md](AGENTS.md) — canonical repository rules and implementation constraints
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — current ownership, dependencies, authentication, and transport boundaries
- [LUMAPRINTS.md](LUMAPRINTS.md) — current print-fulfillment integration
- [packages/crm-api/README.md](packages/crm-api/README.md) — shared Convex package and release workflow
- [docs/archive/README.md](docs/archive/README.md) — historical documents retained for context only

Documents under `docs/archive/` are historical and must not be used as current
implementation guidance.
