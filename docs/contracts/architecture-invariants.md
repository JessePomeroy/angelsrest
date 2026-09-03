# Architecture safety contracts

These are the few repository rules whose violation would materially damage
authority, privacy, or external-effect safety. The table names one primary proof
for each rule so later work strengthens or replaces that proof instead of
building overlapping suites.

| Invariant | Primary proof |
|---|---|
| Current Shop and checkout have no Sanity authority | `src/lib/server/__tests__/architectureInvariants.test.ts` |
| Browser-reachable modules have no private environment access | `src/lib/server/__tests__/architectureInvariants.test.ts` plus SvelteKit build |
| This hub alone owns Stripe order intake and LumaPrints shipment intake | `src/lib/server/__tests__/architectureInvariants.test.ts` |
| Admin server access requires stored site membership, not identity alone | `src/lib/server/__tests__/siteAdminAuthorization.test.ts` and `src/routes/admin/__tests__/layout-server.test.ts` |
| Public document portals use client-safe projections | `src/lib/server/__tests__/architectureInvariants.test.ts` and portal projection tests |
| External effects use durable claim and idempotency protocols | `documentEmailAttempts.test.ts`, `lumaprintsWebhook.test.ts`, and focused order-intake tests |
| Current runtime cannot import migration, compatibility, or recovery code | `src/lib/server/__tests__/architectureInvariants.test.ts` |
| Generated Convex files are regenerated, never hand-edited | generator markers checked by `architectureInvariants.test.ts`; code-generation procedure in `packages/crm-api/README.md` |

## Contract details

The Shop and checkout authority lives under `src/lib/server/current/`, reads
Convex only, and does not accept a provider selector. Browser code may use only
explicitly public environment values. Server secrets stay under `.server.ts`,
server routes, or `src/lib/server/`.

Only `/api/webhooks/stripe` may import the commerce order-intake coordinator,
and only `/api/webhooks/lumaprints` may import the shipment-intake coordinator.
Subscription billing remains a separate Stripe route and domain. Spokes request
checkout through the signed bridge; they do not reproduce either intake path.

Admin authentication and tenant authorization are separate checks. A valid
Better Auth token without stored site membership returns unauthorized. Public
portal loaders call `portal.getPublicByToken`; raw document query shapes are not
valid browser contracts.

An external effect with an automatic or ambiguous retry path must be preceded
by its durable claim and reuse its frozen provider idempotency key. Ambiguous
completion remains uncertain and does not authorize a fresh effect. A
best-effort secondary notification may instead be deliberately non-retryable
after its authoritative local record is durable.

Convex generated files carry their generator marker and are refreshed only by
the sanctioned Convex code-generation command. Generated diffs are reviewed as
outputs, not used as an editing surface.
