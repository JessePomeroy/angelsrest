# Gmail local continuation verification — 2026-11-02

Scope: the existing uncommitted Gmail feature in the two
`feat/gmail-conversations-local-20261101` worktrees. No external actions or real
mailbox data were used. This record distinguishes synthetic/local evidence from
Google and deployed-host acceptance, which remain pending in the
[launch packet](../runbooks/gmail-pilot-launch.md).

## Verified behavior

- Explicit search/preview/confirmation, identity/record/mailbox binding, duplicate
  association behavior, unexpected-participant refusal and resumable imports.
- Review/needs-reply/waiting/done workflow, follow-up date handling, older/replayed
  mail and native Gmail Sent transitions. Local acceptance timing cannot clear a
  later incoming message; the observed Sent timestamp is authoritative.
- Authorization at import commit, queue, export, attachment transport and deletion;
  record deletion/offboarding cannot discard unresolved Gmail evidence.
- Approved pilot allowlists fail closed and are rechecked before submission;
  partially revoked refresh scopes require reconnect before Gmail API operations.
- Immediate and scheduled erasure, private cached-byte removal, all related draft
  cleanup, retention holds, preserved mailbox/site registry and bounded export.
- Existing lease/cursor pagination, synthetic JWT validation, native draft exclusion,
  upload recovery, uncertain sends and separate sign-in/mailbox consent regressions.

## Rendered evidence

The real shared inquiry/client modals, Google dialog and correspondence page ran
at **1440×1000** and **390×844** using the repository's reactive synthetic fixture.
All requests outside `127.0.0.1:5289` were blocked. Browser page errors were empty;
modal and queue widths stayed within the tested viewports. Light and dark queue
captures and inquiry/client, link confirmation, interrupted upload, consent and
reconnect states were inspected. Phone message text uses a 16 px reading size.

The driver also exercised folding/full text, exact Gmail links, private preview
failure/retry, workflow edits, blocked and successful association confirmation,
JSON download, empty/error queue states, deletion confirmation/holds, and all prior
upload/uncertain-send flows. The synthetic adapter is not a Google provider or a
real storage boundary; native PDF viewer/private deployed transport remains a live
pilot gate. Theme captures wait for transitions to finish.

Artifacts: `artifacts-20261102/browser/` contains `browser-report.json`, PNG captures,
`design-detector.json` (no findings), and the fixture log. This path is relative to
`/home/strayblackdog/.local/state/angelsrest-gmail-20261101/`.

## Commands and results

| Check | Observed result |
|---|---|
| Shared Admin `pnpm test` | 116 files, **1,132 tests passed** |
| Focused hub/backend/auth/privacy/record-deletion suites | 15 files, **176 tests passed** |
| Admin and hub `pnpm check` | Zero errors and zero warnings |
| CRM API `tsc -p tsconfig.json --noEmit` | Passed |
| Host `pnpm check:package-contract` | Passed against the final locally packed Admin artifact |
| Both repository lint commands | Passed; existing repository warnings remain |
| Admin packaging and server-entrypoint smoke check | Passed |
| Host production bundle and build-budget check | Passed against the final local tarball, with synthetic Convex URLs; not a deployment |
| Synthetic desktop/mobile driver | Passed; external requests blocked, zero browser page errors |
| Impeccable mechanical detector on changed Gmail surfaces | No findings |
| Git whitespace checks and manifest/lockfile comparison | Passed; no checked-in dependency/lockfile changes |

The final local Admin tarball is
`artifacts-20261102/final/jessepomeroy-admin-6.14.0.tgz`, SHA-256
`1508b422f0b85049a36763048e33bd3c914287eb37d7c9e721b25d9670b56e0a`.
Its version is intentionally still the local source version; it is not a published
release. Host verification uses the unpacked tarball with the same explicit existing
peer/dependency links as the previous local artifact. The first build attempt lacked
those links and failed resolving `convex-svelte`; this was local harness setup. After restoring those links, the production bundle passed. Existing optional Sharp-platform tracing warnings remain.

The focused hub command selected `gmailConversations`, `gmailSync`, `gmailAuthLink`,
Gmail protocol, `authOrigins`, inquiries, CRM, business records, deletion gaps,
catalog deletion, tenant isolation, host Gmail handlers/security/privacy, and
capability-privacy tests. It includes the new blank-contact-email data-access
regression. The full Admin suite includes the Google-control and plain-text reading
regressions; focused counts are not added again to its total.

The rendered driver was run with `GMAIL_VERIFICATION_OUTPUT` set to its local
artifact directory and the hub's `package.json` supplied for Playwright resolution.
The temporary Vite process **2971818** was stopped by its recorded PID and port
5289 was confirmed closed. Captures/reports were moved outside the worktrees to the
retained browser-artifact directory. No unrelated process was stopped.

Historical 2026-11-01 totals remain in the main runbook and are not substituted for
these results.

## Explicit limits

- No real consent, approved test-account connection, provider refresh, Google push,
  watch renewal, expired-history request, deployed latency or recipient delivery ran.
- Attachments remain 3 MiB each, 6 MiB/reply and five files. Automatic resizing is
  not implemented. Export JSON contains text/metadata; original bytes are separate
  authorized downloads.
- Pilot retention is approved; production retention, exceptional erasure of an
  unresolved send, actual backup/log behavior and public privacy disclosure are not.
- Local packing/adoption verification changes only generated artifacts and the
  feature worktree's `node_modules` link. Checked-in dependency versions/lockfiles
  remain unchanged. Nothing is committed, published or deployed.
