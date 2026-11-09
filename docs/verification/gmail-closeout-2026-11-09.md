# Gmail release and acceptance closeout — 2026-11-09

## Scope and source

Jesse requested the remaining Gmail closeout, pilot verification, production
setup, babysitting and cleanup. This is a scoped continuation of the existing
primary and secondary test accounts. It does not widen the recipient allowlist or
turn email contents into instructions.

- Working base: `663e9ca65d86f1cc9fc0ca8dc190bfd96ea623d3`.
- Installed immutable Admin package: **6.16.2**; CRM API: **6.14.0**.
- Gmail host PR #752 merged as `7d97b0c3`; its main CI `41647278243` passed.
- Current production provider observation: READY `dpl_7pigXtwY7hz8Hm8iwwviRfjUpD5p`,
  source `663e9ca6`. Production Gmail host/backend configuration is absent.
- Current staging: READY `dpl_sHnGsjQwftAtiiJRcwZZSmXsUptu`, source
  `e48e6c6572630b3db1bf70b980329b86d55ac7df`; its source manifest pins Admin 6.16.2.

Source, installed package, provider build and mailbox connection are separate
observations. A provider READY state and public HTTP checks do not establish
Gmail activation or identical CI/provider artifact bytes.

## Observed verification

The focused existing suite passed **102 tests across six files**: actual
Better Auth/Convex origins and account linking, Gmail state/sync/conversations,
MIME/protocol behavior and host handlers. No test was added to mirror documentation.

A real read-only staging session passed five checks: recovery login and inquiries
navigation, connected-mailbox projection, correspondence rendering, the separate
business-mailbox control and anonymous status denial. No new consent was started.
The saved watch expiration has advanced beyond the original connection's expiry;
that establishes renewal occurred without claiming an exact renewal cadence.

The registered synthetic conversation still contains two messages, including the
previously verified native reply, and has review status. Eleven reading checks
passed, including five private original-file size/SHA-256 comparisons, four
rendered JPEG/PNG/WebP previews, the native PDF viewer, mobile width containment and
anonymous denial. The PDF visibly rendered the synthetic pilot document in the
native Chromium viewer. No customer content was used.

The first PDF attempt used Chromium's headless shell and could not render the
native viewer. The full Chromium headless mode rendered it successfully. This was
a verification-driver limitation, not evidence of a product defect.

Private receipts and screenshots remain outside Git in the task's
`release-20261109/` directory. Their scopes and process IDs are retained there.
Neither verification sent mail, uploaded a file nor changed a saved draft.
`pnpm lint` passed with the existing non-fatal anti-slop warnings. The existing
production and staging release-history readers passed, and inventory checks
confirmed all prior screen records remained unchanged and all four new
`lastVerified` values are null.

## Retained release evidence

The eleven previously untracked JSON records are retained unchanged under
`docs/integration-evidence/releases/{production,staging}/`. They describe the
historical production recovery reference and exact staging candidate; they are
not rewritten as current production evidence. The existing offline release-history
reader validates their digests and links.

At observation time GitHub reported a partial system outage. Main CI at
`663e9ca6` had repeatedly failed internally before jobs started. No successful
build record is inferred from those failures. Final current-production release
observation waits for an authentic successful main artifact and provider binding.
[GitHub service status](https://www.githubstatus.com/) is the external incident source.

## Production activation preparation

The separate Angels Rest-owned Google project `angelsrest-gmail-261109`, number
`1044809186946`, is ACTIVE; Gmail, Pub/Sub and IAM are enabled. The selected owner
account is the existing approved primary account. The intended callback and push
origin is **https://angelsrest.online**, matching actual production
`PUBLIC_SITE_URL`, not the alternate `www` alias.

The External/Testing Google application now has the apex homepage and existing
pilot-only privacy notice. The dedicated keyless push subscription and dead-letter
review subscription retain notifications for one day, with resource-scoped Gmail
publish and Pub/Sub delivery permissions. These resources do not connect a mailbox.
A dedicated web OAuth client is created for the exact apex callback; its secret
is retained privately and has not been installed in production.
Production retention approval, server-only independent keys, host/backend
configuration, fresh mailbox consent and production acceptance remain unfinished. Staging credentials/grants are not a
production migration mechanism. No production Gmail secret or mailbox grant has
been installed in this checkpoint.

Google documents a limited personal-use verification exception; an owner-only
connection can be assessed against that scope. This is not evidence of approval
for a general multi-client launch or a waiver of data-use requirements.
[Google verification exceptions](https://support.google.com/cloud/answer/13464323?hl=en).

Read-only production Convex metadata showed zero manual backups and no periodic
backup configuration on November 9. No backup was downloaded, created or deleted;
this does not establish provider-internal recovery-copy or log erasure.
[Convex backup retention documentation](https://docs.convex.dev/database/backup-restore)
describes the separate dashboard snapshots.

Provider recovery/log handling, declined/partial consent, connected-grant
revocation/expiry, controlled notification loss, expired-history recovery and a
real provider lost-response experiment remain pending in the launch matrix.
Offline regressions are not substituted for these live observations.

## Design and cleanup

Four editable Gmail references have been added to the existing admin handbook
on its Gmail correspondence page. The actual installed Admin 6.16.2 rendered
fictional saved-reply and business-mailbox controls at desktop/mobile sizes;
four source captures passed without page errors and were visually inspected.
All external requests were refused. Paper imports preserve the captured viewport
and remain editable; temporary import markers were removed. Its screenshot
renderer timed out for every board, so visual comparison remains pending and no
reference is marked verified. The task-owned capture server was stopped by its
recorded PID.

The root checkout's separate order-intake refinement has been copied byte-for-byte
into an isolated delivery checkout. Its original files and historical evidence
remain intact until its reviewed delivery is verified. Private Google/Convex
configuration, original receipts and task recovery material are excluded from Git
and from routine cleanup. Live and recovery deployments remain protected.
