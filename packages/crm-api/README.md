# @jessepomeroy/crm-api

Shared Convex API for the photographer CRM platform. It owns the schema and
functions used by Angels Rest and spoke sites such as reflecting-pool.

**Do not edit `src/` by hand.** It is a small re-export layer over
`./convex/_generated/`. Schema and function changes belong in `./convex/` and
generated files are refreshed by running `npx convex dev` from this package.

## Usage

Install from GitHub Packages (requires `GH_PACKAGES_TOKEN` in `.npmrc`):

```bash
pnpm add @jessepomeroy/crm-api
```

For local development across sibling repositories, link it instead:

```jsonc
// spoke-site/package.json
{
  "dependencies": {
    "@jessepomeroy/crm-api": "link:../angelsrest/packages/crm-api"
  }
}
```

Then import:

```ts
import { api } from "@jessepomeroy/crm-api/api";
import type { Id, Doc } from "@jessepomeroy/crm-api/dataModel";
```

## CMS-5.5e.2c.5 temporary acceptance observer

This temporary interface has exactly two CLI-only `internalQuery` functions.
It is hard-pinned in code to `angelsrest.online`; it is not exported through
`api`, does not accept tenant/range/page arguments, and has no HTTP or browser
route.

```bash
pnpm exec convex run catalogAcceptanceObserver:observeAggregate --prod
pnpm exec convex run catalogAcceptanceObserver:observeCompletedAsset \
  '{"assetId":"<completed browser-safe print/digital target ID>"}' --prod
```

These commands run already-deployed code under Convex administrator authority.
Never add `--push` to an observation command.

`observeAggregate({})` returns only a fixed aggregate projection: counts and
high-water values for the editor operation/capability/effect journal,
coordination, authority, and private target tables; the eight catalog graph
tables and publication pointers; and coarse stored order/fulfillment,
fee-capture, recovery, LumaPrints-submission, tracking, and shipment-email
checkpoints. Each of its 16 indexed reads has one fixed sentinel. The acceptance
ceilings total 1,324 rows plus 16 sentinels, so at most 1,340 documents are read.
Any overflow or platform read-limit failure produces one generic failure, never
a partial count.

Exact scalable counts are impossible with the current schema without forbidden
write-maintained counters. Therefore this aggregate is deliberately temporary
and fail-closed:

1. Quiesce the acceptance window and capture two byte-equal aggregate baselines.
2. Do not increase any bound during that window.
3. Authorize only the separately reviewed completion effect.
4. Capture two byte-equal post observations.
5. Require operations `+1`, capabilities `+3`, effects `+3`, coordinations `+1`,
   authorities `+1`, and exactly one of print or digital targets `+1`.
6. Require the complete catalog, publication-pointer, and commerce projections
   to remain byte-equal. Exact replay must leave the complete projection equal.

Aggregate equality proves only this approved count/high-water/checkpoint
projection; it does not prove arbitrary private-field or provider-side byte
equality.

`observeCompletedAsset({ assetId })` performs only direct or indexed,
constant-work joins. It derives the operation internally and returns the fixed
`verified_unattached` booleans only after proving a verified generation-1
journal, exactly three purpose-separated capabilities and terminal effects, one
schema-2 exact-one coordination/authority/created target, tenant closure, safe
attempts/outcomes, verified registry state, and zero same-tenant product
relations. It never echoes the ID or private facts. Unknown, foreign, corrupt,
duplicate, or attached state gets one identifier-free failure.

External evidence stays separate:

- **Gallery Worker:** coordinator/dispatcher execution, global single-capacity
  behavior, cron health, and Container inspection state.
- **R2:** current object existence, immutable bytes, ETag, bucket state, and
  deletion absence.
- **Sanity:** the authoritative published editorial/catalog manifest, captured
  through a separate read-only plan/export.
- **Vercel:** deployed host commit, route configuration/duration, aliases, and
  rollback by disabling issuer/completion routes.
- **Stripe, LumaPrints, and other providers:** provider-side state. The observer
  covers only their coarse checkpoints stored in Convex.

After evidence capture, remove both observer functions, regenerate the API, and
remove these instructions. The observer adds no schema, index, secret, write,
scheduler, fetch, or logging behavior.

Or, if the spoke site wires up a SvelteKit alias `$convex → @jessepomeroy/crm-api`:

```ts
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
```

## Publishing

Public schema/function changes require a Changeset committed with the code:

```bash
pnpm changeset add
```

`.github/workflows/publish-crm-api.yml` runs the Changesets two-state flow. If
pending Changesets exist, it opens or updates the package-version PR. After that
PR is merged, the next main-branch run publishes the new version to GitHub
Packages. Manual version bumps and generated-file hash checks are not part of
the current release process.

The package intentionally ships TypeScript source to its known Vite/SvelteKit
consumers. `tsconfig.json` is type-check-only; do not introduce a `dist` build
without a concrete non-TypeScript-transpiling consumer.
