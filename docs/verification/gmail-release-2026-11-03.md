# Gmail release candidate — 2026-11-03 UTC

The committed Gmail implementation was merged with the released dependency
maintenance branches and verified locally. This record establishes candidate
compatibility; live provider acceptance remains in the
[launch packet](../runbooks/gmail-pilot-launch.md).

## Candidate identity

- Hub source before generated-code refresh: `fc76c949d2aeb0736d73a61b7cc3e4ed1b39606d`.
- Admin source: `88bb39548ccf585626898ea5efc801adea1584bd`.
- Original feature snapshots remain at hub `b55c322c` and Admin `59cb8cc`.
- Local Admin tarball SHA-256:
  `051f4acc5ff74374b92b5224632d9a717d9ba2a48b9b29a99268a22cda8118b8`.
- The archive is an **unpublished Gmail candidate** carrying the source package's
  existing `6.14.1` label. Published Admin 6.14.1 does not contain this feature.
  The host verification used the archive with the current locked dependencies.
- Convex 1.49.0 regenerated the API and server bindings. The project TypeScript
  check ran separately because its configuration is above the CLI's default
  `convex/tsconfig.json` location. No generated file was hand-edited.

## Observed checks

- Admin lint, Svelte check, **1,132 tests**, build and server-entrypoint smoke passed.
- Eight focused Gmail/auth/host suites passed **106 tests**; CRM TypeScript passed.
- Host lint, Svelte check (zero errors/warnings) and package-consumer contracts passed.
- Full host tests passed **115 Node tests**, **3,288 application/backend tests** and
  **28 protocol tests** using the suite's standard CI public configuration.
- The initial full-suite attempt used the staging hostname. Its stricter sandbox
  configuration conflicted with 122 existing commerce-fixture assertions. The
  standard-configuration rerun passed without source changes. This does not establish
  live staging commerce behavior.
- The separate build used the isolated staging public origin and Convex URLs.
  Production bundling and the unchanged size-budget gate passed.
- All **12** actual host connection-page regressions passed on desktop and mobile.
- The shared conversation driver passed at **1440×1000** and **390×844**, including
  linking/participant rejection, follow-up state, inert email text, drafts,
  interrupted uploads, uncertain-send blocking, private-preview recovery and Google
  controls. Browser reports had no page errors; representative light/dark images
  were inspected. All external requests were blocked during these local checks.

Logs, browser screenshots, the artifact and run identity are retained outside the
repositories in the Gmail task directory's `release-20261103/`. The recorded browser
runner and fixture processes exited; ports 5196 and 5289 were confirmed closed.

## Release limits

No claim of separate-mailbox consent, representative-file delivery, expiry/recovery
fault acceptance, provider log/backup retention or production Gmail activation is
made by these local results. Source/package publication and configured production
use are separate steps. The approved synthetic pilot is the only live-mail scope.
