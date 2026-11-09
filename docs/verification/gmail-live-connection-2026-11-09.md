# Live Gmail connection — 2026-11-09

Jesse explicitly requested connecting Gmail on the live Angels Rest site. This
continues the approved owner-mailbox setup with the separately approved 30-day
application retention policy and unresolved-send holds. It does not authorize a
customer mailbox, a wider recipient list, or a general client-site rollout.

## Configuration installed; consent pending

- Origin: `https://angelsrest.online`; backend: `loyal-swan-967`.
- Source base: `ace5dd2e`; immutable Admin package: 6.16.2; workspace CRM API: 6.15.0.
- Google project: `angelsrest-gmail-261109`, number `1044809186946`.
- Exact separate-mailbox callback: `/api/admin/gmail/callback` at the apex origin.
- Push topic: `projects/angelsrest-gmail-261109/topics/gmail-events`.
- Push subscription: `projects/angelsrest-gmail-261109/subscriptions/gmail-events-push`.
- Push audience: `https://angelsrest.online/api/webhooks/gmail`.
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
initial synchronization still require observation; no production connection is
claimed here.

The backend settings are installed. The running host still requires a deployment
to load its new settings. The existing `/gmail-pilot-privacy` URL is retained so
the Google application's privacy link remains valid; its notice now describes
both the live connection and isolated testing, including the approved retention
policy. Source delivery alone does not prove that revised notice is live.

## Privacy and operational boundaries

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

## Verification and next actions

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

After reviewed delivery, confirm the revised notice and configuration on the exact
live deployment, verify anonymous and forged-push rejection, complete fresh consent
for the approved owner through the separate-mailbox control, and independently
observe persisted connection, watch expiry and a later advancing synchronization
timestamp. Initial installation itself sets `lastSyncAt`; its first nonnull value
is not independent sync proof. Do not
substitute Cloud CLI access or a staging grant for application consent.

Connecting a mailbox does not require sending a message or importing an existing
customer thread. No send or thread import is part of this connection check. The
broader lifecycle, provider-fault and customer-rollout matrix in the launch packet
retains its actual pending status; this bounded connection does not mark it passed.

Private configuration receipts and the resumable checkpoint remain outside Git in
the task's `activation-20261109/` directory. No credential, token, callback code or
mail content is included in this record.
