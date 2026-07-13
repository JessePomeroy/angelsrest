# Architecture

This is the current system map for Angels Rest. `AGENTS.md` remains the
canonical rule file; this document explains ownership and dependency direction.

## Dependency direction

```text
SvelteKit routes and UI
  ├── Sanity client (editorial reads / preview)
  ├── Convex generated API (operational reads and writes)
  ├── @jessepomeroy/admin (shared admin UI and host adapters)
  ├── @jessepomeroy/print-catalog (pure shared print domain)
  └── server integrations (Stripe, LumaPrints, Resend, gallery worker)

packages/crm-api
  └── Convex schema, functions, and generated public API

packages/print-catalog
  └── pure catalog and pricing data/functions
```

Packages do not import the SvelteKit host. Browser code does not import server
modules or private environment variables.

## Data ownership

| Domain | Owner | Entry points |
|---|---|---|
| Portfolio galleries, products, collections, blog, about, settings, contact copy | Sanity | `src/lib/sanity/client.ts`, `client.server.ts`, public load functions |
| Orders and fulfillment state | Convex | `packages/crm-api/convex/orders.ts` |
| Inquiries | Convex | `packages/crm-api/convex/inquiries.ts`, `/api/contact` |
| CRM, board, invoices, quotes, contracts | Convex | matching Convex modules |
| Platform tenants and connected Stripe accounts | Convex | `platform.ts`, `authHelpers.ts` |
| Private delivery galleries and image metadata | Convex | `galleries.ts`, `portal.ts` |
| Private gallery objects and prepared downloads | Cloudflare R2 | gallery worker via shared admin handlers |
| Print catalog metadata | `@jessepomeroy/print-catalog` | `packages/print-catalog/src/` |

“Portfolio gallery” and “delivery gallery” are separate domains. Use the full
name when an unqualified `gallery` would obscure the owner.

## SvelteKit boundary

- `+page.server.ts` and `+server.ts` compose remote clients and enforce HTTP
  boundary validation.
- `.server.ts` modules contain preview tokens and other private-only logic.
- Public `.svelte` components consume serialized load data or browser-safe API
  clients.
- `src/hooks.server.ts` owns security headers, Sanity preview state, and server
  error capture. Admin authentication lives in the admin layout and auth routes,
  not in the global hook.

### Public inquiry boundary

1. The contact form renders the shared Cloudflare Turnstile widget and submits
   its short-lived response token with the form payload.
2. `/api/contact` validates the payload and sends the token plus client IP to
   the managed siteverify Worker before any email or Convex side effect.
3. A successful route call forwards the server-only `WEBHOOK_SECRET` to
   `inquiries.create`; direct public Convex callers are rejected.
4. The public widget key and Worker URL live in `src/lib/config/turnstile.ts`.
   The widget secret exists only as the Worker's `TURNSTILE_SECRET_KEY` binding.

Future client contact forms may share the managed Worker, but their production
hostnames must first be added to the widget. Browser-only verification is not a
security boundary; keep verification inside the host route.

## Admin architecture

1. Better Auth establishes the browser session.
2. `src/routes/admin/+layout.server.ts` validates the session and checks the
   authenticated email against the host site's stored `adminEmails` membership
   before child server loads return sensitive data.
3. `src/routes/admin/+layout.svelte` authenticates the Convex WebSocket through
   `setupAuth`, driven by the server-validated layout state.
4. Queries use the authenticated WebSocket.
5. Mutations use `/api/admin/mutation`, which validates the cookie and creates a
   fresh authenticated `ConvexHttpClient` for the request.
6. Convex functions enforce site or creator membership through
   `requireSiteAdmin`, `requireDocumentSiteAdmin`, or `requireCreator`.
7. Shared server handlers, including gallery-worker/R2 operations, call the
   host's per-request site-admin verifier before performing side effects.

Authenticated server reads also create a fresh client through
`createAuthenticatedConvexClient`. The cached `getConvex()` client is reserved
for unauthenticated or server-secret call paths and must never receive
request-specific auth through `setAuth`.

The manual WebSocket setup exists because an older Better Auth adapter could
pause auth during SvelteKit navigation. Treat transport changes as auth changes
and test full client-side navigation, expiry, logout, and concurrent requests.

## Commerce and fulfillment

### Shop checkout

1. The selling site resolves current product/catalog data; browser-supplied
   prices are not authoritative.
2. Angels Rest creates its own Checkout directly. Client spokes call the signed
   `/api/tenant-checkout/print` bridge using their stored bare-domain tenant key.
3. The hub resolves the canonical stored tenant before selecting its
   `CHECKOUT_BRIDGE_TENANTS` entry. Each tenant has independent signing secrets
   and explicit success/cancel redirect origins; two secrets are allowed only
   during bounded rotation. A spoke credential cannot authorize another tenant.
4. After signature and redirect validation, the hub stamps the tenant's
   bare-domain key into reserved Session and PaymentIntent metadata, then creates
   Checkout on the connected account or the platform account during an
   explicitly supported pre-handoff phase.
