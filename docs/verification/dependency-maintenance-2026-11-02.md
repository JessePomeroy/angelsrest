# Dependency maintenance — November 2, 2026

This maintenance starts from hub `54d3549185a00be4f149e94540ddb6c5e450684c`,
Admin `d03fa84eb7b07a5b62151c77b40379b6ffba7e33`, and Worker
`c496745ba0c137db7ad959b934064e0398d5b93c`. The separate, uncommitted Gmail
worktrees and all other original worktrees remain preserved in place.

## Compatible updates

- Better Auth 1.6.34 stays inside the Convex integration's supported
  `>=1.6.11 <1.7.0` peer range. The integration moves to 0.12.6 and its
  required Convex SDK is updated with the matching local verification tooling.
- Vite 7.3.7, Vitest 4.1.12, Undici 7.30.1, Sharp 0.35.5, Zod 4.6.7,
  source-map-js 1.2.2, launch-editor 2.14.2, and shell-quote 1.11.0 replace
  affected installed versions. Workspace test dependencies are updated together.
- The Vercel tracer and Sentry build plugin receive scoped `glob` 14.0.3
  overrides. Both consumers use its public asynchronous `glob()` interface.
  The replacement brings the matching Minimatch 11 dependency; no global
  Minimatch override is used because version 11 removed APIs used by older callers.
  Production bundling and representative real-consumer tracing must pass before
  release. Remove these overrides when their upstream ranges admit the fix.
- HTTP integration tests normalize function references through Convex's public
  `getFunctionName`/`makeFunctionReference` APIs when forwarding to convex-test.
  The SDK also accepts a new reference type which convex-test does not type yet.
  This retains the original function name and arguments without an unsafe cast
  or a replacement mock of the backend.
- Bundle the Convex auth entrypoints so the host's cookie/client helpers can
  be tree-shaken separately from the Convex-owned auth server. The updated
  external packages otherwise raised aggregate function output to 284,443,427
  bytes. Final output is 204,106,374 bytes under the unchanged 275,200,000-byte
  gate. The six actual Vercel function bundles import successfully; the built
  mutation route rejects missing and invalid cookies without real network I/O.

## Remaining advisory applicability

The package audit remains nonzero. No advisory is suppressed by configuration.
These dispositions apply to the inspected hub and Admin source, not to arbitrary
consumers or future feature changes.

