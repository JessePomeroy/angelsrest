# Gmail controlled pilot and launch packet

Updated 2026-11-09 UTC. **Gmail source and packages are released; the staging
mailbox is connected. Live mailbox activation is being prepared separately.**

Backend PR #750 deployed the additive functions to `loyal-swan-967`; CRM API
6.14.0 and Admin 6.15.1 were published. Host PR #752 merged as `7d97b0c3`, passed
main CI and is included in the later production releases. Current production is
READY at `663e9ca6`, with Admin 6.16.2. A code deployment does not establish a
configured live Gmail mailbox: the November 9 provider read found no production
Gmail host settings or backend environment names.

Jesse authorized completion of the remaining acceptance, production setup,
reviewed delivery and cleanup on November 9. A separate production Google project,
`angelsrest-gmail-261109` (number `1044809186946`), is ACTIVE with Gmail, Pub/Sub
and IAM enabled. Dedicated notification resources and a separate web OAuth
client are prepared; its credential remains private. No production Gmail
credential or grant is installed. The
production retention decision is pending; the existing 30-day approval applies to
the isolated pilot until that decision is recorded. Staging keys and grants will
not be copied into production.

The November 9 read-only staging checks passed at deployment
`dpl_sHnGsjQwftAtiiJRcwZZSmXsUptu`, source `e48e6c65`, Admin 6.16.2:
ordinary recovery login, connected status, correspondence and separate-mailbox
controls, anonymous denial, the original two-message conversation and review state,
five original-file fingerprints, four image previews, native PDF rendering and
mobile containment. The saved watch expiration advanced from the original pilot
checkpoint. No email, consent, upload or draft change was requested by these checks.
See [the current closeout evidence](../verification/gmail-closeout-2026-11-09.md).

GitHub reported a partial Actions outage during this closeout. The current main
workflow's internal failures and unavailable immutable release record remain an
infrastructure gap; they are not recorded as a successful release observation.
Historical scoped recovery and staging receipts are retained without relabeling.

The dated checkpoints below are historical evidence. They do not override the
current release, configuration or acceptance state above.

Exact approved account addresses and recipient allowlists remain in the private pilot scope record. This public runbook identifies them by role.
Never use the Graham experiment's project, credentials, mailbox state, or timings
as pilot evidence.

The owner approved a **30-day pilot retention maximum with unresolved-send holds**.
That approval does not authorize external actions or establish production retention.
The [synchronization runbook](gmail-synchronization.md) is the implementation and
incident reference; [local evidence](../verification/gmail-local-2026-11-02.md)
is separate from the live matrix below. This packet is the sole current acceptance
record. Use [the Gmail verification skill](../../.agents/skills/verify-angelsrest-gmail/SKILL.md)
for commands, safe handoffs and resumable evidence.

### Recovery and cross-account checkpoint — 2026-11-03 01:55 UTC

Admin **6.15.1** is published and its registry integrity is recorded. The version
PR #300 is merged. The host still uses its previously recorded staging artifact;
published package adoption and the composer-warning deployment remain pending.

The second approved mailbox received the five-attachment message and all downloaded
bytes matched (6 MiB combined). One native reply imported once into the registered
conversation and set its workflow to `review`, observed through authenticated
export without a manual sync. Rendering and full workflow/UI acceptance remain
separate pending checks.

The provider replaced generated Message-IDs in both an application send and a
fresh diagnostic. A custom correlation header survived and its bounded metadata
lookup succeeded. The correction is committed at hub `e299c6a8` and backend
`1f610c7d`, and deployed only to staging `rosy-firefly-366` at 01:55:12 UTC.
All 76 Gmail tests, backend types and root lint pass; five existing backend lint
warnings remain. Backend PR #750 subsequently passed renewed CI and merged as `fcb46673`; main CI
and production backend deployment remain separate. Deployed
lost-response fault injection remains pending. See [the scoped evidence](../verification/gmail-recovery-2026-11-03.md).
Production Gmail remains unconfigured.

### Published package preparation — 2026-11-03 02:24 UTC

Backend PR #750 merged after all checks passed. CRM API 6.14.0 version PR #751
contains only the expected Changeset consumption, version and changelog. Its CI
is running; publication waits for the additive backend deployment.

The host branch now pins registry Admin 6.15.1 and includes the merged backend.
Strict peer installation, host/consumer/backend types, the full host suite and
12 desktop/mobile connection checks pass. [The candidate record](../verification/gmail-release-2026-11-03.md)
contains exact counts and remaining limits. The currently deployed staging host
still uses the previous artifact; the new candidate is local only.

### Backend release and published host staging — 2026-11-03 02:54 UTC

Main CI passed for backend merge `fcb46673`. Workflow `41568219627` deployed
that exact source to shared production `loyal-swan-967` at 02:47:23 UTC. Version
PR #751 then merged as `8696bbfa`; publication workflow `41568303445` succeeded,
and immutable CRM API **6.14.0** is confirmed in the registry. This deploys backend
code; it does not install live Gmail credentials or connect a production mailbox.

