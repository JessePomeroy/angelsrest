See `AGENTS.md` in this directory for the canonical codebase rules, project context, and tech constraints. It covers the Convex setup referenced here — always read `packages/crm-api/convex/_generated/ai/guidelines.md` first for Convex work.

## Multi-tenant: schema ownership (Gap 1, 2026-04-23; relocated Gap 2 Phase 1, 2026-04-30; Phase 2 reframed 2026-05-01)

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
- `packages/crm-api/tsconfig.json` is type-check-only (`noEmit: true`)
  and stays that way. The historical "noEmit trap" — caused by
  `src/*.ts` reaching `../../../convex/` and pulling the whole convex
  tree into tsc's program — was eliminated by the Phase 1 relocation;
  re-exports now stay within the package boundary. `.gitignore` keeps
  belt-and-suspenders patterns (`packages/crm-api/convex/**/*.js`, etc.)
  as a guard against any future emit accidentally landing inside the
  convex source tree.
- **Phase 2 outcome (Plan B, 2026-05-01).** The original spec called
  for emitting a `dist/` of `.js` + `.d.ts` artifacts, with `exports`
  pointing at the built output. Attempting it surfaced TS2742 — pnpm's
  hoisted `node_modules/.pnpm/...` layout makes Convex's complex
  `query()` / `createClient()` return types unnameable when tsc tries
  to emit declarations. The fix would be explicit type annotations on
  every Convex query/mutation/action export (~30+ spots), which Convex
  itself documents as anti-pattern. Given the consumer set is fully
  Vite-based (every spoke site is SvelteKit), shipping `.ts` source
  via the existing `exports` map works and is reasonable for a
  **private** GitHub Packages library with a known narrow consumer
  set. So Phase 2 reduces to: keep `exports` pointing at `src/*.ts`,
  ship `files: ["src", "convex"]`, run `tsc --noEmit` as
  `prepublishOnly` to typecheck before publish. If a future consumer
  arrives that can't transpile `.ts` (Node service, non-Vite framework),
  revisit then with a concrete use case driving the design. Track in
  `~/Documents/quilt/02_reference/projects/photographer_crm/
  gap-2-crm-api-first-publish-spec.md`.
- **Phase 3 (changesets + first publish of
  `@jessepomeroy/crm-api@1.0.0`)** is unchanged by the Phase 2
  reframe — it still adopts the changesets workflow, replaces the
  hash-diff publish trigger, and cuts a clean 1.0.0.

## Schema-change workflow (post Gap 2 Phase 3)

Whenever you modify Convex schema or function signatures in
`packages/crm-api/convex/`:

1. Make the schema/function change. `npx convex dev` (run from
   `packages/crm-api/`) regenerates `_generated/`.
2. Run `pnpm changeset add` from the repo root.
   - Select `@jessepomeroy/crm-api`.
   - Choose bump level by impact:
     - `patch` — internal helper changes, no public type changes.
     - `minor` — new public functions, new fields on existing
       documents (additive).
     - `major` — renames, removals, return-type changes (breaking).
   - Write a 1–2 sentence summary describing the change.
3. Commit the `.changeset/*.md` alongside the schema diff.
4. Push to main. CI's `publish-crm-api` workflow opens (or updates) a
   "chore(crm-api): version packages" PR.
5. Review + merge the version PR. CI re-fires; the changesets/action
   publishes the new version to GitHub Packages automatically.

Spoke sites pin to `^1.0.0`-style ranges and pick up minor/patch
updates via Dependabot. Major bumps require coordinated upgrade.

The publish workflow uses the auto-injected `secrets.GITHUB_TOKEN`.
The workflow-level `permissions:` block grants `contents: write`,
`packages: write`, and `pull-requests: write` — enough for the
changesets/action two-state machine. The "GITHUB_TOKEN can't trigger
downstream workflows" rule doesn't bite us because the version-PR is
merged by a human via the GitHub UI, and that merge-commit push
triggers the publish run normally. No PAT required.

## Commit style

Do not add `Co-Authored-By: Claude` (or any AI assistant) trailers to
commit messages. Authorship lives in `git log --author`; the tool used
to write the diff is not part of the commit's identity.
