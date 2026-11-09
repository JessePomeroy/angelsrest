# Live Gmail connection — 2026-11-09

Jesse explicitly requested connecting Gmail on the live Angels Rest site. This
continues the approved owner-mailbox setup with the separately approved 30-day
application retention policy and unresolved-send holds. It does not authorize a
customer mailbox, a wider recipient list, or a general client-site rollout.

## Verified live connection — 22:35–22:37 UTC

PR #771 merged as `3c5d69dc9412e60e9763b8829ad766b8c26dd4e3` after its exact-head
CI and Vercel checks passed. Production deployment
`dpl_8i84gbrmj5Z3tKqVGkPM5Pvs8SFo` is READY at that Git revision. Both live aliases
resolve to it, the revised notice returns HTTP 200, and the serving page serializes
the corrected `www` public origin. This establishes provider source/alias identity,
not identical CI/provider artifact bytes or a runtime configuration fingerprint.

The existing primary owner's production administrator session remained usable.
The owner was selected in the actual separate-mailbox Google consent flow, and
the expected Gmail read/send permissions were approved. The callback returned to
the live site with a connected result. An independent authenticated status read
returned HTTP 200, `configured: true`, the approved mailbox and `status: connected`.

The watch expires **2026-11-16 22:35:15.288 UTC**. The saved authenticated-notice
timestamp is **2026-11-09 22:35:18.744 UTC**. At 22:35:28.194 UTC, the saved sync
timestamp was 22:35:23.680; at the independent 22:37:19.995 status read it had
advanced to 22:36:23.728, an increase of 60,048 ms. Both reads showed no connection
problem, incomplete recovery or active lease. This later advancement supplies
background-sync proof beyond the initial installation timestamp.

All eight post-connection public/anonymous checks passed across apex and `www`:
home, cart and admin HTTP 200; anonymous Gmail status HTTP 403. Apex checks followed
the canonical redirect; these are the final response codes. Missing, malformed
and forged push credentials returned HTTP 503 with `private, no-store` before
consent. These probes do not establish the wider genuine-JWT negative/replay matrix.
The verification sent no mail and deliberately linked no existing thread.

Root `main` was fast-forwarded to the merged revision and is clean. The completed
local and remote connection branch was removed only after its exact head and
merged-tree equality were checked. Production credentials, the live grant, staging
resources and private receipts remain intact.

## Installed configuration and preparation history

- Origin: `https://www.angelsrest.online`; backend: `loyal-swan-967`.
- Source base: `ace5dd2e`; immutable Admin package: 6.16.2; workspace CRM API: 6.15.0.
- Google project: `angelsrest-gmail-261109`, number `1044809186946`.
- Exact separate-mailbox callback: `/api/admin/gmail/callback` at the `www` origin.
- Push topic: `projects/angelsrest-gmail-261109/topics/gmail-events`.
- Push subscription: `projects/angelsrest-gmail-261109/subscriptions/gmail-events-push`.
- Push audience: `https://www.angelsrest.online/api/webhooks/gmail`.
- Keyless push identity: `gmail-push@angelsrest-gmail-261109.iam.gserviceaccount.com`.

Three new independent production keys were generated and retained privately.
The eight expected backend settings were installed on the explicitly named
production deployment. Seven host settings were installed only on the production
Vercel project `prj_q6x2BF1DUnXDMYWNh0oWOQltLjxE`, production target. The two
host secrets use sensitive storage. No existing sign-in, commerce or Worker
credential was changed. Staging keys, OAuth grants and records were not copied.

