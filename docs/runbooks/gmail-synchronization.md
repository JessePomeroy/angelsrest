# Gmail conversation synchronization

This is the implementation and incident reference for optional inquiry/client
correspondence. `/admin/messages` remains platform chat. The
[launch packet](gmail-pilot-launch.md) is the sole current deployment and acceptance
record; dated local verification reports describe their own runs only. Use the
[Gmail verification skill](../../.agents/skills/verify-angelsrest-gmail/SKILL.md)
for repeatable checks and resuming a partially completed run.

## Ownership and scope

- `packages/crm-api/convex/gmailConversations.ts` authorizes site membership and the inquiry/CRM feature before every record, draft, send, or file operation. Recipient and subject come from the authorized stored record. Subject/sender similarity never joins records.
- `gmailState.ts` owns durable mailbox cursors, leases, message deduplication, drafts, attachment reservations, and send attempts. `gmailNode.ts` owns Google transport, encrypted refresh credentials, and scheduled recovery.
- `src/lib/server/gmail/` owns host membership checks, same-origin writes, consent cookies, private file transport, and authenticated Pub/Sub intake. Shared admin components hold no provider credentials.
- The optional shared admin Gmail API and endpoint configuration opt a host in. Older hosts retain their Google-only linking behavior. No new production dependency is required.

An admin's first reply enrolls a new Gmail thread against one stored inquiry/client. Subsequent incoming messages and native Gmail Sent replies in that exact thread appear reactively. Existing threads can be linked only through a user-started bounded search, metadata preview, and explicit association confirmation. Search returns at most ten candidates; a selected thread is limited to 200 provider message entries. Nothing joins by sender or subject, and no bulk inbox import exists. One mailbox belongs to one site; reconnect preserves its address and cursor. Mailbox reassignment is deliberately rejected.

## Google connection UX

After signing into admin, **Connect Google** opens two separate states: admin sign-in linkage and Gmail connection health. A new link defaults to Google sign-in only; an explicit checkbox adds Gmail read/send consent for the same account. Already-linked users retain an Enable Gmail/reconnect action. Better Auth **1.6.23** supports `linkSocial` additional scopes; scopes are passed only on that explicit action, never in the login-page provider configuration.

A separate business mailbox uses the app-owned web OAuth client and PKCE flow. Its Google consent never calls `linkSocial`, creates a login account, or changes site membership. Clients consent directly at Google: no password sharing, downloaded client JSON, or client-owned Cloud project is required.

A completed intent is identity/site-bound, expiring, single-use, and requires current membership. Both actual granted Gmail scopes plus offline refresh access are required; linked-account installation also verifies the Gmail profile address equals the verified login email. Declining/partial consent leaves admin sign-in usable and displays recovery guidance. Provider access-token/refresh-token HTTP endpoints are blocked; trusted session-authenticated server API calls remain available.

Connection completion distinguishes cancellation, missing permissions, account
mismatch, expired/used intent, unavailable mailbox, busy operation and server
failure. Both connection paths use the host's result page for failures. Unknown
provider errors are server failures; they are not evidence of declined consent.
The host logs only `Gmail connection failed` plus a reference ID, known code and
operation stage. Support references are safe opaque identifiers, not credentials.
The backend replaces caught SDK errors with that bounded failure vocabulary before
returning them across action boundaries. Do not log the caught object or its cause.
This does not control provider/platform-internal logging of failed arguments; the
installed-library refresh regression separately protects the known immutable-ID
failure. Check the launch packet before assuming these local changes are deployed.

**Stop synchronization** fences current work and erases the connector's local refresh credential, then attempts to stop the Gmail watch. It preserves imported conversations/drafts and does not unlink Google sign-in or revoke Google's grant. A failed watch-stop still leaves local synchronization disabled. Unlinking sign-in and revoking the Google project grant are separate actions. Project-level revocation can affect combined identity/mail scopes; retain another verified login recovery method. A send already submitted to Gmail cannot be recalled by stopping sync.

