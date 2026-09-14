# Convex compatibility-stub retirement — 2026-09-04

Status: complete.

This record closes deferred follow-up DF-07. Thirty empty TypeScript modules
remained solely so an older checked-in Convex API declaration could import
historical migration filenames. They exported no functions and held no runtime,
provider, data, or recovery authority.

## Scope and method

- Verified every placeholder had no reference outside its own file and
  `convex/_generated/api.d.ts`.
- Removed 27 empty modules under `packages/crm-api/convex/helpers/` and the three
  matching root placeholders for about/contact, portfolio, and site-settings
  migration modules.
- Ran the official Convex `codegen` command with typechecking disabled for the
  generation step. The generator removed exactly the 30 stale import and module
  entries from `convex/_generated/api.d.ts`.
- Did not hand-edit generated files. No schema, live function, data, secret,
  provider resource, recovery archive, or tenant configuration changed.

The resulting source diff is deletion-only: 30 two-line placeholders and 60
generated declaration lines. Repository checks and package typechecking verify
that no application or published package consumer depended on the empty module
names.
