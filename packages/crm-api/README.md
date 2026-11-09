# @jessepomeroy/crm-api

Shared Convex API for the photographer CRM platform. It owns the schema and
functions used by Angels Rest and spoke sites such as reflecting-pool.

`convex/_generated/` contains generated outputs; never edit them by hand.
`src/index.ts`, `api.ts`, `dataModel.ts`, and `server.ts` are maintained entry
points that re-export those outputs. Other `src/` modules, including
`invoiceAmounts.ts`, contain hand-maintained domain logic shared by the backend
and host. Schema and function changes belong in `convex/`.

Read `convex/_generated/ai/guidelines.md` before Convex work. Run the installed
Convex CLI from this package, not the repository root. `pnpm exec convex dev`
can update the selected backend; local type checks do not require running it.
Deployment and provider actions still require their own authorization. See the
[verification guide](../../docs/VERIFICATION.md) for local checks and the
[release runbook](../../docs/runbooks/package-release-and-adoption.md) for rollout.

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