| Advisory | Evidence and disposition |
| --- | --- |
| [Better Auth Magic Link](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm) | The hub enables password and Google login with only the Convex plugin. Magic Link is absent, so the required vulnerable flow is unavailable. |
| [Better Auth OAuth Proxy](https://github.com/better-auth/better-auth/security/advisories/GHSA-r4xp-prcw-77qf) | OAuth Proxy is absent. Ordinary Google callbacks and Gmail's separate consent do not enable that plugin. |
| [Better Auth device authorization](https://github.com/better-auth/better-auth/security/advisories/GHSA-q84f-53jg-9ppm) | The device-authorization plugin and its approval/token flow are absent. |
| [Better Auth PostgreSQL rate limiting](https://github.com/better-auth/better-auth/security/advisories/GHSA-44jh-23m7-hpcf) | The hub uses the Convex adapter, not PostgreSQL through Drizzle/Kysely. Transitive adapter packages alone do not establish that path. |
| [SvelteKit enhanced-form redirect](https://github.com/sveltejs/kit/security/advisories/GHSA-pfhg-q3qv-9q6r) | Neither host nor shared Admin source imports `$app/forms` or uses `use:enhance`. The required enhanced-form flow is absent. |
| [SvelteKit prerender header injection](https://github.com/sveltejs/kit/security/advisories/GHSA-27mw-82g8-phjj) | The host does not enable page prerendering or forward untrusted cache-control values into prerendered pages. |
| [deepmerge prototype poisoning](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | The dependency is used by the Svelte Vite plugin to merge developer-owned build configuration. No request/email content reaches that configuration merge. There is no published patched version in the reviewed advisory. |

The Admin package does not own a live auth server; its Better Auth dependency is
a development fixture. Reassess before adding any affected auth plugin, changing
the database adapter, introducing enhanced forms/prerendered untrusted headers,
or accepting externally supplied build configuration. Better Auth 1.7 and
SvelteKit 3 require a separately verified compatibility migration; forcing their
peer ranges is not a security fix.

## Image-inspector rollout

The gallery processor has its own manifest/lockfile, updated to Sharp 0.35.5.
The CMS inspector uses the Worker's root manifest. Its actual native libraries
report Sharp 0.35.5 and libvips 8.18.7, so a root lockfile update alone is not a
complete CMS rollout.

Deploy the additive Convex admission first. It accepts exactly the reviewed
`0.35.5 / 8.18.7` pair and the prior `0.35.3 / 8.18.3` pair. Deploy the matching
CMS Worker and Container only afterward. The Worker recognizes those same two
pairs during overlapping deployments and reuses cached evidence unchanged.
Mixed pairs, intermediate unreviewed versions, and arbitrary versions remain
rejected. The historical canary snapshot intentionally retains its old expected
versions; this upgrade does not rewrite historical evidence.

Run the native inspector/processor fixtures, receipt-ingress regressions, Worker
types/tests, host contracts, and final host build before release. Retain the
actual deployment IDs and image versions after the authorized rollout. A merged
dependency lockfile does not establish that the separate production Containers
have been replaced.

## Verification and release status

Local verification passed:

- Hub lint, Svelte checks, package contracts, CRM typecheck, print and gallery
  contracts, 115 script tests, 3,181 application/backend tests, 28 protocol tests,
  workspace checks and 100 workspace tests, production build, and build budget.
  The full hub suite was rerun after the bundling change and passed.
- Actual Vercel tracer and Sentry glob calls select the same synthetic nested,
  hidden, and excluded assets before and after the scoped glob overrides.
- Admin lint/check, 1,122 tests, package build, and server-entrypoint checks.
- Worker lint/typechecks and 1,190 tests, including both native image services
  and exact decoder-pair admission/rejection.

The local package audit decreased from 33 to 9 findings in the hub, 25 to 9 in
Admin, and 8 to 0 in the Worker. These counts are package-audit findings, not
GitHub alert counts. GitHub dependency alerts are now enabled for Admin and Worker.

Companion source PRs [Admin #295](https://github.com/JessePomeroy/admin-dashboard/pull/295)
and [Worker #129](https://github.com/JessePomeroy/gallery-worker/pull/129) passed
GitHub CI and merged. Their merge revisions are respectively
`a5c8ab0fe20cff533e64a64cc396025ee104e5dd` and
`1d2129f8808c19fdd6df03dc68da3fee55e99faa`. Hub CI pins that Worker merge,
whose tree matches the locally tested source. Hub CI and merge gates remain
separate from these local results.

[Admin release #296](https://github.com/JessePomeroy/admin-dashboard/pull/296)
merged as `54f881e4757da025ddfe056c8df876a791bec4fa` after its dispatched and
PR-triggered CI passed. Publication run `41542825625` succeeded, and GitHub
Packages confirms immutable version 6.14.1 with the integrity recorded in this
host's lockfile. The host candidate now pins exactly 6.14.1 after a strict-peer
package-manager install. All 619 runtime files in its published `dist` match
6.14.0 byte-for-byte; this patch changes verification dependencies. Host package
contracts, Svelte checks, and the 28 auth/mutation protocol tests pass with the
installed 6.14.1 artifact.

Actions updates #716 and #717 merged with passing CI. Hub #747 then passed its
combined-candidate CI and merged as `e95d3aae2d5e97ab7a9340a01961568100d82892`.
Main CI run `41548166459` passed at that revision. Its production deployment
`dpl_FvJVDrcBD2WynPBwbaYzrBT8wGTh` served the verified production alias with home
and cart checks passing. The retained observation is
`../integration-evidence/releases/production/observation-1d2c8fcc94c1e8bae5601ca1a264b15f56daaabf96cb136ab6e9e1a75fb1f923.json`.
The protected preview also passed authenticated public-page and unauthenticated
admin-mutation checks using existing Vercel automation access; protection settings
and credentials were not changed.

## Runtime rollout — November 3, 2026 UTC

The shared Convex deployment completed first: workflow `41550821253` deployed
the CI-verified `e95d3aae2d5e97ab7a9340a01961568100d82892` to `loyal-swan-967`.
CRM release #748 subsequently merged as
`2f5ccbe99afbc650593617bcd817554edda0f73b`; publication run `41551156766` succeeded.
GitHub Packages confirms immutable CRM API 6.13.1. Its published archive integrity
is `sha512-EfKU1grmqclE8cmQrKHnynCxFKdTaM9x8YrvAGNskvPNOP2AepnVNAtuu93XcmfNNOyXOeLdotGgPv9ubPs4bA==`.

Both image services deployed reviewed Worker source
`1d2129f8808c19fdd6df03dc68da3fee55e99faa` after the additive backend was available:

| Service | Active Worker version | Container image digest |
| --- | --- | --- |
| Gallery | `93163364-493c-4aff-84d2-9d88bdead674` | `sha256:2aa65817cb639fae574917804b68152eae3ed2d7814175900129d36865e853c0` |
| CMS media | `b0e6d973-4c62-4e3b-8636-3ae7d4a15493` | `sha256:9b9ceb744c7373bbacbc74007b39e71907dda40894b5017b85729ef903e9844d` |

The provider reports each Worker at 100% and each Container application's current
configuration at version 3 with the corresponding image. Only the container image
changed: existing bindings, variables, network settings and one-instance limits
were preserved. The gallery retains 0.5 vCPU/4096 MiB and CMS 0.25 vCPU/1024 MiB.
The previously active CMS script's ETag matched its reviewed predecessor; the
service-source comparison identified only the scoped decoder changes.

Both exact published image digests were run locally with networking disabled and
reported Node 24.22.1, Sharp 0.35.5 and libvips 8.18.7. Both live `/health` routes
returned 200. Unauthenticated gallery processing and CMS upload-capability requests
returned 401 before storage writes. Native raster tests passed locally; no production
customer object or production raster canary was used for these deployment checks.