References: [Better Auth additional Google scopes](https://better-auth.com/docs/authentication/google#requesting-additional-google-scopes), [Google web-server incremental consent](https://developers.google.com/identity/protocols/oauth2/web-server#incrementalAuth).

## Server configuration gate

An operator must approve/configure Angels Rest-owned Google resources separately. Do not reuse the Graham experiment project or credentials. This implementation does not authorize provisioning or billing changes.

| Variable | Host | Convex | Purpose |
|---|---|---|---|
| `GMAIL_CONNECTOR_SECRET` | yes | yes | Dedicated >=32-character server capability, disjoint from other server roles |
| `GMAIL_OAUTH_STATE_KEY` | yes | no | Separate base64url-encoded 32-byte AES-GCM consent-cookie key |
| `GMAIL_TOKEN_ENCRYPTION_KEY` | no | yes | Separate base64url-encoded 32-byte mailbox refresh-token encryption key |
| `GMAIL_OAUTH_CLIENT_ID` | yes | yes | App-owned web OAuth client for the separate business mailbox flow |
| `GMAIL_OAUTH_CLIENT_SECRET` | no | yes | That client's secret |
| `GMAIL_OAUTH_REDIRECT_URI` | yes | yes | Exact canonical origin plus `/api/admin/gmail/callback` |
| `GMAIL_PUBSUB_TOPIC` | no | yes | Full topic resource, same Google project as the watch client |
| `GMAIL_PUBSUB_SUBSCRIPTION` | yes | no | Exact expected authenticated push subscription resource |
| `GMAIL_PUBSUB_AUDIENCE` | yes | no | Exact canonical origin plus `/api/webhooks/gmail` |
| `GMAIL_PUBSUB_SERVICE_ACCOUNT` | yes | no | Expected push identity email |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | existing | existing | Existing Better Auth Google client, also refreshes an explicitly upgraded sign-in grant |
| `GMAIL_PILOT_ALLOWED_MAILBOXES` | no | yes | Exact approved lowercase test mailbox addresses as a JSON array, maximum 25 |
| `GMAIL_PILOT_ALLOWED_RECIPIENTS` | no | yes | Exact approved lowercase recipient addresses as a JSON array, maximum 25 |

The Google sign-in OAuth client and mailbox OAuth client must belong to the same app-owned project as the Gmail watch topic (or use the same web client with the separately registered redirects). The application still treats business mailbox consent independently from account linking. Add only the required redirects and verified app origins; never broaden account-linking email rules. Grant the Gmail publisher identity topic publish access, configure authenticated Pub/Sub push to the exact endpoint/audience/service identity, and configure its retry/dead-letter monitoring. Provider scopes are `gmail.readonly` and `gmail.send`. Scope verification, app ownership/branding, published privacy disclosure, and Google verification/assessment remain launch gates. Missing, empty, or malformed pilot allowlists fail closed. Allowlist checks run before provider access and at the final send claim; removing an approval cannot silently authorize another account or recipient.

Publish the shared backend API and admin package through the existing authorized release workflow before production host adoption. The isolated staging pilot uses the verified locally packed admin artifact; its checked-in dependency range/lockfile is intentionally unchanged until publication is authorized. No package was published. The isolated backend and host deployment are recorded in the launch packet.

## Sync, persistence, and sending

Watches cover received **and Sent** changes; native Gmail drafts are skipped until they become Sent messages; there is no INBOX-only filter. Watches renew daily/near expiry. Normal authenticated notices run sync immediately; a one-minute scheduled catch-up recovers missed notices. A few-second healthy update is a goal, not a proven deployed SLA.

Gmail numeric history IDs remain lossless decimal strings using a runtime-compatible JSON tokenizer. Mailbox cursors, Gmail message IDs, RFC Message-IDs, and Pub/Sub delivery IDs are distinct. Every history page is staged durably; bounded batches commit imported messages and checkpoint progress atomically. The complete cursor advances only after the final page. The HTTP adapter acknowledges only a durably covered notice; interruption returns 503 for retry. Message-ID deduplication is mailbox-scoped. Leases fence stale/concurrent workers.

Expired history triggers a profile anchor and a paginated resync of registered threads, followed by history catch-up. Recovery refuses oversized pages/threads rather than silently skipping them: up to 2,000 message references per history/recovery page and 2,000 messages per registered thread. Sending stays paused during failed or incomplete recovery. Very large or unusual mailboxes need an explicit acceptance check and, if necessary, a reviewed limit adjustment.

Sends freeze the stored recipient, subject, plain text, file IDs, draft/conversation revisions, and an RFC Message-ID in a durable attempt. A final claim rechecks target ownership, current recipient, mailbox generation, and conversation state after synchronization. Only that claim can submit. Duplicate jobs cannot downgrade another worker's in-flight attempt. A response lost after submission becomes **uncertain**, blocks further sends, and is never automatically resent. Reconciliation first checks the exact RFC Message-ID. Gmail can replace that header, so new submissions also carry the server-created attempt ID in `X-Angels-Rest-Send-ID`. When the RFC lookup is empty, recovery scans at most 100 Sent-message references from one minute before submission through the following 24 hours and reads only that custom header until it finds a unique match. A paginated/incomplete scan, missing or duplicated marker, or mismatched thread, participants or subject leaves the attempt unresolved. The full matched message supplies the actual provider Message-ID for subsequent replies. Older submissions without the marker cannot use this fallback; absence never permits another send. “Accepted by Gmail” does not establish external inbox delivery.

## Content, files, and retention

Email content is inert untrusted data. Only escaped plain text is rendered; no provider HTML, remote images, scripts, or email instructions run. Unexpected participants/ambiguous headers withhold content and pause replies. Email cannot trigger payment, booking, automation or AI actions. A From header is not proof of sender identity and never establishes admin/client access. HTML-only/oversized messages show explicit withheld/truncated notices for review in Gmail.

Supported files: JPEG, PNG, WebP, PDF; **3 MiB/file, 6 MiB total/reply, five selected files**. Per-file limits leave room under the host request-body and Convex action limits. File signatures, declared size/type and original SHA-256 are checked. These checks are not malware scanning. Incoming unsupported/oversized files retain visible blocked metadata.

Private file reads require a current session plus record/site authorization on every request. The host proxies verified bytes with no-store/no-referrer, nosniff, sandbox CSP, and a safe filename. No bearer storage URL is returned to the shared UI. PDF/image rendering remains untrusted; review deployed browser isolation before production use.

Selecting a file persists its draft reservation before upload; interrupted uploads survive reload and block sending until the original file is reselected or removed. Private storage objects carry a connector-only content-type marker. A daily bounded, paginated sweep removes only marked unreferenced objects older than 24 hours, including uploads whose response was lost. Unsent file bytes expire after 24 hours unless frozen by an unresolved send. Returning Sent metadata replaces the admin's cached bytes when the attachment identity matches. The pilot expires each conversation 30 days after its local creation, including all later messages, drafts, attachment metadata/cached bytes, and resolved attempts. Incoming activity does not extend that deadline. A minute-based bounded cleanup removes expired conversations; overdue cleanup is monitored as a fault. Queued/submitting/uncertain sends hold the complete conversation and frozen evidence. Stopping synchronization is not erasure.

Existing offboarding fences synchronization, erases the local connector refresh grant, and prevents subsequent mailbox/record operations through the stored site boundary. It does not revoke Google’s project grant or guarantee that the existing remote watch has stopped; authenticated notices for a disconnected mailbox are acknowledged without import until the watch expires. The Gmail-specific export/deletion controls are separate from website-content export and ordinary CRM erasure. Inquiry/client deletion now refuses to orphan a Gmail association; offboarding inquiry cleanup retains those records until Gmail cleanup completes. The approved pilot policy and the unresolved-send hold apply independently of ordinary CRM retention. Never erase an uncertain attempt to enable resending. Production retention, backups/logs, and any exceptional erasure procedure remain explicit launch decisions.


## Explicit association and correspondence workflow

The picker searches only on an administrator action, then previews the selected
thread's subject, participants, message count, mailbox, destination record and
scope. It never saves a preview body. Native Gmail drafts are excluded. A
10-minute encrypted confirmation binds the identity, authorized record, current
recipient, mailbox generation and exact metadata snapshot. Confirmation refetches
metadata and atomically rechecks authority; changed participants, a changed record,
reconnection, tampering or expiry require a new preview. Unexpected participants,
Bcc or ambiguous headers block association. There is no override that changes
record ownership from mail headers.

One mailbox/thread has one primary record association. Repeating confirmation for
that record returns the same conversation; another destination is rejected.
Association fences the current worker and reuses registered-thread recovery from
the durable cursor. Partial imports remain visible and block sends. Retry resumes
checkpoints and deduplicates by mailbox/message ID. A complete registered-thread
scan immediately schedules history catch-up; sends and push acknowledgment remain
paused until that catch-up commits. The 200-entry picker cap and the existing
2,000-reference recovery cap fail visibly rather than importing a partial scope.

`/admin/correspondence` is the optional, paginated Gmail queue. Every returned row
rechecks its inquiry/client authorization. It links directly to that record and
conversation; `/admin/messages` remains platform chat.

- New relevant incoming mail becomes **review needed**, unless already marked
  **needs reply**. Incoming mail never asserts that a response is required.
- Administrators choose **review needed**, **needs reply**, **waiting**, or
  **done / no reply needed**, and optionally set/clear a follow-up date.
- A newer observed Gmail Sent reply sets **waiting** and clears the follow-up.
  This includes replies sent directly from Gmail. An admin acceptance response
  alone does not supply the authoritative Sent timestamp.
- Older messages and duplicate imports cannot undo a manual state. A genuinely
  newer incoming message reopens review. Withheld messages pause replies and show
  their problem without treating their content as authorized incoming mail.
- State updates compare the conversation revision. A concurrent new message asks
  the administrator to review again instead of silently overwriting it.

## Reading and private files

Quoted lines, recognized forwarded-history delimiters and the standard plain-text
signature separator can be collapsed and expanded. **Show full message** restores
the exact stored text; folding never modifies the stored message. The complete
provider original still lives in Gmail when an imported body was truncated or
withheld. No email HTML or remote images are rendered.

**Open in Gmail** is available only for a validated RFC Message-ID, using Gmail's
exact Message-ID search and the connected mailbox as the account hint. Confirm the
account shown by Gmail; browser account selection is a live-pilot acceptance gate.
See [Gmail search operators](https://support.google.com/mail/answer/7190).

Image previews load only after a click through the authorized private endpoint.
They revoke local object URLs on close/unmount and expose a retry on read/decoding
failure. PDF originals open through the isolated private response. Downloads use
`Content-Disposition: attachment`; neither path exposes a storage bearer URL.
Representative real files and native PDF viewer behavior remain live acceptance.

Limits remain **3 MiB/file, 6 MiB/reply, five selected files**. Vercel currently
caps ordinary function request/response bodies at 4.5 MB; a 3 MiB original plus
multipart overhead fits while larger originals may not. Convex Node action
arguments have a separate 5 MiB ceiling; the connector passes IDs to the send
action and builds MIME from private storage inside that action. Base64 MIME plus
base64url transport expands a 6 MiB attachment set to roughly 10.7 MiB before
headers/line wrapping. Gmail's larger allowance would not remove the host limit.
No limit was increased. [Vercel limits](https://vercel.com/docs/functions/limitations),
[Convex limits](https://docs.convex.dev/production/state/limits).

Optional resizing investigation: a browser-created JPEG copy could reduce a phone
photo without a production dependency, but it must present dimensions, byte size,
quality/metadata loss and a separate **attach copy** choice. HEIC support, image
orientation, color profiles and large decode memory need representative tests.
That conversion is not implemented or silently enabled. Today the administrator
can explicitly export a smaller copy before selecting it. Larger photo deliveries
should use an existing private delivery gallery: review its recipient, password,
expiry and download permissions, then paste the intended recipient link. No gallery
is created, published or shared automatically by this Gmail feature.

## Data controls and recovery

Conversation export produces versioned JSON containing imported plain text, the
current administrator's saved draft/private attempt text, shared send evidence and
authorized attachment metadata. Attachment bytes are separate **download original**
reads; this is not a ZIP archive. Other administrators' private drafts and all
credentials are excluded. Every export page reauthorizes the record; the final
revision is checked before delivery. The browser download fails without a partial
artifact if metadata exceeds 4 MiB or 100 pages per section. For larger records,
an authorized operator can use `exportContext` and cursor-based `exportPage` reads,
rechecking revisions and fetching each permitted attachment through the private
host endpoint. Downloaded exports are administrator-controlled copies and need
separate secure storage/erasure handling.

Per-conversation deletion requires an explicit confirmation. Site-wide deletion
in **correspondence → Gmail data and offboarding** first requires completed
**Stop synchronization**, then the exact mailbox address. Both refuse an unresolved
send. Cleanup fences new imports/writes, deletes cached storage before attachment
rows, then messages, all associated drafts and resolved attempts in repeatable
batches. The mailbox/site ownership registry remains; deletion never permits
mailbox reassignment. No Gmail original or Google grant is deleted.

| Observed condition | Safe next action | Resolution evidence |
|---|---|---|
| Stale updates or transient interruption | Sync now; wait for the current 90-second lease to finish/expire | Complete cursor advances, last sync becomes current, no pending page/error |
| Expired/revoked or partially removed access | Reconnect the same approved mailbox; ordinary login remains separate | Current grant/profile verified and catch-up completes |
| Incomplete recovery | Resume sync; if the checkpoint cannot progress, explicitly restart registered history recovery | Fresh provider anchor, bounded registered-thread pages, then committed history catch-up |
| A thread exceeds bounds or has unexpected participants | Review in Gmail; keep replies paused, do not change ownership/limits automatically | Specific reviewed limit change or a separate valid conversation; no false success |
| Queued send | Allow its existing job to finish; stopping sync can make it fail before submission | Existing attempt becomes failed or accepted; no replacement job with new identity |
| Submitting/uncertain send | Check Gmail Sent using the existing attempt | Timestamp and outcome: unique exact acceptance, no match, ambiguity, mismatch, or unavailable |
| No match in Sent | Keep the hold; retry reconciliation after restoring access or escalate to the operator | Absence is not proof of non-send and does not permit erasure/resend |
| Expired retention with unresolved send | Review the hold and reconcile; obtain a separately approved erasure procedure if reconciliation is impossible | No credentials/body/attachment evidence is discarded just to unlock another send |
| Offboarding | Export/reconcile first where possible, disable access, complete Gmail cleanup under creator authority, then erase eligible inquiry/client records | Connector credential removed; Gmail data cleanup confirmed; provider grant separately reviewed |

An already-offboarded site's ordinary members cannot perform Gmail operations.
The authenticated creator can inspect/purge its retained data via the same
site-authorized Convex operations; restoration and fresh consent are required if
provider reconciliation needs access again. Never erase the underlying record to
bypass a hold. This is intentionally distinct from revoking Google's project grant
or unlinking the Better Auth sign-in account. A combined sign-in grant may still
exist in Better Auth; stopping the connector removes its encrypted refresh copy,
not the independent login account. See Google's
[connection-management guidance](https://support.google.com/accounts/answer/13533235).

## Local verification and remaining acceptance

Offline Convex tests exercise actual mutations/actions with synthetic provider responses: tenant boundaries, atomic rollback, pagination, cursor fencing, expired history, native Sent deduplication, revoked refresh, separate mailbox identity, interrupted uploads, orphan cleanup, draft CAS, intent replay and uncertain sends. Host tests verify cryptographic JWT signatures/claims with synthetic RSA keys and durable acknowledgment behavior. Auth tests exercise installed Better Auth per-link scopes and ordinary login without Gmail configuration. Component tests retain legacy host behavior and exercise optional consent, existing-link upgrades, partial consent, separate business connection and status failures.

`admin-dashboard/tests/fixtures/gmail-conversations/verify.mjs` drives the real shared inquiry/client modals and Google dialog at 1440px and 390px with a reactive synthetic adapter. All external requests are blocked. It verifies inert mail content, reactive updates, save/reload recovery, interrupted-file blocking, uncertain-send blocking, consent upgrade, keyboard/native dialog behavior and horizontal fit. This proves rendered UI behavior, not a deployed Gmail round trip.

The local checks below used synthetic data and no real provider calls. Subsequent
real consent, sending and recipient observations belong to the dated live section
and acceptance matrix in the [launch packet](gmail-pilot-launch.md). Consult those
rows for remaining work rather than treating this historical local record as the
current connection status. Publication and production adoption are separate actions.

Recorded local checks (2026-11-01): full shared-admin suite **1,128 passed**;
updated Google-control suite **20 passed** (including the added stale-status
regression); focused hub/Convex/auth/privacy/security suites **118 passed**.
Both Svelte checks reported zero errors/warnings; Convex TypeScript and package
consumer contracts passed. Admin packaging, server-entrypoint checks, host
production bundling and lint passed. Repository lint retains warnings; no
production dependency or lockfile was changed. The host build used a locally
packed shared-admin artifact, synthetic Convex URLs and no provider credentials.
The rendered fixture passed at 1440×1000 and 390×844 with all external requests
blocked. Its adapter simulates provider updates; deployed latency/consent and
actual private storage transport remain separate acceptance gates.

The [2026-11-02 local verification record](../verification/gmail-local-2026-11-02.md)
records the original continuation's local checks. Later focused results are linked
from the launch packet; totals from different runs are not added together.
