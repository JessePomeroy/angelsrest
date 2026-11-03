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


## Published Admin adoption candidate — 02:24 UTC

Backend source PR #750 merged at `fcb46673`. The host feature branch now includes
that main revision and pins the published **Admin 6.15.1** through pnpm with strict
peer validation. The lockfile integrity matches the registry record; the installed
package resolves into pnpm's store rather than the earlier local archive.

The current candidate passes the Svelte check with zero errors/warnings,
package-consumer types, CRM TypeScript, **116 Node tests**, **3,299 application/backend
tests**, **28 protocol tests**, and all **12** desktop/mobile Google-connection
browser scenarios. The rendered support-reference state was inspected at both
sizes. The fixture exited and its port closed.

Production backend deployment is awaiting CI on the merged source. CRM API 6.14.0
is prepared in version PR #751 and is not yet published. The host adoption remains
local until the backend/package order is satisfied; this checkpoint does not claim
new host bundling, deployment, provider acceptance or production Gmail activation.


## Published host staged — 02:54 UTC

The live backend deployed from main `fcb46673` through workflow `41568219627`.
CRM API 6.14.0 publication is confirmed after version PR #751 merged. The host
candidate now includes version main `8696bbfa`; its runtime build source is
`4b9a9fd1`, with Admin 6.15.1 from the registry and CRM API 6.14.0 in the workspace.
The remaining source edits after that build update documentation only.

Production bundling for the isolated staging public endpoints and the size gate
passed. Three known server keys were absent from every output file. Vercel reports
staging deployment `dpl_Gcs7HEVK22xKep1EEbvFcfUaQ2zz` READY; provider alias read-back
matches `staging.angelsrest.online` to that deployment.

Twelve live checks passed on that deployed host: recovery login, connected mailbox,
the retained native reply and review workflow, private reads for all five original
files with exact size/SHA-256 matches, four browser-rendered raster previews, the
specific combined-size warning with four selections retained, an empty restored
verification draft, mobile width containment, and anonymous status denial.
No email was sent. PDF byte transport passed; native browser PDF rendering remains
unverified. The driver/browser processes exited. The backend's real lost-response
fault injection and remaining launch-packet gates are still open.
