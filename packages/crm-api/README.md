# @jessepomeroy/crm-api

Generated Convex API for the photographer CRM platform. Consumed by spoke
sites (reflecting-pool, future clients).

**Do not edit by hand** — the exposed surface is auto-generated from
`angelsrest/convex/` via `npx convex dev`. Changes to the schema or Convex
functions happen in `angelsrest/convex/`; this package simply re-exports the
generated types so downstream sites get a typed handle without running
`convex dev` themselves.

## Usage

Install from GitHub Packages (requires `GH_PACKAGES_TOKEN` in `.npmrc`):

```bash
pnpm add @jessepomeroy/crm-api
```

For local monorepo-style development, link it instead:

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

The `.github/workflows/publish-crm-api.yml` workflow in the angelsrest repo
hashes `convex/_generated/api.d.ts` on every push to `main` and auto-bumps
the patch version + publishes when the hash changes. Manual publishes should
not be necessary in steady state.

First publish requires the `PUBLISH_TOKEN` secret to be set on the angelsrest
repo (write access to GitHub Packages). See the admin-dashboard repo for the
same pattern.
