---
"@jessepomeroy/crm-api": major
---

First published release. Re-exports the generated Convex API surface
(api, dataModel, server) for spoke-site consumption. Replaces the
pre-publish `link:` workflow with a versioned package on GitHub
Packages.

Phase 2 reframed to ship `.ts` source via the `exports` map (see
CLAUDE.md "Multi-tenant: schema ownership"); spokes consume directly
through their Vite/SvelteKit pipeline. `prepublishOnly` runs a
typecheck before each release.
