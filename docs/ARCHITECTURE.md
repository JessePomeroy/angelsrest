# Architecture

This is the current system map for Angels Rest. `AGENTS.md` is the canonical
repository rule file. Stable safety rules live in
[`contracts/architecture-invariants.md`](contracts/architecture-invariants.md),
and operating procedures live under [`runbooks/`](runbooks/).

## Dependency direction

```text
SvelteKit routes and UI
  ├── Convex generated API (published content and operations)
  ├── @jessepomeroy/admin (shared Admin UI and host adapters)
  ├── @jessepomeroy/print-catalog (pure print domain)
  └── server integrations (Stripe, LumaPrints, Resend, R2 Workers)

packages/crm-api
  └── Convex schema, functions, and generated public API
```

Packages do not import the SvelteKit host. Browser code does not import server
modules or private environment variables.

## Ownership

| Domain | Owner |
|---|---|
| Published editorial content, Shop catalog, Editor drafts, and media registry | Convex |
| Orders, inquiries, CRM, documents, platform tenants, and delivery-gallery metadata | Convex |
| Editor sources and public WebP derivatives | Cloudflare R2 through the CMS media Worker |
| Private catalog and delivery-gallery bytes | Cloudflare R2 through purpose-scoped Worker boundaries |
| Print catalog data and pricing rules | `@jessepomeroy/print-catalog` |
| HTTP composition, authentication, webhooks, and provider orchestration | SvelteKit hub |

Portfolio galleries are public content. Delivery galleries are private client
records and R2 objects. Use the full names when the distinction matters.

Sanity is not application infrastructure. Executable clients, preview/provider
routes, migration entry points, dependencies, and historical purchase readers
are retired. `sanityImport` and `provider: "sanity"` values on migrated Convex
rows are inert lineage, and the external archive is historical evidence only.
The read-only external inventory and unapproved cleanup allowlist are recorded
in
[`migrations/sanity-external-inventory-2026-09-03.md`](migrations/sanity-external-inventory-2026-09-03.md).

## Host boundary

- Server routes compose integrations and validate transport inputs.
- `.server.ts` modules own private-only integration logic.
- Browser modules consume serialized data or browser-safe clients.
- `src/hooks.server.ts` owns security headers and server error capture.
- `src/lib/server/runtimeConfig.ts` validates each integration only when used;
  unrelated routes do not require unrelated provider configuration.

`src/lib/server/current/` contains Convex-only public content, Shop, and checkout
authority. It cannot import recovery, migration, compatibility, or Sanity code.
`src/lib/server/recovery/` contains authenticated reconciliation orchestration
and is never a public-read or browser dependency.

## Admin

Better Auth establishes identity; stored Convex tenant membership authorizes
Admin access. `src/routes/admin/+layout.server.ts` checks both before child
loaders return sensitive data. Convex functions independently enforce site or
creator membership.

Browser queries use the authenticated Convex WebSocket. Mutations use
`/api/admin/mutation`, which validates the cookie and creates a fresh
authenticated HTTP client. `createAdminBrowserCapabilities` forbids server-only
document-email functions; the `.server.ts` capability extension supplies them
only to authenticated handler factories.

Shared Admin handlers must call the host's per-request site-admin verifier
before Worker, R2, email, or other effects. Request-specific auth must never be
set on the cached public Convex client.

## Public content and media

Published content modules resolve accepted Convex revisions and immutable
public derivatives. Editor uploads use a short-lived tenant-bound Worker
capability, then an authenticated process route registers the derivative set in
Convex. Browser requests never receive R2 or Worker credentials.

Portfolio-gallery deletion records a permanent slug tombstone. Media deletion
uses a tenant-bound Convex manifest, deletes exact Worker objects, and completes
the retained Convex tombstone. Private delivery-gallery media uses its separate
Worker/R2 protocol.

## Private capabilities

`/portal/*` and `/delivery/*` URLs are bearer capabilities. Responses are
private/no-store, noindex, nofollow, noarchive, and no-referrer. Analytics omits
these paths; browser and server telemetry scrub current and retained capability
URLs.

