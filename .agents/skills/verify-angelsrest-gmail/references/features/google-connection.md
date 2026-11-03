# Google connection

## Prerequisites

Confirm the target origin/backend and an administrator's stored site membership.
Establish the login identity separately from the mailbox. Never assume staging
shares production passwords. The default synthetic staging login is not the
owner's Google login. Use an existing secure credential channel or the already
authorized Google administrator; do not alter membership just to make a test pass.

The approved Google project/client, testing audience, callback URLs and mailbox
allowlist must match the launch record. Inspect configuration without printing
values of secrets. Retain a separate working login before a specifically authorized
grant-revocation test; do not revoke access during an ordinary connectivity check.

## Drive

1. Open the exact app origin at `/admin`, then reach inquiries or clients. Confirm
   the displayed administrator identity and usable navigation before enabling Gmail.
2. Open **google connections**. For an already-linked Google login choose **enable
   Gmail for my sign-in account**. For a different mailbox choose **connect a
   separate business Gmail**. The latter must not change the login or membership.
3. At Google, verify the intended account and actual requested read/send scopes.
   Stop for a personal security challenge that requires the user. Do not substitute
   Cloud CLI credentials for app mailbox consent.
4. Observe the completion page and resulting Gmail status. A successful callback
   alone is insufficient: confirm the persisted connected mailbox and advancing
   synchronization/watch state through authorized app status or a bounded projection.

## Error expectations

- Explicit `access_denied`: canceled/declined permission; no token exchange.
- Account mismatch: choose the matching sign-in account or the separate-mailbox path.
- Missing read/send/offline grant: request those permissions explicitly.
- Expired/used intent: begin a fresh request instead of reloading the callback.
- Server/provider failure: report an operator reference; do not blame user consent
  or instruct repeated permission resets without evidence.
- A mailbox associated elsewhere or a busy operation stays blocked without
  disclosing another tenant's identity.

`authOrigins.test.ts` exercises actual installed Better Auth/Convex refresh updates
with retained and rotated refresh credentials. `gmailAuthLink.test.ts` covers safe
failure propagation and grant requirements. Host tests and the local browser spec
exercise result classification and inert rendering with synthetic markers.

## Proof and limits

Record ordinary login, consent result, saved mailbox status, initial watch expiry
and first sync separately. Never record refresh/access tokens, authorization codes,
cookies or full provider exceptions. Initial watch installation does not prove daily
renewal. Fresh consent after revocation before mailbox installation does not prove
connected-mailbox revocation/expiry recovery. Consult current acceptance rows before
claiming either behavior.
