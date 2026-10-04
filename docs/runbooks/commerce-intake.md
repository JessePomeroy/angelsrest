# Durable commerce intake

This runbook covers the additive checkout inbox, hub runner and creator recovery
view. New acceptance is off by default. Shipping the code does not enable it.
The [contract](../contracts/commerce-event-inbox.md) defines scope and ownership;
[timing targets](commerce-intake-timing.md) distinguish fixture evidence from
production measurements. Invoice payments, refunds and account lifecycle events
retain their existing processing.

## Release order and activation

1. Deploy the reviewed shared Convex schema/functions after matching CI passes.
   Keep existing order and print-job APIs intact. Publish the matching CRM API
   package and verify its artifact before adopting the host changes.
2. Deploy the hub with the accepted-event guard, private runner and operator view.
   Leave `COMMERCE_INTAKE_ENABLED` unset or `false`. The guard still checks saved
   receipts before any synchronous fallback or producer-closure shortcut.
3. Under a separately authorized staging scope, configure a dedicated
   `COMMERCE_INTAKE_RUNNER_SECRET` of at least 32 characters on the hub and backend.
   It must differ from `WEBHOOK_SECRET` and `PRINT_FULFILLMENT_RUNNER_SECRET`.
   Do not print it or distribute it to a spoke. Set backend
   `COMMERCE_INTAKE_RUNNER_URL` to the HTTPS hub's
   `/api/internal/commerce-intake` route. The live backend accepts only the
   apex/www Angels Rest origins; the isolated staging backend accepts only
   `https://staging.angelsrest.online`. Each is pinned to its physical deployment.
   Redirects and alternate paths are rejected; see [staging setup](staging.md).
4. The backend requires `COMMERCE_INTAKE_SCOPES`, a closed JSON object such as
   `{"version":1,"sites":[{"siteUrl":"approved.example","mode":"test"}]}`.
   This example is not an activation instruction. The host also requires
   `COMMERCE_INTAKE_ENABLED=true`. Missing configuration disables new acceptance;
   malformed backend configuration fails closed. Test/live selection must match
   the hub's existing Stripe key; this release does not create a second provider
   client or change webhook destinations.
5. Verify the authorized staging matrix below, deployed runner authentication,
   creator access, timings and rollback before considering production activation.
   A source merge, empty queue, fixture pass or published package is insufficient.

Supported commerce events carry the pinned Clover API version and a bounded
64 KiB canonical replay projection. Convex derives ownership from the existing
order, reservation or admission evidence. Unsupported historical events without
an accepted receipt retain synchronous handling. Already accepted event IDs can
never use that fallback, including after the acceptance switch is disabled.

## Processing and completion

Acceptance commits the immutable receipt and an initial internal mutation in one
transaction. A claim commits its 150-second lease, expiry watchdog and external
dispatch together. The dispatcher requires at least 125 seconds remaining, uses
a 115-second HTTP deadline, and the host has a 120-second execution limit. A late
or missing dispatch is recovered through the durable watchdog. HTTP 200 from the
runner is not completion evidence.

Retries wait 30, 60, then at most 120 seconds. A processing cycle blocks after
12 claimed attempts or 23 hours. Receipt delivery retains its existing fixed
idempotency window; a new inbox cycle never restarts that window or clears a
provider claim. Print jobs keep their separate leases and recovery rules.

`done` requires a matching scoped order and separate customer/admin paid-receipt
acceptance, plus completed non-print intake or a durable print-job handoff. A
provider-authoritative completed refund (`refunded` with its stored refund proof)
is the documented receipt exclusion: the original payment receipt is no longer
sent after that reconciled outcome. A matching retired-session tombstone is also
terminal. Local fulfillment cancellation alone proves neither refund nor receipt
acceptance and remains blocked. Missing orders, uncertain receipts and unresolved
financial/provider evidence remain visible; they are not inferred from a resolved
handler promise.

## Operator review and recovery

Open **Platform → Review background checkout intake**. Choose the website and
state, then refresh to observe current records. Pages contain at most 25 events;
the backend caps all callers at 50. Event details show mode/account scope,
acceptance and claim times, attempts, saved reason and order reference. Customer
payloads, credentials and lease tokens are excluded. A record is overdue when its
next attempt/lease expiry is more than five minutes behind the observation time.

After fixing the actual cause, select an accurate recovery reason. The backend
requires creator membership, the exact site and current version. It records the
operator identity, previous state/version/reason and time. A recovery schedules a
new bounded cycle and retains lifetime attempts. At most three new cycles are
allowed, within 30 days of original acceptance. It never resets order, refund,
receipt or supplier effects. Active work cannot be superseded; completed receipts
cannot be reopened. A lost scheduled mutation remains visible as overdue and can
be recovered this way.

For uncertain receipts, invalid payloads or financial recovery, reconcile through
the existing order/provider workflow. Ordinary retry is unavailable. **Check the
saved completion evidence** can only close the record when the backend finds the
required persisted facts; choosing that reason does not assert those facts.

The creator-only `commerceIntakeInbox.inspect` query provides the bounded recovery
audit. Do not use raw replay payloads as operator notes, browser data or log text.
Background processing restricts structured logs and Sentry breadcrumbs to event,
level, stage and timing fields; errors are fixed codes. Synchronous logging keeps
its existing behavior. Inbox timestamps supply acceptance/first-claim evidence;
`commerce_intake.checkpointed` means an attempt was checkpointed, not necessarily
that the record reached `done`.

## Draining and rollback

Disable new acceptance first and keep the backend, runner credentials, scheduled
work and operator recovery available. List every approved site's pending,
processing, retry and blocked pages; an empty filtered page is not a drain proof.
Resolve or explicitly retain blocked work under an operator decision. Keep the
accepted-event guard even after the queue drains: completed receipts still prevent
an old webhook path from repeating intake. A host rollback may use only a version
that retains that guard and understands the stored protocol. Do not roll back the
backend or remove callbacks while accepted records depend on them.

This first implementation retains private payloads and compact receipt identity;
no prune job is installed. Do not delete nonterminal or blocked rows, routing
records, order/provider fences or completed deduplication receipts to clear a
status display. Future payload-only pruning needs a separately verified policy
that preserves tombstones and replay protection. Existing offboarding leaves
operational orders/routing records and this inbox intact.

## Failure verification and acceptance record

Offline checks cover actual Convex functions with networking disabled: concurrent
deliveries and claims; insertion rollback on scheduler failure; missing dispatch;
expired/stale leases; false callback success; separate receipt audiences and
uncertainty; trusted account history and foreign-account rejection; retirement;
attempt/age/recovery limits; scoped creator access; and accepted-event replay
with acceptance disabled. Host checks cover signature/destination ordering,
acknowledgement only after persistence, bounded authenticated callbacks, mode and
digest mismatch, private logs, and recovery forms. Browser fixtures use synthetic
records in desktop/mobile and both themes; they do not establish live creator
access or actual font fidelity.

Before activation, repeat the authorized staging journey with a successful Stripe
acknowledgement followed by a lost worker/callback, partial order/receipt
completion, provider uncertainty and exhaustion. Verify one order, stable receipt
idempotency keys, no duplicate supplier submission and visible recovery. Record
exact source/package/deployment/mode/site, observations and remaining gaps. Measure
the published timing targets with representative samples. Keep production
activation and customer service commitments separate from these source checks.