The mailbox and recipient allowlists each contain only the already-approved
owner address. The separate mailbox flow uses the new client and Google project,
even when the mailbox address matches the existing Google login. It does not
replace that login's OAuth client or alter membership. The Google app's saved
scope declaration contains basic identity scopes and Gmail read/send scopes.
The Google app is now External / **In production**, read back from its Audience
page, and remains unverified with its 100-user cap. This is the approved owner-only
connection scope, assessed against Google's
[personal-use exception](https://support.google.com/cloud/answer/13464323?hl=en),
not a verified public application or general client launch. No assessment was
purchased or verification submission made. Fresh consent, watch installation and
background synchronization subsequently passed as recorded above; broad client
launch and the remaining lifecycle matrix are not inferred.

The backend settings are installed and the serving host has loaded its new
settings. The existing `/gmail-pilot-privacy` URL is retained so
the Google application's privacy link remains valid; its notice now describes
both the live connection and isolated testing, including the approved retention
policy. Its live response was independently checked after deployment.

## Privacy and operational boundaries

Direct HTTP checks found that the apex domain redirects every checked path,
including the Gmail callback, to `www`. The running host's public URL setting
still contained the apex; earlier redirect-following health checks had hidden
that mismatch. Production `PUBLIC_SITE_URL`, Gmail callback, push audience and
subscription endpoint were corrected to the canonical `www` origin. The Google
mailbox client's registered callback was updated accordingly. The existing domain
redirect remains intact, and development/preview retain their previous public URL
through a separate environment entry. The site tenant key remains
`angelsrest.online`; existing sign-in credentials are unchanged. Forty-one existing
runtime configuration, staging-isolation and Gmail-handler tests passed.

A focused independent origin review found no blocking Gmail integration defect.
Changing the production public origin can invalidate an existing checkout-attempt
proof created with the apex string. The checkout handler rejects that stale proof;
the frontend discards it after the rejection and a retry can obtain a fresh one.
This limited retry impact remains part of the configuration rollout, without
changing checkout credentials or payment authorization.

The 30-day deadline starts at local conversation creation and does not move when
a reply arrives. Cleanup covers the conversation, drafts, cached attachments and
resolved send records; unresolved sends hold the affected records and frozen
evidence. Original Gmail messages and administrator-downloaded copies are separate.

The notice distinguishes active application deletion from provider recovery copies
and operational logs. The prior production metadata read found zero manual Convex
snapshots and no scheduled snapshot configuration. It does not establish erasure
of provider-internal recovery copies. No snapshot, log or customer record was
downloaded or deleted for this setup.

Application error monitoring has default PII capture disabled and uses the existing shared
URL scrubber for OAuth codes/state. Gmail connection failures use bounded codes,
stages and opaque references. This source review does not establish platform-log
redaction or a provider-internal retention period. Production has Sentry configured;
the staging absence of a DSN is not reused as production evidence.

Do not restore historical Gmail data into active production as ordinary website
recovery. Any recovery must first keep the connector isolated from production
provider credentials, preserve current unresolved-send evidence, and establish how
expired/erased data will be excluded before access or synchronization resumes.
No restore or exceptional erasure is authorized by this connection request.
Deletion requests and unresolved holds go to the operator through the published
privacy contact; administrator-downloaded copies require separate handling.

## Verification and limits

`pnpm lint` passed with existing warnings. The first `pnpm check` lacked the public
Convex URL; the rerun with the documented nonsecret staging public configuration
passed with zero errors and warnings. No production secret was provided to those
commands. The actual notice component and global styles rendered at 1440-pixel
desktop and 390-pixel mobile widths without page errors or horizontal overflow.
Both retention views were visually inspected. This isolated article check excludes
site chrome and provider consent; external requests were blocked. Two independent
read-only reviewers checked disclosure/records and connection/configuration.
The minor default-PII wording finding was corrected.

The installed Admin package has an existing reconnect limitation: after a mailbox
with the same address as a linked Google login is connected, its UI hides the
separate-mailbox reconnect form and leaves the sign-in-account reconnect action.
That action uses the existing sign-in client, which belongs to a different project
from the new mailbox topic. Initial separate-mailbox connection remains valid;
do not use that sign-in action as recovery for this connection or claim reconnect
acceptance complete. Existing sign-in credentials remain unchanged.

The reviewed delivery, exact deployed notice/configuration, bounded rejection
probes, fresh separate-mailbox consent and persisted/watch/later-sync checks are
recorded above. Initial installation itself sets `lastSyncAt`; its first nonnull
value was not used as independent sync proof. No Cloud CLI access or staging grant
was substituted for application consent.

Connecting a mailbox does not require sending a message or importing an existing
customer thread. No send or thread import is part of this connection check. The
broader lifecycle, provider-fault and customer-rollout matrix in the launch packet
retains its actual pending status; this bounded connection does not mark it passed.

Private configuration receipts and the resumable checkpoint remain outside Git in
the task's `activation-20261109/` directory. No credential, token, callback code or
mail content is included in this record.
