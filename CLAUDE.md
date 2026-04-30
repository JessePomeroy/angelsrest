See `AGENTS.md` in this directory for the canonical codebase rules, project context, and tech constraints. It covers the Convex setup referenced here — always read `packages/crm-api/convex/_generated/ai/guidelines.md` first for Convex work.

## Multi-tenant: schema ownership (Gap 1, 2026-04-23; relocated Gap 2 Phase 1, 2026-04-30)

The Convex schema and functions live in `packages/crm-api/convex/` and
are **shared across spoke sites** (reflecting-pool, future photographer
clients). Generated types are re-exported through `packages/crm-api`
(`@jessepomeroy/crm-api`) and consumed by spoke sites via `link:` for
local dev or GitHub Packages for prod. The
`.github/workflows/publish-crm-api.yml` workflow hash-diffs
`packages/crm-api/convex/_generated/api.d.ts` on every main-branch push
and auto-bumps + publishes the package when the surface changes.

Practical implications:

- Schema edits happen here. Run `npx convex dev` from
  `packages/crm-api/` (the directory that now owns `convex/`); spoke
  sites pick up the regenerated `_generated/` through the linked
  package immediately (no re-install).
- When a schema change lands on main, the workflow patches
  `@jessepomeroy/crm-api` in GitHub Packages. Spoke sites either re-link
  (dev) or bump their version pin (prod) to consume the new types.
- **Do not edit `packages/crm-api/src/` by hand** — it's pure re-exports
  of `../convex/_generated/*` (within-package). The only reason to
  touch it is to add a new subpath export (e.g. `/server`) or adjust
  publish mechanics.
- `packages/crm-api/tsconfig.json` is type-check-only (`noEmit: true`).
  The real build pipeline (Phase 2 of Gap 2) lives in
  `tsconfig.build.json` and emits to `dist/`. The historical
  "noEmit trap" — caused by `src/*.ts` reaching `../../../convex/` and
  pulling the whole convex tree into tsc's program — was eliminated by
  the Phase 1 relocation; re-exports now stay within the package
  boundary. `.gitignore` keeps belt-and-suspenders patterns
  (`packages/crm-api/convex/**/*.js`, etc.) as a guard against any
  future emit accidentally landing inside the convex source tree.
- Phase 2 (real build) and Phase 3 (changesets + first publish of
  `@jessepomeroy/crm-api@1.0.0`) follow this relocation. Spec:
  `~/Documents/quilt/02_reference/projects/photographer_crm/gap-2-crm-api-first-publish-spec.md`.

## Commit style

Do not add `Co-Authored-By: Claude` (or any AI assistant) trailers to
commit messages. Authorship lives in `git log --author`; the tool used
to write the diff is not part of the commit's identity.