The host candidate built from `4b9a9fd1` uses registry Admin **6.15.1** and workspace
CRM API **6.14.0**. Build and size checks pass. Staging deployment
`dpl_Gcs7HEVK22xKep1EEbvFcfUaQ2zz` is READY, and the provider confirmed that
`staging.angelsrest.online` points to it. The build scan found none of the three
server keys embedded in its outputs.

Twelve live staging checks passed: ordinary login and connected status, one native
reply in the original two-message conversation with review status, original-byte
integrity for five private attachments, four rendered image previews, the clear
combined-size warning retaining four files, an empty restored verification draft,
mobile width containment and anonymous status denial. Nothing was sent by this
check. PDF bytes passed; browser PDF rendering remains unverified. Cached files
selected solely for the warning check were removed from the draft and retain the
normal expiry policy.

The host source/configuration is moving through its own PR. Production Gmail
activation, production retention and remaining fault/expiry/provider-log checks
remain separate. The current Gmail connection continues on staging.

### Current local follow-up

The active Gmail closeout branch is `chore/gmail-live-closeout-20261109` in the
preserved Gmail hub worktree. Its base is current main `663e9ca6`, and it uses the
locked registry Admin 6.16.2 package. Original feature and backend/Admin source
branches remain preservation references. The ordinary repository contains a
separate order-intake refinement; it is not part of the Gmail change.

The released reflection follow-up supplies the project verification skill and
credential-safe OAuth failure reporting. Its original local proof remains in
[the follow-up verification record](../verification/gmail-follow-up-2026-11-02.md);
those tests and early pilot observations apply only to their recorded revisions.

The November 3 prepublication candidate incorporated Better Auth 1.6.34, Convex
1.49.0, Admin base 6.14.1 and CRM API base 6.13.1. Its then-unpublished archive
and generated API are historical evidence in
[release-candidate verification](../verification/gmail-release-2026-11-03.md).
That local archive was superseded by the published packages and exact-version
host adoption described above; it is not pending publication work.

## Pilot setup status

| Item | Proposed bounded scope | Current state |
|---|---|---|
| Environment | A dedicated Angels Rest-owned Google testing project, isolated Convex deployment and host; synthetic records only | Google project `angelsrest-gmail-pilot-261102` created; existing `staging.angelsrest.online` and `rosy-firefly-366` selected after host/backend configuration verification |
| Cost | Routine low-volume pilot usage; no paid assessment purchase during pilot setup | Owner waived a separate spending-cap approval for routine pilot usage on 2026-11-02; monitor usage without treating that cap as a blocker |
| Accounts | Approved owner Google login and mailbox; existing synthetic administrator retained for recovery | Owner Google sign-in and stored membership verified; explicit same-account Gmail upgrade connected after replacing the pilot grant; watch and synchronization active |
| Recipients | Exact addresses for send/reply/delivery tests, mirrored into the server allowlist | Two self-sends and a five-attachment delivery to the approved second mailbox passed. The second mailbox's native reply imported once. Separate-business-mailbox consent remains pending; delivery to that mailbox is not consent evidence. |
| Privacy | Approved policy below, published disclosure, operator access list, backup/log settings and deletion handling | Pilot notice published and linked in Google branding; synthetic tests only; provider recovery/log retention remains a gate for non-test correspondence |
| Source delivery | Reviewable commits/source PRs in both repositories, additive backend release, then package publication/adoption | Backend and host source merged; CRM API 6.14.0 and Admin 6.15.1 published. Later releases contain them. November 9 staging uses Admin 6.16.2. Production mailbox setup and the remaining acceptance rows are separate |

Google Cloud CLI 591.0.0 is installed under the private task directory, using the
exact official Linux archive and its published SHA-256 checksum. Its configuration
is isolated from the default CLI setup. Sign-in and the chosen account's project
Owner binding were verified. No `.env` or `.env.local` is configured in the feature
hub root or its `packages/crm-api` directory. The Convex credential can read staging
environment-variable names. Vercel sign-in was renewed and verified as the existing
`jessepomeroy` account, including access to the isolated staging project. The prior
HTTP 403 authentication failure is resolved.
The completed consent and self-send evidence is recorded below and in private
pilot receipts. The current approved test addresses are the primary pilot mailbox
and the second pilot mailbox. The second address was approved during repository
maintenance; that authorization does not establish completed consent, a connection,
or provider delivery. Do not send to any other recipient.

### Verified Google resource record — 2026-11-02

| Resource | Observed state |
|---|---|
| Project | `angelsrest-gmail-pilot-261102`, number `650046899713`, ACTIVE; name `Angels Rest Gmail Pilot` |
| APIs | Gmail, Pub/Sub and IAM enabled |
| Notification topic | `projects/angelsrest-gmail-pilot-261102/topics/gmail-events`; persistence restricted to `us-east1` |
| Gmail publisher | `gmail-api-push@system.gserviceaccount.com` has `roles/pubsub.publisher` on that topic |
| Push identity | `gmail-push@angelsrest-gmail-pilot-261102.iam.gserviceaccount.com`; zero user-managed keys |
| Push signing | Project Pub/Sub service agent has `roles/iam.serviceAccountTokenCreator` on the dedicated push identity only |
| Dead-letter topic | `projects/angelsrest-gmail-pilot-261102/topics/gmail-events-dead-letter`; Pub/Sub service agent can publish; persistence restricted to `us-east1` |
| Dead-letter review subscription | `gmail-events-dead-letter-review`; pull delivery, one-day message retention, 31-day inactivity expiration |

