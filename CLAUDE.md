See `AGENTS.md` in this directory for the canonical codebase rules, project context, and tech constraints. It covers the Convex setup referenced here — always read `convex/_generated/ai/guidelines.md` first for Convex work.

## Multi-tenant: schema ownership (Gap 1, 2026-04-23)

The Convex schema and functions in `convex/` are **shared across spoke
sites** (reflecting-pool, future photographer clients). Generated types
are re-exported through `packages/crm-api` (`@jessepomeroy/crm-api`) and
consumed by spoke sites via `link:` for local dev or GitHub Packages for
prod. The `.github/workflows/publish-crm-api.yml` workflow hash-diffs
`convex/_generated/api.d.ts` on every main-branch push and auto-bumps +
publishes the package when the surface changes.

Practical implications:

- Schema edits happen here. Running `npx convex dev` in this repo
  regenerates `convex/_generated/` as usual; spoke sites pick up the
  changes through the linked package immediately (no re-install).
- When a schema change lands on main, the workflow patches
  `@jessepomeroy/crm-api` in GitHub Packages. Spoke sites either re-link
  (dev) or bump their version pin (prod) to consume the new types.
- **Do not edit `packages/crm-api/src/` by hand** — it's pure re-exports
  of `convex/_generated/*`. The only reason to touch it is to add a new
  subpath export (e.g. `/server`) or adjust publish mechanics.
- `packages/crm-api/tsconfig.json` has `"noEmit": true` and `pnpm build`
  is stubbed to a `console.warn`. **Do not undo either** until Gap 2
  wires a real build. Emit trap: `src/*.ts` re-exports from
  `../../../convex/_generated/*`, so tsc pulls every `../../convex/*.ts`
  into its program. With emit enabled, tsc prints TS6059 ("not under
  rootDir") warnings but still writes `.js`/`.d.ts`/`.d.ts.map` next to
  every convex source — ~90 stray files. `npx convex dev` then registers
  both the `.ts` source and the spurious `.js` as separate esbuild entry
  points, cascading into "Two output files share the same path but have
  different contents" and blocking every push. `.gitignore` has
  `convex/*.js` / `convex/**/*.d.ts` patterns as a containment belt if
  the fix is ever unwound.
- First real publish of `@jessepomeroy/crm-api` needs manual intervention
  (sync-convex + a build that emits outside the convex tree). Deferred
  to Gap 2 when a real schema change ships.
