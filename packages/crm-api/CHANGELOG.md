# @jessepomeroy/crm-api

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