The primary `gmail-events-push` subscription now uses the exact staging endpoint,
audience and dedicated push identity. It retains unacknowledged notices for one day,
expires after 31 days of inactivity, has a 60-second acknowledgement deadline,
10–600-second retry backoff and a dead-letter maximum of 10 attempts. The Pub/Sub
service agent has subscriber permission on this subscription. Real authenticated
delivery of a synthetic notice was observed; dead-letter forwarding under failure
and automated alert delivery remain untested. The Google Auth Platform setup is complete. Console
inspection verified External/Testing status. The selected pilot account was added
as the sole test user, and the five required scopes were saved and verified after
reload: `openid`, `userinfo.email`, `userinfo.profile`, `gmail.readonly` and
`gmail.send` (the latter four use the full Google OAuth scope URI). Branding now
links the staging homepage and published `/gmail-pilot-privacy` notice; the
authorized domain is `angelsrest.online`. No terms page was invented or submitted.
At that provisioning checkpoint no watch had started. The subsequent watch,
synchronization and synthetic correspondence are recorded in the acceptance
sections below.

The existing staging environment is documented in [staging](staging.md):
`https://staging.angelsrest.online`, Vercel project `angelsrest-staging`, and Convex
deployment `rosy-firefly-366`. Provider reads verified the staging Vercel project
`prj_TZXP4xYmWst9RNYhihhgaRoZ52xq`, verified staging domain, prior Ready deployment
`dpl_HTNmmC1zHFbgqmecLDNcyBDRRddy`, and exact public configuration for that staging
origin and Convex cloud/site URLs. Existing Vercel protection excludes custom
domains; no protection settings were changed. Gmail settings were subsequently
installed on this staging host/backend only. Preserve existing synthetic records and provider isolation.
These configuration checks do not verify mailbox behavior, backup retention or logs.

A subsequent read of the staging deployment's backup settings found no periodic
backup configuration and zero manual backups. This concerns configurable snapshots
only; it does not establish the provider's internal recovery-data retention. The
staging host has no `PUBLIC_SENTRY_DSN` setting, which the application uses to enable
Sentry. Observed synthetic Gmail request logs contain paths/statuses with no
application log messages. Callback/error content and infrastructure retention still
require acceptance before retaining non-test correspondence. The published pilot
notice explicitly excludes personal and customer correspondence.

The created web OAuth client uses these exact redirects, supported by the host's
forwarded Better Auth base and the separate mailbox callback:

- `https://staging.angelsrest.online/api/auth/callback/google`
- `https://staging.angelsrest.online/api/admin/gmail/callback`

The client is named `Angels Rest Gmail Pilot`, type **Web application**, ID
`650046899713-4jkkgampnu5nt0be7gfudfoanljv45s9.apps.googleusercontent.com`. Console
creation and the downloaded JSON independently confirm both exact redirects, the
dedicated project, and no JavaScript origins. The AI-agent client option is off:
this is an administrator-operated correspondence interface. The downloaded JSON
was secured outside the repositories and used to install the backend credentials;
it was no longer present at its download path during the deployment continuation.
Its secret was never printed or placed in an evidence document. Gmail keys and
the OAuth secret are installed only in the applicable server environment stores.

This one app-owned web client serves both paths; consent and account association
remain separate in application code. Future credential intake uses a private secret
field or direct provider download and server-only configuration stores, never chat
or source control.

Use an isolated copy of the site's membership/configuration, with approved test
identities, rather than copying production records. The host's canonical data key
is currently `angelsrest.online`; isolation must come from its separate backend and
host environment, not a browser-supplied alternate tenant. Keep production Google
login, production Convex and the public site out of the pilot configuration.

### Current release-candidate deployment — 2026-11-03 UTC

- The updated backend deployed to the explicitly selected `rosy-firefly-366`.
  The dry run confirmed no indexes would be deleted.
- Prebuilt host `dpl_BuLJwHvHnPTiY7N4eqJJ6Cep6KcK` is Ready. The alias API confirms
  `staging.angelsrest.online` points to that deployment in the staging project.
  The preceding host `dpl_Cu7m58U6aTVW9mD5zKZebtgbmyhC` remains available as a
  rollback candidate, subject to current backend compatibility review.
- Operator-retained build manifests bind the prebuilt output to hub source
  `eda30bb53015f970a8cb20f4e6f5d26c8a5794a7` and the Admin archive identified in
  the release-candidate verification record. No package publication is implied.
- Password HTTP login returns 200, and the authorized Gmail status returns 200,
  configured/connected, with an advancing last-sync timestamp. This is distinct
  from provider-consent and send acceptance.
- The rendered recovery-account login, inquiries navigation, correspondence page
  and separate reconnect control passed with no page errors. The login and mailbox
  identities remain different. Anonymous Gmail status returns 403. No new consent
  was started by this smoke check.
