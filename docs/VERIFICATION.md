# Engineering verification

Use the installed toolchain and lockfile: Node 24.x (CI: 24.22.1), pnpm 10.34.5.
Start with the affected boundary, then run broader gates when shared behavior
changes. These commands run from the repository root. They do not authorize a
package release, backend deployment, provider operation, or handbook update.

## Check scope

| Gate | What it checks | What it does not establish |
|---|---|---|
| `pnpm lint` | Configured Oxlint rules and severities, then Biome's `src/**` and `scripts/**` scope | Full Svelte template linting or general Biome coverage of workspace packages |
| `pnpm check` | SvelteKit route types, application TypeScript, Svelte diagnostics | Complete workspace-package checking or production bundling |
| `pnpm check:packages` | Real-host Admin/CRM public import contract, all CRM API TypeScript, gallery-delivery and print-catalog type checks | Runtime provider compatibility |
| `pnpm test` | Explicit Node script, build-budget, client-integration and release-record tests, application and Convex Vitest tests, then the Admin client protocol suite | Gallery-delivery/print-catalog tests, Worker contracts, browser tests, or provider acceptance |
| `pnpm test:packages` | Gallery-delivery and print-catalog tests, using each package's existing runner | Application integration; Convex tests already run in `pnpm test` |
| `pnpm test:print-contract` and `pnpm test:gallery-upload-contract` | Real host/installed Admin against Worker code with in-memory transport/storage | Deployed Worker behavior or real uploads/orders |
| `pnpm test:browser` | Production components and installed Admin in isolated Vite fixtures | Real authentication, hosted content, server loaders, or provider acceptance |
| `pnpm test:handbook-capture` | Existing capture-helper layout and hidden-content/password regressions against local HTML | Live-site fidelity, general sanitization, or Paper comparison |
| `pnpm test:e2e` | Full SvelteKit site and public server/browser paths | Offline isolation; CI uses live published Convex content |
| `pnpm build` | Production bundling and SvelteKit server/browser import boundaries | Deployment or provider acceptance; configured Sentry credentials can enable source-map uploads |
| `pnpm check:build-budget` | The built Vercel output against measured size limits | Runtime speed or provider readiness; requires `pnpm build` first |

`check:packages` and `test:packages` are the same package commands used by
[CI](../.github/workflows/ci.yml). They provide a shared local entry point without
changing the scope of `pnpm check` or `pnpm test`. CI also enforces CRM Changesets,
rejects direct package-version changes outside its release flow, and checks that
the retired public platform checkout route remains absent.

Biome's Svelte script-block pilot is documented in [the README](../README.md#verification).
The source-based architecture assertions are useful tripwires; the production
build and runtime authorization/transaction tests supply different evidence.
See [architecture safety contracts](contracts/architecture-invariants.md) before
adding another overlapping proof.

## Focused feedback

Use runner filters directly; another full application run is unnecessary for
an isolated package or protocol change:

```zsh
pnpm exec vitest run src/lib/server/__tests__/siteAdminAuthorization.test.ts
pnpm exec vitest run packages/crm-api/convex/invoicePayments.test.ts
pnpm test:protocol src/routes/admin/__tests__/portfolio-identity.client.ts
pnpm --filter @jessepomeroy/gallery-delivery check
pnpm --filter @jessepomeroy/gallery-delivery test src/downloadPlan.test.ts
node --test scripts/content-export.test.mjs
```

The Node script list in `pnpm test` is explicit. When adding a script regression,
wire it into that command or a dedicated CI gate. Capture-helper tests have a
separate gate because they need Chromium; ordinary `pnpm test` does not.

For checks without a configured public backend, supply synthetic endpoints:

```zsh
PUBLIC_CONVEX_URL=https://test.convex.cloud \
PUBLIC_CONVEX_SITE_URL=https://test.convex.site pnpm check
PUBLIC_CONVEX_URL=https://test.convex.cloud \
PUBLIC_CONVEX_SITE_URL=https://test.convex.site pnpm test
```

The application test config substitutes private environment modules; Convex
fixtures use synthetic identities/secrets and in-memory storage. Placeholder
URLs alone do not block networking. For enforced offline execution on Linux,
reuse the invoice verification workflow's existing namespace technique:

```zsh
PUBLIC_CONVEX_URL=https://test.convex.cloud \
PUBLIC_CONVEX_SITE_URL=https://test.convex.site \
unshare -Urn sh -c 'ip link set lo up && pnpm test'
```

This requires user/network namespaces and `ip`. A missing prerequisite is a
verification limitation. Keep provider acceptance separate; do not substitute
production records or credentials. The maintained
[invoice skill](../.agents/skills/verify-angelsrest-invoices/SKILL.md) maps the
ledger, browser, and separately authorized sandbox evidence.

## Browser and Worker prerequisites

Component fixtures run at `127.0.0.1:5196` with strict port selection and no
server reuse. Playwright owns startup and cleanup. For Chromium-only feedback:

```zsh
pnpm test:browser invoice-verification.spec.ts --project=desktop --project=mobile
```

The default browser matrix also includes mobile WebKit and a Firefox project
covering selected desktop regressions. Install the matching browsers for the
selected projects. The existing `pnpm test:browser:container` uses an already
cached, version-matched Playwright image with `--pull=never` and `--network none`;
it defaults to `webkit-mobile` unless projects are supplied. See the
[browser README](../tests/browser/README.md) for fixture scope. Full-site E2E
uses the application server on port 5173: CI exercises the built preview with a
strict port and no reuse; local runs default to the dev server and may reuse an
existing server. Do not treat it as the isolated fixture gate. See the existing
[build-budget guide](BUILD_BUDGETS.md) for measured limits and updates.

Both Worker contract suites need the reviewed Worker source and its dependencies
under `.contract/gallery-worker`. CI checks out the exact revision recorded in
`ci.yml` and installs its lockfile. A fresh host checkout alone is insufficient.
For a missing import under `@print-worker` or `@gallery-worker`, check that source
and dependency setup before diagnosing a product defect. Local setup must use
the reviewed revision, rather than whatever happens to be in a sibling checkout.
No automatic clone, install, or Worker deployment occurs in these test commands.

Only the upload contract supports `GALLERY_WORKER_CONTRACT_ROOT` and the optional
`GALLERY_ADMIN_CONTRACT_SERVER` override. The print contract uses the pinned
`.contract/gallery-worker` path. Overrides are useful for explicitly scoped
upstream compatibility work, but are different evidence from the installed
package/pinned Worker CI proof. Shared package changes still follow the
[release and adoption runbook](runbooks/package-release-and-adoption.md).

When reporting verification, record the command, tool versions, selected
projects/configuration, observed result, and any unavailable boundary. Historical
passes in runbooks are context, not a fresh verification result. Update the
existing invariant proof or verification feature map when a defect teaches a
new lesson; use a new gate only when the existing one cannot observe it.
