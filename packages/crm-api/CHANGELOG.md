# @jessepomeroy/crm-api

## 2.25.1

### Patch Changes

- edc09db: Add the bounded internal snapshot and pre-mutation identity/decoder-policy guards used to verify the three-object private catalog schema-2 acceptance canary.

## 2.25.0

### Minor Changes

- 32d07c6: Add immutable target authority indexing and stable-ID V2 private catalog re-attestation over verified V1 targets.

## 2.24.0

### Minor Changes

- 5d22037: Add an opt-in V2 private catalog receipt contract for complete Sharp/libvips raster evidence while preserving V1 receipt identities and safe ZIP inspection compatibility.

## 2.23.0

### Minor Changes

- e414c13: Add an authenticated, revision-aware query for bounded, editor-safe private catalog asset candidates without exposing storage identity or capabilities.

## 2.22.0

### Minor Changes

- dc4ca2a: Add an authenticated, optimistic-concurrency mutation that replaces one existing private catalog draft relation with an already verified tenant asset while retaining immutable revision history.

## 2.21.2

### Patch Changes

- d22c4a8: Expose a read-only catalog graph retirement eligibility query that proves retained rows and cleanup candidates without deleting catalog assets.

## 2.21.1

### Patch Changes

- ecead9c: Fail closed when V1 catalog list rows no longer own their tenant-wide product key or slug indexes.

## 2.21.0

### Minor Changes

- 81a9a38: Enforce tenant catalog product-kind capabilities across V1 and V2 editor catalog reads, writes, imports, and draft operations.

## 2.20.0

### Minor Changes

- b6ef441: Add a validated server-owned catalog product-kind capability policy and an idempotent operator backfill path for platform tenants.

## 2.19.5

### Patch Changes

- 0bc655d: Bind private catalog receipt identities to the tenant and complete canonical asset set.

## 2.19.4

### Patch Changes

- acf17f1: Add purpose-separated, tenant-authenticated receipt coordination for atomic private catalog asset registration.

## 2.19.3

### Patch Changes

- 282c402: Preserve and validate each Sanity catalog asset's own identity and revision in migration manifests.

## 2.19.2

### Patch Changes

- 7a33649: Add a pure deterministic Sanity-to-V2 catalog graph candidate planner with exact target mapping, provenance, completeness, and tamper validation. The planner has no transfer, database, import, publication, or provider-switch execution path.

## 2.19.1

### Patch Changes

- 1d8a1c8: Flatten the catalog revision table's V1/V2 document union so Convex can evaluate and deploy the dormant V2 schema, with a regression check for unsupported nested top-level table unions.

## 2.19.0

### Minor Changes

- 626cc13: Add a dormant tenant-scoped V2 catalog graph with typed web media, private print-source, paid-file, print-set, and shop-placement boundaries while preserving the V1 single-print API.

## 2.18.1

### Patch Changes

- 613d0ba: Add a deterministic, read-only adapter and readiness contract for the complete
  Angels Rest Sanity catalog migration.

## 2.18.0

### Minor Changes

- e1717d3: Add a bounded tenant catalog summary query for private single-print authoring.

## 2.17.0

### Minor Changes

- 5e87061: Add a provider-neutral, tenant-scoped single-print catalog foundation with
  authenticated immutable drafts, integer-cent variants, and conflict protection.

## 2.16.0

### Minor Changes

- aaa09d7: Add the operator-only, fixed-batch Sanity Blog draft import with pinned source
  digest, atomic graph creation, explicit migration provenance, and zero-write
  identical replay verification.

## 2.15.0

### Minor Changes

- 5186e63: Add tenant-bound CMS media deletion completion with per-site server credentials,
  idempotent durable tombstones, and delayed-registration protection.

## 2.14.0

### Minor Changes

- aec4a29: Add recoverable Blog and Post content lifecycle mutations for unpublish, archive, and restore, hide archived documents from editor/public lists, and block supporting-content lifecycle changes while active Post revisions reference them.

## 2.13.0

### Minor Changes

- e9fad60: Retain published Author, Category, and Post slug history, require explicit old/new acknowledgement when publishing a URL change, and expose public-safe current-or-redirect slug resolvers for host-owned routing.

## 2.12.0

### Minor Changes

- f4ee466: Add tenant-scoped Post revision graphs with ordered rich-text blocks, media and technical-item placements, dynamic supporting-content references, SEO overrides, publication validation, and integrity-checked public reads.

## 2.11.0

### Minor Changes

- 71b510c: Add tenant-scoped Author and Category documents with immutable drafts, publication, public-safe reads, and active portrait deletion protection.

## 2.10.1

### Patch Changes

- 3eda417: Remove the retired decorative-image and per-page sharing-image fields from the strict CMS contracts after production data migration.

## 2.10.0

### Minor Changes

- 50fc142: Add the tenant-scoped Modeling page revision, media, publication, and public projection contract.

## 2.9.1

### Patch Changes

- 317d2e6: Remove the retired About portrait focal-point field from draft validation, stable serialization, and public projections.

## 2.9.0

### Minor Changes

- f1badd5: Add a tenant-isolated About page revision boundary with ordered, accessible portrait references and a public-safe responsive media projection.

## 2.8.0

### Minor Changes

- 8302705: Add the tenant-scoped Contact & Booking revision and publication boundary.

## 2.7.0

### Minor Changes

- 9b7f0f3: Add the typed Homepage Quote content slot and reusable tenant-scoped editorial revision store.

## 2.6.0

### Minor Changes

- 48740fa: Add a bounded, snapshot-consistent public portfolio projection with ordered placements and public-only media derivatives.

## 2.5.0

### Minor Changes

- e5e02ef: Add bounded editor-safe media library projections and tenant-scoped batch reads
  for portfolio placements.

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