Document portal hosts read `portal.getPublicByToken`, which returns explicit
client-safe projections. Raw invoice, quote, contract, provider, signature, and
internal fields do not cross the public boundary. Used links remain readable
only for the same marker-backed quote acceptance/decline or contract signature;
used invoice, legacy, rotated, and revoked links fail closed. Delivery-gallery
query shape remains separate.

## Commerce and fulfillment

`current/convexShop.server.ts` owns bounded published-product reads and
normalized 404/503 behavior. Shop loaders do not inspect preview or provider
flags. `current/currentCheckoutCommerce.server.ts` resolves every new purchase
from Convex and reserves a Convex handle-v2 snapshot before Stripe. Checkout,
fulfillment, and downloads accept only that current snapshot contract.

The Angels Rest hub is the sole order-intake and shipment-intake runtime:

- `/api/webhooks/stripe` owns payment-mode commerce events for the hub and
  connected tenants.
- `/api/platform/webhooks/stripe` owns platform subscription state only.
- `/api/webhooks/lumaprints` owns LumaPrints shipment updates and notification.
- Client spokes may use the signed checkout bridge but do not run duplicate
  commerce or shipment webhooks.

Tenant identity is derived from verified connected-account scope or
server-stamped checkout metadata, never browser input. Provider work and
notifications use durable claims, bounded leases, stable idempotency keys, and
explicit completion or uncertainty states. The stable cross-runtime contract is
documented in [`contracts/commerce-intake.md`](contracts/commerce-intake.md).

Manual refunds are reconciled from signed Stripe events and exact provider
evidence. Partial, ambiguous, or conflicting evidence fails closed; absence is
never proof that a provider action did not happen. Operator procedure and
rollback order live in
[`runbooks/manual-refund-reconciliation.md`](runbooks/manual-refund-reconciliation.md).

## Email and inquiries

`/api/contact` validates Turnstile through the managed Worker, then creates the
Convex inquiry before attempting the owner notification. Notification failure
cannot erase the saved inquiry. Direct public writes to `inquiries.create` are
rejected.

Invoice, quote, and contract emails freeze their recipient, subject, HTML,
plain text, portal capability, provider key, and tags in a durable Convex
attempt. A per-document open-attempt fence converges tabs and retries. Provider
acceptance, definite failure, uncertainty, and operator resolution are distinct
states. Browser recovery receives a sanitized, private/no-store projection.

## Convex and package release

Convex public functions validate arguments, derive authenticated identity, and
check stored tenant membership. Webhook functions require their purpose secret.
Queries use indexes and bounded reads. Node-only SDK work belongs in `"use
node"` actions; database changes remain in queries or mutations.

Generated Convex files are never edited by hand. Read
`packages/crm-api/convex/_generated/ai/guidelines.md` before Convex work and use
the sanctioned code-generation flow. Public schema or function changes require
a Changeset and a mixed-version-safe rollout.

Package publication, exact-version host adoption, and runtime deployment are
separate approval gates. The ordered procedure and per-runtime rollback paths
are in [`runbooks/package-release-and-adoption.md`](runbooks/package-release-and-adoption.md).

## Documentation

- `AGENTS.md` — canonical repository rules and checks.
- `docs/ARCHITECTURE.md` — concise current ownership and dependency map.
- `docs/contracts/` — stable cross-boundary behavior and invariant evidence.
- `docs/runbooks/` — current operator procedures and incident response.
- `docs/migrations/` — completed migration narratives and source-bound records.
- `docs/archive/` — superseded historical context only.
- Package READMEs — package-specific consumption and release instructions.

Update the smallest authoritative document when a boundary changes and link to
it instead of copying the workflow into multiple files.

## Repositories

| Repository | Responsibility |
|---|---|
| `angelsrest` | Public site, platform hub, Convex/package owner, composition root |
| `admin-dashboard` | Source for the shared `@jessepomeroy/admin` package |
| `gallery-worker` | Independent delivery-gallery and CMS-media Worker runtimes |
| `reflecting-pool` | Deferred spoke consuming shared packages and services |

Cross-repository contracts land in the owning upstream first, then flow to each
affected consumer with repository-specific checks.