- Google remains External/Testing. Its audience contains exactly the two approved
  accounts, verified after reload. Both staging allowlists were read back with
  those same two addresses. No administrator membership or mailbox registry changed.
- The 10,468-file build scan found none of the configured Gmail server keys. The
  OAuth credential was not passed to the build. Provider logging/retention gates
  remain open; an artifact scan does not establish their behavior.

Receipts and logs are retained in the private task directory's `release-20261103/`.
No consent, new message or production Gmail activation occurred in this deployment.

### Cross-account attachment check — 2026-11-03 UTC

The owner completed sign-in for the second approved pilot account. Its active
Google account was independently verified. A new synthetic CRM record was created
through the staging UI, and one message was queued once to that approved recipient.
Gmail acceptance and the recipient's Inbox arrival were observed separately. A
sender-and-marker search found exactly one matching synthetic message.

The saved draft survived a fresh login with five ready files totaling exactly
6,291,456 bytes: two JPEGs, a WebP, a one-page PDF and a PNG. The largest JPEG was
3,145,727 bytes. The generated files contain no customer content; legal JPEG
comment segments and a private PNG ancillary chunk provide exact boundary sizes.
Recipient-side downloaded-byte verification, private rendering and a native reply
remain pending. The initial RFC Message-ID search did not match; the received
header still needs inspection before treating this as reconciliation evidence.

