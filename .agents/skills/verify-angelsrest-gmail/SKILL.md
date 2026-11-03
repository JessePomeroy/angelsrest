---
name: verify-angelsrest-gmail
description: Verify Angels Rest Gmail consent, registered conversations, sending and private attachments using existing local tests and the isolated pilot. Use for Gmail regressions or explicit pilot acceptance; distinguish offline evidence from authorized real-provider checks.
---

# Verify Angels Rest Gmail

Use the existing implementation and drivers. A status/review request remains
read-only. Verification does not grant permission to deploy, connect or revoke a
Google grant, send mail, change membership, or delete imported data. Reuse explicit
authorization already given; do not ask again for the same action and environment.

## Establish the exact working state

Read repository instructions and inspect Git state. The Gmail feature may be in
separate hub/admin worktrees rather than the ordinary checkouts. Confirm the hub
contains `packages/crm-api/convex/gmailNode.ts` and identify the matching admin
source containing `tests/fixtures/gmail-conversations/verify.mjs`. Inspect the
host's installed admin artifact; a source checkout and an installed tarball can
differ. Do not replace it or change dependency ranges merely to run a status check.

Read [the launch packet](../../../docs/runbooks/gmail-pilot-launch.md) for current
deployment identity, approvals, observed results and open gates. It is the current
acceptance record. Read the synchronization runbook for behavior, not a competing
status summary. Read Convex's generated AI guidelines before backend source.

At the start of a run, retain one nonsecret record outside the source tree:

- Hub/admin checkout, branch/head plus dirty state; installed artifact identity.
- Intended local or deployed origin/backend; actual values observed.
- Login identity/role, connected mailbox, approved test recipient and authorized
  actions. These are separate roles; never infer one from another.
- Selected scenario, expected result, evidence directory and UTC timestamp.
- Completed observations, unverified parts, next concrete action and any pending
  user step; exact task-owned process IDs if a fixture is running.

Update this record at a real stopping point. On resumption, verify the recorded
state and continue the next action. A new workspace-instruction message does not
cancel the active task. Never record credentials, cookies or OAuth callback codes.

## Choose the smallest useful check

Use [local checks](references/local-checks.md) for code changes and to rehearse
the workflow without provider access. Start with the relevant existing suite;
broaden only for a changed boundary or unresolved failure. Keep the real installed
Better Auth/Convex refresh regression and MIME filename regression in the core
set. Do not replace them with mocks of the boundary that failed.

The [feature map](references/features/README.md) provides actual controls and proof
requirements for Google connection and sending/attachments. Follow only the
selected scenario. Real-provider acceptance needs an authorized environment and
accounts; local tests and screenshots cannot satisfy those rows.

Before asking the user to perform a login/consent step, provide the exact URL,
expected account, secure credential-access method if needed, and success state.
Verify a visible browser before saying it is open. Keep ordinary login, same-account
Gmail upgrade and separate business-mailbox consent distinct. Withdraw obsolete
credential requests when the workflow changes.

## Evidence and completion

For failure diagnostics, retain only safe codes, operation stage, reference ID,
status and timestamp. Never dump raw SDK errors or token-bearing mutation arguments.
Use synthetic credentials for injected failures. An opaque reference can be
matched to the host's `Gmail connection failed` record; provider-internal logging
is a separate boundary and is not proven safe by host-log tests.

For real email, independently establish Gmail acceptance and recipient arrival.
An approved self-send is sufficient for own-Inbox/attachment checks; it does not
prove a different sender's reply. Do not request a second account as a prerequisite
for the smaller check. An uncertain send stays blocked; never click Send again
just because the response is missing.

Stop only recorded task-owned processes and close task-owned tabs according to the
active browser rules. Preserve proof. Update the launch packet's current acceptance
rows with the exact scope exercised, and link dated evidence instead of copying
old totals into new claims. Report local changes separately from deployed behavior.