5. Stripe sends platform and connected-account commerce events to this
   repository's `/api/webhooks/stripe`; client spokes do not own a parallel
   `checkout.session.completed` processor.
6. The webhook verifies the raw signed body. `orderIntake.ts` resolves
   `event.account` back to the stored tenant when present; platform-account
   events use the server-owned metadata key and a webhook-secret-protected
   Convex profile lookup. Conflicting or unknown tenant identities fail closed.
7. `webhookOrders.ts` creates or reuses the Convex order and schedules fee
   capture outside the webhook hot path.
8. Eligible items go through `printFulfillment.ts` and LumaPrints.
9. Notifications are sent through Resend with the resolved tenant's name,
   public origin, and admin recipient. The shared `orders@angelsrest.online`
   mailbox remains the transport sender until per-tenant verified sending
   domains are deliberately onboarded.

This is a runtime ownership boundary, not merely shared code: one Stripe event
must have exactly one order-intake owner. Future Stripe Connect clients add
tenant configuration and use the bridge; they do not copy the webhook
coordinator into their repositories.

### LumaPrints shipment webhook

`/api/webhooks/lumaprints` is the single shipment-intake owner for hub and spoke
orders. It verifies the provider's configured Basic credentials, accepts the
documented top-level shipping payload, and resolves the provider-global
LumaPrints order number to exactly one stored tenant before updating tracking or
sending branded email. Client spokes do not receive the broad Convex webhook
secret or run a second shipment processor.

### Invoice checkout

`/api/invoice/checkout` creates payment sessions for token-authorized invoice
flows. Invoice settlement is dispatched by the commerce webhook and recorded in
Convex. Amounts are integer cents across the Stripe boundary.

### Customer order lookup

The hub is the public lookup broker. Convex exposes a bounded customer view only
through a query protected by the dedicated hub-only `ORDER_LOOKUP_SECRET`; this
capability is separate from the broader webhook bearer and is never distributed
to a client spoke or browser. No unauthenticated Convex customer-order lookup is
exposed.

### Platform subscriptions

`/api/platform/webhooks/stripe` is separate from the commerce webhook. It owns
CRM subscription state rather than shop orders or invoice settlement. CRM tier
onboarding is operator-controlled; no public self-service subscription-session
creator is exposed. A future self-service flow would require a
tenant-authenticated billing bridge that derives tenant, billing identity, and
redirect authority server-side.

## Convex organization

- `schema.ts` defines the shared platform schema.
- Public functions validate every argument and derive identity through Convex
  auth.
- Tenant data is always checked against stored site membership; a caller-supplied
  `siteUrl` is not authorization.
- Webhook-callable public functions require the shared webhook secret or an
  authenticated authorized caller.
- Queries use indexes and bounded reads. Use pagination or durable aggregates
  when a bounded result cannot truthfully represent a complete result.
- Node-only external SDK work belongs in `"use node"` actions; database changes
  remain in queries/mutations.

Read `packages/crm-api/convex/_generated/ai/guidelines.md` before Convex work.

## Package release boundaries

`@jessepomeroy/crm-api` ships TypeScript re-exports and the Convex source/type
surface to known Vite/SvelteKit consumers. It is intentionally type-check-only;
there is no `tsconfig.build.json` or emitted `dist` requirement.

Public Convex/schema changes require a changeset:

```bash
pnpm changeset add
```

The publish workflow uses Changesets to open a version PR and publishes after
that PR is merged. It no longer hashes generated declarations or auto-increments
every API change.

## Documentation policy

- `AGENTS.md`: canonical implementation rules and checks.
- `docs/ARCHITECTURE.md`: current system ownership and flows.
- `LUMAPRINTS.md`: current print integration details.
- Package READMEs: package-specific consumption/release instructions.
- `docs/archive/`: historical context only. Archived documents must carry a
  warning and must not be cited as current implementation guidance.

Update the smallest authoritative document when a boundary changes. Do not copy
the same workflow into multiple root files.

## Platform repositories

| Repository | Responsibility | Direction |
|---|---|---|
| `angelsrest` | Public creator site, platform hub, shared Convex/package owner | Composition root |
| `angelsrest-studio` | Angel's Rest Sanity instance | Downstream of Studio template |
| `reflecting-pool` | Maggie's client spoke and tenant admin host | Consumes shared packages/services |
| `reflecting-pool-studio` | Maggie's Sanity instance | Downstream of Studio template |
| `sanity-studio-template` | Shared Studio schemas, desk, components, and actions | Upstream for client Studios |
| `admin-dashboard` | Source for `@jessepomeroy/admin` client/server package | Upstream for host admin UI/adapters |
| `gallery-worker` | Shared Cloudflare Worker, R2, and prepared ZIP boundary | Called through host/admin adapters |

Cross-repository contract changes land in the owning upstream first, then flow
to each affected consumer with repository-specific checks.
