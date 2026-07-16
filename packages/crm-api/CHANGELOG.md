# @jessepomeroy/crm-api

## 2.4.0

### Minor Changes

- b32769e: Add tenant-scoped portfolio gallery drafts, immutable ordered placements,
  accessibility-gated publication, and public-safe portfolio reads.

## 2.3.0

### Minor Changes

- bf0b8e2: Add tenant-scoped CMS media assets with canonical Worker-key validation,
  paginated library reads, and a retryable usage-aware deletion lifecycle.

## 2.2.0

### Minor Changes

- 225aeea: Expose the opaque published Site settings revision ID and publication time alongside the public-safe payload for provider telemetry and rollback diagnosis.

## 2.1.0

### Minor Changes

- 103f7f1: Add a typed, tenant-scoped Site settings CMS foundation with immutable drafts,
  atomic publication, public-safe reads, and conflict protection.

## 2.0.0

### Major Changes

- 69023db: Remove the deprecated unauthenticated `orders.lookup` query. Customer order lookup must use the hub broker and the dedicated server-authorized `orders.lookupForCustomer` query.

## 1.9.0

### Minor Changes

- c8d9446: Add a dedicated server-authorized customer order lookup query with duplicate-order fail-closed behavior.

## 1.8.0

### Minor Changes

- af836dc: Add hub-owned, provider-global LumaPrints shipment claim and delivery checkpoint functions.

## 1.7.0

### Minor Changes

- 5a46272: Add durable pending, captured, and failed checkpoints for asynchronous Stripe fee capture, including delayed connected-account routing.

## 1.6.0

### Minor Changes

- 1cb077c: Add optional gallery password protection with server-side scrypt verifiers, short-lived access grants, throttled verification, and grant enforcement across gallery reads, favorites, previews, and downloads.

## 1.5.1

### Patch Changes

- 468c2a5: Disclose truncated unread counts and drain mark-read operations in bounded batches.

## 1.5.0

### Minor Changes

- c447b31: Add cursor-paginated message history and platform conversation queries.

## 1.4.0

### Minor Changes

- 45c37f9: Expose order-stat scan limits and truncation state so consumers can distinguish partial totals from complete all-time metrics.

## 1.3.7

### Patch Changes

- 7d9c037: Allocate quote numbers authoritatively inside quote creation and share one per-site document-number boundary with invoices.

## 1.3.6

### Patch Changes

- a448d89: Allocate invoice numbers authoritatively inside invoice-creation mutations, including quote conversion, with per-site counters that bootstrap from existing invoices.

## 1.3.5

### Patch Changes

- b376759: Add a webhook-authenticated commerce notification profile lookup for platform-account tenant events.

## 1.3.4

### Patch Changes

- 7206096: Require the shared server webhook secret for inquiry creation so public clients cannot bypass the host's contact-form validation and abuse controls.

## 1.3.3

### Patch Changes

- 15a5817: Expose durable print-fulfillment recovery state so webhook hosts can resume idempotent Stripe refunds without repeating LumaPrints submission.
- a675488: Declare the Stripe runtime dependency required by the shipped Convex fee-capture action so clean downstream installations type-check and deploy without relying on a host dependency.

## 1.3.2

### Patch Changes

- 2df47b6: Add shipment email delivery-state recording for LumaPrints webhook consumers.

## 1.3.1

### Patch Changes

- c07bb54: Reject duplicate LumaPrints order numbers in the legacy order lookup query instead of returning the first match.

## 1.3.0

### Minor Changes

- 2864720: Add an atomic LumaPrints shipment email claim mutation so spoke sites can avoid duplicate customer shipment emails across concurrent webhook deliveries.

## 1.2.0

### Minor Changes

- Add `galleries.listImageStorageKeys`, a tenant-scoped paginated query for
  gallery storage cleanup flows. This lets spoke admin dashboards delete all
  R2 objects for large galleries before removing Convex metadata.

## 1.1.0

### Minor Changes

- 23eef83: Add shared-Convex tenant hardening helpers: creator-role platform authorization, trusted-origin discovery from platform clients, and platform client role metadata.

## 1.0.0

### Major Changes

- 723c2a1: First published release. Re-exports the generated Convex API surface
  (api, dataModel, server) for spoke-site consumption. Replaces the
  pre-publish `link:` workflow with a versioned package on GitHub
  Packages.

  Phase 2 reframed to ship `.ts` source via the `exports` map (see
  CLAUDE.md "Multi-tenant: schema ownership"); spokes consume directly
  through their Vite/SvelteKit pipeline. `prepublishOnly` runs a
  typecheck before each release.