The UI rejected an unsupported file and a file one byte above 3 MiB. The backend
also rejected a combined selection one byte above 6 MiB, preserving four saved
files, but its error appeared as a generic server failure. The targeted composer
correction in [Admin #299](https://github.com/JessePomeroy/admin-dashboard/pull/299)
adds a specific warning before reserving the extra file. Its browser regression
failed before the correction and passed afterward on desktop/mobile, including
retrying an interrupted file at the exact total limit. All 1,132 Admin tests and
package checks pass. The correction is not yet deployed to the pilot.

Admin 6.15.0 is confirmed in the registry. The patch release and exact host adoption
remain pending. [Backend PR #750](https://github.com/JessePomeroy/angelsrest/pull/750)
separates the additive backend deployment from the later host rollout. Production
Gmail remains unconfigured. Nonsecret receipts are retained in
`release-20261103/pilot-files-ui.json` and `recipient-arrival.json`; file hashes are
in `attachments/manifest.json` within that private task directory.

### Earlier staging checkpoint — 2026-11-02

- Convex functions and additive indexes deployed successfully to `rosy-firefly-366`.
- Host deployment `dpl_Cu7m58U6aTVW9mD5zKZebtgbmyhC` is Ready; Vercel's alias API
  confirms `staging.angelsrest.online` resolves to it in the staging project.
  The preceding host deployment above remains the rollback target.
- The host uses the locally packed Admin artifact with SHA-256
  `1508b422f0b85049a36763048e33bd3c914287eb37d7c9e721b25d9670b56e0a`.
  No package was published and no checked-in manifest/lockfile changed. Source and
  build file digests are retained in the private pilot release evidence directory.
- Staging-target build, size budget, Svelte check (zero errors/warnings), focused
  Biome check and 66 host Gmail/privacy tests passed. No Gmail server keys were
  found in the built output. The OAuth secret was not passed into the build.
- The published privacy route returns HTTP 200. Existing synthetic administrator
  password login returns 200; authorized Admin, inquiries and correspondence
  routes return 200. Before consent, Gmail status reported `configured: true`,
  `mailbox: null`. These initial HTTP observations are distinct from the subsequent
  browser acceptance recorded below.
- Unauthenticated Gmail status returns 403 and an unsigned push returns 503.
  At `2026-11-02T20:33:40.189Z`, real Pub/Sub delivery of a synthetic notice for a
  nonexistent `.invalid` mailbox received 204. This proves authenticated transport
  and safe unknown-mailbox handling; it does not prove Gmail synchronization.
- The operator cannot mint the push identity's tokens (403). No additional IAM
  privilege was added for testing; live wrong-audience/email/subscription checks
  remain pending, with offline verifier regressions passing.
- Google branding's homepage/privacy URLs were saved and verified after reload.
  Audience remains External/Testing with one approved test user. Subsequent mailbox
  consent, watch creation, self-send and PNG delivery evidence is recorded below.

The owner subsequently approved using the selected Google email as the staging
login. Its verified Google account already exists in the isolated Better Auth
deployment; the operator added that exact email to the existing tenant invitation
list using `platform:ensureSiteAdmin`. Existing stable membership and the synthetic
recovery account were preserved. The owner subsequently signed in and claimed its
stable identity through the existing authorized `adminAuth.claimAdminAccess` path.

The successful flow used **Sign in with Google** with the approved owner email,
then **Google connections → enable Gmail for my sign-in account**. The failed earlier attempt used sign-in
linking from the synthetic email to the different Google email; Better Auth rejects
that mismatch, while the completion page currently describes all callback errors as
canceled/declined. This wording is imprecise and has not been changed. Do not weaken
account-linking checks, substitute Google Cloud CLI authorization for mailbox
consent, or import existing personal conversations for the test.

### Consent completion repair — 2026-11-02

The owner signed in through Google and claimed stable staging membership. The
subsequent same-account Gmail consent saved both requested Gmail scopes and offline
access. Completion then failed in `gmailAuthLink:complete`: Better Auth 1.6.23's
refresh endpoint spread the existing account ID into its update, which the Convex
component rejected as an immutable `_id` field. This was a database-update failure
after successful consent, not a Google rejection.

The host-owned Better Auth account-update hook now removes the ID from that patch;
the account selector and stored identity remain unchanged. Two regressions using
the installed Better Auth/Convex component reproduced the error before the fix and
passed afterward, including rotating and retained refresh credentials. All 101
targeted authentication/Gmail tests and backend types passed; focused lint retained
five preexisting warnings. The backend fix deployed only to `rosy-firefly-366` at
`2026-11-02T20:57:28Z`; no host/package release was needed.

The rejected component call included OAuth token fields in private backend error
logs. The local diagnostic capture was sanitized; this does not remove the
provider's retained logs. With the owner's explicit authorization, the dedicated
pilot grant was revoked through Google Account connections and replaced before
mailbox tests. The separate production Angels Rest grant was left untouched, and
the synthetic password administrator remains available.

### Real consent and self-send acceptance — 2026-11-02

After grant replacement, the owner completed ordinary Google sign-in and the
explicit same-account Gmail upgrade through the staging UI. The callback returned
`gmail=connected`; a bounded backend projection confirmed `connected`, login-based
credentials, encrypted offline refresh access, a successful initial sync and a
watch expiring at `2026-11-09T21:18:28.917Z`. Subsequent authenticated notices and
sync checkpoints advanced without a stored sync error. This proves initial watch
installation, not future daily renewal or seven-day consent expiry behavior.

A synthetic client named **Gmail pilot self-test** was created in staging using
only the approved owner's address. Two messages were submitted through its actual
conversation composer, at approximately `21:22:13Z` and `21:27:49Z`. The application
reported Gmail acceptance. Separately, each exact message was located in the
approved account's Gmail Inbox; only the synthetic conversation was opened.

The first message revealed a MIME filename issue: Gmail displayed the literal
fallback `attachment`, although its 68-byte PNG matched the original. The composer
now emits one filename parameter: a quoted ASCII name or an RFC 2231 UTF-8 name.
Three filename regressions failed before the correction; all 60 focused Gmail
tests, backend types and focused lint passed afterward. An existing formatter
difference in the unrelated thread-preview block remains unchanged. The backend
correction deployed only to `rosy-firefly-366` at `2026-11-02T21:27:17.678Z`.

The second message retained `pilot-test-pixel.png` and `référence-pilot.png` in
Gmail. Both recipient-side attachment reads returned 200 and the original 68
bytes, with SHA-256 `5e3d382db4dd83d59aa5742793ad6b7903409e865c83bcbc54835049f043bc15`.
This is a real small-PNG round trip, not representative large-photo/PDF acceptance.
The conversation contains two accepted attempts, remains in the `waiting` state,
and has no duplicate normalized messages. Private receipts include
`mailbox-consent-acceptance.json`, `self-send-acceptance.json`,
`filename-fix-deployment.json` and `filename-recipient-acceptance.json`.

No second account's incoming reply, business-mailbox identity separation, recovery
fault injection or deployed latency distribution was established by these tests.

## Official Google requirements checked on 2026-11-02

- `gmail.readonly` is **restricted**; `gmail.send` is **sensitive**. Read access is
  needed for registered-thread history, contents and attachments; send access is
  needed for administrator replies. No modify, delete, settings or domain-wide
  delegation scope is requested. Gmail does not provide a per-selected-thread OAuth
  read grant for this web-server design. [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).
- Broader distribution requires the applicable brand/scope verification; server-side
  restricted-data access can also require a security assessment. Google documents
  a personal-use exception for a limited set of personally known users. An
  owner-only live connection may qualify, but that classification must be recorded
  before activation and does not establish eligibility for a general client rollout.
  A small paid client base does not make the app an internal organization app.
  [Restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).
- Development/testing apps can use the testing exception; Google still requires
  its data-use policies. Use a separate testing project, not an unverified general
  production rollout. [Verification exceptions](https://support.google.com/cloud/answer/13464323).
- External Testing is limited to listed test users (up to 100). Gmail consent and
  refresh access expire after seven days in Testing; basic sign-in-only scopes have
  a separate exception. Include that expiry in the pilot rather than hiding it.
  Workspace administrator restrictions may still block consent.
  [App audience](https://support.google.com/cloud/answer/15549945),
  [OAuth token expiry](https://developers.google.com/identity/protocols/oauth2/).
- The disclosed purpose is an email productivity interface, with only user-visible
  correspondence handling. Do not reuse Gmail content for advertising, unrelated
  profiling, model training, or autonomous privileged actions. Disclose transfers
  and permitted administrator access. Confirm the chosen permitted-use category
  and security/privacy obligations in the actual submission.
  [Workspace user-data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy).

The production submission packet should contain app ownership/domain proof,
branding/homepage/support contacts, accessible privacy/terms pages, scope
justification, a demonstration of separate sign-in and Gmail consent, explicit
thread association, export/deletion, data flow/storage boundaries and the assessor
or accepted exception evidence. No submission or assessment was performed here.

## Privacy and retention acceptance

Before retaining real pilot correspondence, record the approved accounts and
participants, who may administer the test site, and the following disclosure:

> Gmail access is optional and grants mailbox-wide read/send capabilities. Angels
> Rest imports only conversations explicitly associated with an authorized inquiry
> or client; a deliberate search briefly displays candidate snippets/metadata.
> Authorized site administrators can read linked correspondence. Drafts remain
> private to their authors in ordinary reads and exports. Email content is inert
> and cannot issue commands or trigger privileged actions.

The implementation enforces a deadline **30 days from creation of each local
conversation**, without extending it for later messages. This is a maximum: a reply
added near that deadline is retained for less than 30 days. Unsent cached file bytes
normally expire after 24 hours. Resolved send records and all associated drafts,
messages and attachment records are removed with the conversation. Minute-based,
bounded cleanup must be monitored; overdue cleanup is a fault, not a new policy.

Queued, submitting and uncertain sends hold the conversation and frozen evidence.
No negative Sent search proves that a message was not sent. Reconciliation checks the exact RFC Message-ID, then a bounded Sent metadata
scan for the server-created attempt header when Gmail replaces that identifier.
A unique match must also satisfy the thread, participants and subject checks. If it
cannot resolve the attempt, stop further use and obtain a separately approved
exceptional erasure procedure. **There is no erase-to-resend or force-clear button.**
Irreversible platform offboarding erasure is also blocked while such evidence is
unresolved, preserving the restoration path needed for reconciliation.

Site-wide Gmail erasure first stops synchronization and removes the connector's
refresh credential. It removes imported data, every administrator's related drafts,
cached file bytes, resolved attempts, push receipts and consent intents. The minimal
mailbox/site registry remains to prevent cross-site reassignment. Original Gmail
mail, the Google provider grant and Better Auth sign-in linkage are separate.
Combined sign-in/Gmail grants may remain in Better Auth until separately managed;
confirm an alternative login recovery method before revoking them.

External launch gates still required:

1. Set backup/snapshot retention and restoration procedures so erased or expired
   correspondence cannot be silently restored or retained beyond the agreed policy.
   Inspect the actual Convex plan/backups; do not claim application deletion erases
   provider backups. If the policy cannot be met, obtain a decision before pilot data.
2. Verify host/Convex/Google logs and error monitoring exclude bodies, filenames,
   search queries, tokens and callback codes. Set log retention and restrict staff
   access; retain only noncontent operational evidence needed for this pilot.
3. Agree how requests from mailbox owners and correspondents reach the operator,
   how holds are reviewed, and how exported/downloaded administrator copies are
   handled. JSON exports exclude credentials and other authors' private drafts;
   attachment originals are downloaded separately through authenticated reads.
4. Publish the reviewed privacy/retention/Limited Use disclosure on an app-owned
   verified domain before consent. Production retention requires a new decision.

## Historical release and adoption plan

The following plan records the original rollout order. Source delivery, additive
backend deployment, package publication and host adoption have completed as
recorded above. Do not repeat them as unfinished setup. Production mailbox
configuration and the live acceptance matrix remain separate.

Original feature commits are hub `b55c322c` and Admin `59cb8cc`; the separate release
branches merge maintenance bases hub `2f5ccbe99afbc650593617bcd817554edda0f73b` and
Admin `54f881e4757da025ddfe056c8df876a791bec4fa`. The original Changesets plan predicted
CRM API **6.13.1 → 6.14.0** and Admin **6.14.1 → 6.15.0**. These were candidates
at that checkpoint; CRM API 6.14.0 and the corrected Admin 6.15.1 were subsequently
published. Current host adoption is registry Admin 6.16.2.

1. With source-delivery authorization, commit/review both focused branches and
   their minor Changesets. Preserve all current feature work. Retain exact source
   SHAs, checks and the local package digest in the release record.
2. Deploy the additive schema/functions to the **approved isolated pilot backend**.
   The existing `deploy-shared-convex.yml` workflow targets production; **do not
   dispatch it to create the pilot**. The isolated deployment needs its own explicit
   deployment selection and approved credential path. Keep allowlists empty until
   accounts/recipients are approved. Existing hosts remain compatible without new refs.
3. Through the separately approved publication workflow, merge the CRM API
   Changesets version PR (`publish-crm-api.yml`) and the Admin version PR
   (`admin-dashboard/.github/workflows/publish.yml`). Verify immutable package
   versions in GitHub Packages. Source merge is not package-publication approval.
4. Prepare exact-version host adoption and lockfile changes only after publication.
   `adopt-admin-package.yml` accepts the published Admin version and reviewed release
   URL. This feature also requires the new host routes/configuration, so it is not
   an Admin-only dependency bump. Adopt the matching CRM API surface in any spoke
   only when its host explicitly opts in. No spoke adoption is part of this local task.
5. Build/check the exact host candidate and deploy the approved protected pilot
   preview with the isolated backend/configuration. Verify `/admin/correspondence`,
   `/api/admin/gmail/{threads,export/[conversationId]}` and the pre-existing OAuth,
   private-file and push routes. Preserve ordinary auth/session navigation tests.
6. Complete the live matrix below before requesting production launch. For a later
   production release, deploy additive shared Convex first, then adopt the exact
   compatible packages/host. Observe the actual deployed source/artifact/origin;
   follow [package release and adoption](package-release-and-adoption.md). Update
   Paper/inventory only after authorized shipping and confirmed live behavior.

The original local checkpoint used a **locally packed** Admin artifact and had
not changed the checked-in dependency/lockfile. That historical limitation was
superseded by published-package verification and the merged host adoption; it
does not describe the current host.

## App-owned OAuth and Pub/Sub configuration

Prepare a configuration record with nonsecret project ID/number, owner, region,
pilot origin, backend deployment, OAuth client IDs, topic/subscription resources,
push service identity, exact redirect/audience and the approval/evidence references.
Secrets belong in the approved host/Convex secret stores; do not paste them into
chat, runbooks, screenshots or commands that print them.

After explicit provisioning authorization:

1. Create/select the approved **Angels Rest-owned testing project**, enable Gmail
   and Pub/Sub APIs, set External/Testing audience with only approved test users,
   and configure branding/support/verified domain/privacy links. No service-account
   mailbox impersonation or domain-wide delegation is needed.
2. Create app-owned web OAuth clients. The pilot sign-in client and separate mailbox
   client must use the same project as the Gmail watch topic (or one client with
   independently registered redirects). Register the exact Better Auth callback
   from the pilot's actual auth base and the exact host mailbox callback
   `<pilot-origin>/api/admin/gmail/callback`. No wildcard redirects. Gmail scopes
   stay off the ordinary login request and are added only on explicit consent.
3. Create a dedicated topic and authenticated push subscription. Grant topic
   publisher access only as needed to `gmail-api-push@system.gserviceaccount.com`.
   Use a dedicated push service account and the exact
   `<pilot-origin>/api/webhooks/gmail` audience. Configure the subscription resource,
   JWT signing/IAM prerequisites, retry policy, dead-letter handling and alerts.
   Review access on the topic/subscription/service account rather than granting
   broad project roles. [Gmail push setup](https://developers.google.com/workspace/gmail/api/guides/push),
   [authenticated Pub/Sub push](https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions).
4. Install the purpose-separated secrets and encryption keys listed in the main
   runbook. Keep sign-in and mailbox credentials server-only. Set the exact approved
   address arrays in `GMAIL_PILOT_ALLOWED_MAILBOXES` and
   `GMAIL_PILOT_ALLOWED_RECIPIENTS`; missing/empty/malformed values fail closed.
5. Verify the deployed endpoint rejects missing, forged, wrong-audience, wrong-email
   and wrong-subscription pushes before connecting a mailbox. Then perform only
   the consent and sends explicitly authorized in the pilot matrix.

The connector watches all relevant mailbox changes, including Sent; it has no
INBOX-only filter. Google requires watch renewal at least every seven days and
recommends daily renewal. Notifications can be delayed/dropped, so the existing
one-minute catch-up remains necessary. [Watch lifecycle](https://developers.google.com/workspace/gmail/api/guides/push).

## Live acceptance matrix — partial real-provider acceptance

The checkpoints above establish owner login, explicit same-account Gmail consent,
initial watch/sync, two self-sends and small-PNG Inbox delivery. All rows without
an observed result remain pending; offline tests do not replace these live checks.

Use only the named test accounts and approved recipient addresses. Record exact
source/package/deployment/configuration identity, UTC timestamps, expected result,
actual result and sanitized evidence for each row. Never copy customer mail into
acceptance artifacts. Simulated provider tests do not satisfy any row here.

| Scenario | Required observed result | Observed live status |
|---|---|---|
| Ordinary admin login before Gmail configuration | Google/password/session navigation and stored membership work independently | Password and owner Google login passed earlier; updated candidate's recovery-account browser login/navigation passed after deployment. Full expiry matrix pending |
| Explicit same-account Gmail upgrade | Both scopes and offline grant verified; login identity/membership unchanged | Passed after grant replacement and account-update repair |
| Separate business mailbox | Different approved mailbox connects without a new login account or membership | Pending |
| Declined and partial consent | Clear recovery message, no false connection, ordinary login still works | Pending |
| Scope revocation / seven-day testing expiry | Sync/send pause, saved data retained, reconnect same mailbox, login recovery tested | Pilot grant revoked and fresh consent succeeded before first mailbox install; connected-mailbox revocation/expiry pending |
| Membership removed / foreign record | Reads, linking, mutations, export and every attachment read fail closed | Pending |
| Reviewed existing-thread link | Participants/destination/scope confirmed; duplicate retry is idempotent; another destination rejected; drafts excluded | Pending |
| Unexpected participants / oversized thread | Visible refusal/withheld state, no silent partial association or reply | Pending |
| Native Gmail incoming and Sent | Correct thread import/dedup, review/needs-reply/waiting transitions and date clearing | Admin-origin Sent observation/dedup passed for two self-sends. A native reply from the second approved mailbox imported once into the registered thread and set review; deployed review-state UI passed; native Sent checks remain pending |
| Representative files | Real approved JPEG/PNG/WebP/PDF, near 3 MiB, exactly 6 MiB combined, five-file selection; over-limit/unsupported rejection | Five files at exactly 6 MiB, including a near-3-MiB JPEG, uploaded and were accepted by Gmail; recipient Inbox arrival observed. All five recipient downloads matched their original SHA-256 fingerprints (6 MiB combined). All four image previews rendered through authenticated private reads. Native Chromium PDF rendering and all five original fingerprints passed again on November 9. Unsupported/per-file limits rejected; combined-limit warning correction is deployed and verified on staging. |
| Interrupted upload and private read | Reservation survives reload, incomplete send blocked, original retry works, logout/membership revocation denies reads | Pending |
| Authenticated push and replay | Valid Google JWT accepted only for configured service identity/audience/subscription; retry only acknowledges durable coverage | Real signed synthetic notice and mailbox notices observed; live negative/replay matrix pending |
| Lost notification and host downtime | Scheduled catch-up imports once; returning pushes do not skip pages or duplicate mail | Pending |
| Watch renewal | Daily/near-expiry renewal observed with actual Google expiry and no cursor reset | November 9 saved provider expiry advanced beyond the initial expiry, establishing renewal occurred. Exact daily cadence and a controlled near-expiry case remain unverified |
| Expired history and recovery interruption | Profile anchor, all registered threads, durable batches, catch-up; sends paused until complete | Pending |
| Lost send response | One submission only; uncertainty stays blocked; exact Sent reconciliation supplies evidence; no match stays held | Live provider probe reproduced replacement of generated Message-ID and preservation of the custom attempt header. Local fallback regressions passed; deployed fault-injection acceptance pending. See [recovery evidence](../verification/gmail-recovery-2026-11-03.md). |
| Export and 30-day cleanup | Complete authorized metadata/original downloads; cached bytes removed; holds preserved; backup/log procedure verified | Pending |
| Offboarding and rollback | Local credential removed, no import/send after fence, ordinary sign-in/grant handling distinct, evidence retained | Pending |
| Gmail acceptance and recipient delivery | Separately observe provider acceptance and the approved recipient's actual mailbox (including spam); never equate them | Passed separately for two self-sends and one five-attachment message to the second approved account's Inbox. All five recipient attachment fingerprints passed. One native reply from the second mailbox imported once into the same conversation and changed its workflow to review (observed through authenticated export and the deployed desktop/mobile conversation UI). |
| Deployed latency | Record provider receive/internal timestamp, authenticated notice, durable commit and visible UI update in desktop/mobile sessions | Pending |

For latency, use a declared sample count and retain individual durations, failures
and catch-up cases before summarizing median/tail observations. Include normal push,
missed-push and downtime recovery separately. Do not market the earlier 1.7–1.8 s
prototype samples as a production SLA. Delivery evidence requires recipient-side
observation and is separate from both acceptance and UI latency.

## Monitoring and rollback

Monitor per-mailbox operational state without message content: last complete sync,
last authenticated notice, watch expiration, lease expiry, pending offset/total,
recovery phase, reconnect/error state, queued/submitting/uncertain attempt counts,
retention holds and overdue cleanup. Alert on sync age >2 minutes, expired watch,
watch renewal failure, unprogressed recovery beyond two lease intervals, submitting
>2 minutes, any uncertainty, push retry/dead-letter backlog, or expired data still
present without a hold. These are investigation thresholds, not availability SLAs.

Use Cloud Monitoring/Pub/Sub delivery and backlog metrics, host response counts,
and Convex scheduled-function failures plus the authorized `connection`/`dataStatus`
projections. Counted fields are not presently a deployed telemetry exporter; assign
an operator and configure the actual alert delivery under the approved resource
plan. Measure cost during the pilot: one-minute catch-up and retention pagination
create work even with few push notices. Stop the pilot if its privacy boundary is
exceeded. The owner has waived a separate routine-usage
spending-cap gate for this pilot; an assessment purchase or materially larger paid
service remains a separate decision.

Rollback is an operator action, not an automatic resend/erase path:

1. Stop synchronization for the affected mailbox, verify its disconnected state,
   generation fence and removed connector refresh credential. Reconcile/retain
   already-submitted sends; stopping sync cannot recall an accepted email.
2. If provider access must be cut immediately, remove that mailbox from the pilot
   allowlist as an additional transport fence. Separately revoke the Google grant
   only with approval and a verified alternate login method. A failed remote watch
   stop still leaves local sync disabled; notifications can continue until expiry.
3. Hide/disable the Gmail opt-in on the host, or restore the exact prior host/Admin
   artifact under explicit deployment approval. Keep the recovery/export controls
   and compatible backend available where needed; removing host config alone does
   not stop scheduled backend sync.
4. Do not roll back the Convex schema over Gmail writes or delete cursors, attempts,
   attachments or keys needed to reconcile retained data. Prefer a forward backend
   fix. Retention continues under the approved policy; erasure is a separate action.
5. Verify ordinary login and unrelated admin/public flows, record which runtime was
   restored and re-run the relevant matrix before re-enabling Gmail. No billing,
   OAuth grants, package versions or other tenants change as an incidental rollback.
