# Completed commerce event inbox

This contract governs the additive background-intake implementation in roadmap
items 35–39. Backend deployment, package publication, host adoption, authorized
staging acceptance and production activation remain separate gates. New acceptance
is off by default; the accepted-event guard remains active when it is disabled.
See the [operating runbook](../runbooks/commerce-intake.md) for release and recovery.

## Scope and authority

The hub remains the sole commerce webhook owner. The initial background path
covers verified `checkout.session.completed` payment-mode Shop events. Invoice
payments, platform subscriptions, payment failures, refunds, account lifecycle
and other event types retain their existing dispatch paths. This contract adds
no Stripe destination, account, event subscription or client-spoke consumer.

The webhook verifies the original body and signature with the existing destination
secret, enforces the pinned Stripe API version, and checks that `event.account`
agrees with the verified Your-account or connected-accounts destination. Only
then may a server-only webhook capability submit evidence to Convex. Browser or
site-admin authentication cannot accept an event or read its private payload.

Convex derives session, mode, account and tenant scope from the verified envelope
and stored order/reservation/admission facts in the acceptance transaction.
Transaction-local readers in `helpers/orderRouting.ts` retain the existing
session-first precedence, retired-session fences, account ownership and tenant
marker conflict checks. The separate V2 routing and admission fallback results
remain compatible with existing hosts. A caller-supplied site or tenant string
is never sufficient authority. Marker-free or historical cases without the
required durable routing proof stay on the existing synchronous path before
acceptance; they are not guessed into a tenant queue.

Admission does not consume a checkout reservation, create an order, authorize
supplier submission or send a receipt. The worker reuses the existing checkout
snapshot/admission validation and order orchestration. A durable inbox row is
proof of accepted work, not proof that payment or fulfillment is complete.

## Immutable identity and replay evidence

Each accepted event has protocol version `1` and an immutable identity comprising
the verified Stripe event ID, live/test mode and account scope (`platform` or the
exact connected account). The saved destination role must agree with that scope.
A separate session identity lets operators relate distinct events for the same
Checkout Session without treating their payloads as interchangeable. The existing
Stripe Session ID remains the order-creation idempotency key.

The private replay envelope retains the verified event needed by the existing
processor, its pinned API version, event timestamp, role, session ID and a
canonical SHA-256 digest. The original signature and request headers are never
retained. Customer and shipping data inside the payload remain private operational
data; list/detail projections and logs must not include the envelope, metadata,
capability handles, recipient addresses, secrets or free-form provider errors.

The serialized envelope is capped at 64 KiB in UTF-8 before persistence. Validate
its closed intake classification and required typed fields before storing it;
unknown JSON does not become a typed Stripe event by an unchecked cast. The
record stores one bounded envelope, fixed state fields and counters, not growing
attempt arrays. Queries and cleanup operate through bounded indexed pages.
Oversize or malformed evidence receives no successful inbox acknowledgement.

A duplicate identity with the same canonical digest returns the existing receipt
without replacing payload, tenant, schedule, attempt count or lease. Conflicting
payload or account/mode/tenant facts fail closed. Also reject an already stored
event ID presented with a different account or mode; changing a scope field is
not a way to create a second receipt. Concurrent submissions converge
through a transactional indexed lookup and insert. Distinct event IDs for one
session may each be retained, but order, receipt and print-effect deduplication
remain owned by the existing order protocols.

## Acceptance and acknowledgement

Acceptance validates authority, envelope, scope and routing, writes the immutable
receipt and pending work, and schedules its first internal wakeup mutation in the
same Convex transaction.
The HTTP webhook returns success only after that mutation commits. A failed or
unconfirmed persistence call remains retryable by Stripe. If the transaction
committed but its response was lost, the next delivery recovers the same receipt.
Convex makes scheduling from a mutation atomic with the transaction; action
scheduling does not provide that guarantee.
[Convex scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions).

After durable acceptance, neither a dispatcher failure nor a later host error
returns ownership of recovery to Stripe. The inbox must retain and recover the
work even if Stripe never delivers it again. No fire-and-forget host promise,
process-local queue or successful HTTP response stands in for committed evidence.
Stripe documents duplicate deliveries and recommends asynchronous processing.
[Stripe webhook guidance](https://docs.stripe.com/webhooks).

## Processing state and leases

| State | Meaning and permitted transition |
| --- | --- |
| `pending` | Accepted and scheduled; an eligible atomic claim moves it to `processing` |
| `processing` | One current opaque lease token and expiry; the owner may complete or request a retry |
| `retry` | A bounded failure code and next eligible time; the next claim returns to `processing` |
| `done` | A versioned durable completion result passed the checks below; never rearmed automatically |
| `blocked` | Retry exhaustion, age bound, conflicting evidence or unresolved recovery decision; retained for operator review |

Every initial and retry wakeup is a scheduled internal mutation, not an action
that must later acquire a lease. That mutation atomically validates the expected
schedule, claims the row, schedules its lease-expiry watchdog and schedules the
external dispatcher action with the new lease. No external action can run before
those writes commit. A crashed action, including one that never reaches the hub,
already has a durable watchdog. Internal failures of the scheduled wakeup mutation
use Convex's mutation retry semantics; deployment/function-code errors must remain
visible as overdue pending/retry work for operator recovery, never as success.

Every private payload read and completion/retry write checks the current token
and unexpired lease. Stale callbacks cannot advance or erase a newer attempt. An
old scheduled wakeup also carries the expected next time so it cannot replace a
newer schedule. Actions are not relied on to retry themselves; Convex actions can
fail without automatic replay.
[Convex scheduled-function errors](https://docs.convex.dev/scheduling/scheduled-functions#error-handling).

Use a dedicated hub callback secret, distinct from the broad webhook capability,
and a fixed allowlisted HTTPS runner route. Callback input contains only the
inbox row ID and lease token, with a small body bound. The dispatcher cannot accept
a caller-selected URL, tenant, provider payload or notification recipient.
Use a 150-second lease, a 120-second host maximum and a 115-second dispatcher
request deadline. The expiry watchdog then schedules the bounded retry delay;
crash recovery must make another attempt eligible within the five-minute target.
These deadlines bound ownership, not the completion of remote side effects.

The worker calls the existing order-intake boundary with the retained verified
context. Receipt handling remains before fulfillment; a receipt retry cannot erase
an order or prevent the existing print job from progressing. Frozen print jobs
keep their own dispatcher, leases, artifact checkpoints and provider ownership.
Inbox completion records intake completion, not print delivery completion.

Completion uses a versioned explicit result checked against persisted data in the
lease-owned completion mutation. A fulfilled promise, callback HTTP 200 or order
existence alone is insufficient. The permitted successful outcomes are:

- A matching scoped order with the required receipt outcome/checkpoints and
  completed intake or durable handoff to its existing print job. Paid receipts
  require separate customer/admin acceptance checkpoints. Any documented receipt
  exclusion must be backed by the existing stored order state, not a caller flag.
- A provider-authoritative completed refund: stored `refunded` status plus its
  refund identifier or succeeded automated refund checkpoint excludes sending
  the original paid receipt. Local fulfillment cancellation is not this proof
  and remains blocked for financial reconciliation.
- A matching authenticated retired-session tombstone with no conflicting live
  order, using the existing routing checks.

Outside that verified refund exclusion, missing customer email currently causes
a normal early return before order creation; that path must produce a fixed retry/blocked intake outcome for the
background worker. Missing orders, pending receipts and uncertain receipt delivery
cannot become `done`. Uncertainty or an excluded receipt requiring a decision
must remain `blocked` with its scoped order/reason and durable operator-recovery
ownership. These additional background completion checks preserve the current
synchronous API while making the new acknowledgement guarantee explicit.

Leases limit concurrent intake attempts; they cannot cancel a provider request
already in flight. Existing order/provider/email claims, idempotency keys and
uncertainty checkpoints remain mandatory effect fences. A timeout never clears
a provider claim, refunds an order by inference, or permits a fresh supplier POST.

## Retry, retention and operator recovery

The implemented automatic cycle is capped at 12 claims or 23 hours. After fixing
the cause, an authenticated creator can grant at most three further cycles within
30 days of original acceptance. Each grants a new bounded cycle, preserves lifetime
attempt counts and records actual operator identity, prior state/version/reason,
and time. It does not renew receipt idempotency windows or clear effect fences.
Uncertain receipts, invalid retained payloads and financial recovery cannot use
ordinary retry. Checking saved completion evidence changes state only when the
same backend completion predicate succeeds. The creator view is bounded and
refresh-driven; raw replay data and lease tokens never reach it.

Retries use fixed failure categories and delays of 30, 60 and then 120 seconds
(capped). Block after 12 failed/expired attempts or 23 hours in the current cycle,
whichever happens first; duplicate deliveries do not reset either bound. These
limits do not extend any existing provider-key or receipt uncertainty window. An
ambiguous effect remains subject to its existing reconciliation rules even when
the inbox itself is eligible to retry. Exhaustion becomes visible `blocked` work;
it is never silently treated as success or discarded.

Creator-only operator projections show scope, bounded identifiers, acceptance and
claim times, attempt count, next eligibility, state and a fixed failure reason.
They exclude payloads and secrets. Recovery requires the stored scope and current
state/version; it cannot modify original evidence, reset provider fences or rearm
a completed receipt. The implementation must record the operator and recovery
decision. Unknown provider outcomes require the existing separate reconciliation.

Do not automatically remove accepted nonterminal or blocked work. Completed payloads
may be pruned only under an explicit bounded retention operation after at least
30 days, retaining a compact immutable receipt with identity, scope, digest and
completion time. Retired order/session fences survive independently. The initial
implementation may retain completed payloads without pruning; it must report
that limitation and must not claim a retention job exists before it ships.

## Rollout and rollback

Deploy compatible additive backend persistence and runner contracts before any
host admits background work. Default new acceptance to off. Test-only activation
requires an explicit authorized mode/site scope and a verified runnable target;
source merge, package publication and an available secret do not enable it.
No runtime switch may route accepted work back through an unguarded synchronous
path or change its stored tenant, event or account.

Turning off new acceptance must leave receipt-aware webhook ingress available.
After signature/destination/envelope validation, existing accepted receipts are
resolved before acceptance flags, producer-closure checks that would reject the
accepted work, or synchronous fallback. Duplicate accepted events acknowledge the
saved receipt without entering synchronous intake; conflicting evidence still
fails closed. Only never-accepted events may use the previous synchronous path.

Keep a compatible runner while pending, leased, retrying or unresolved blocked
work remains, and drain under its saved protocol. Separately, retain a compatible
receipt-aware webhook host/shim for all retained accepted identities, including
completed tombstones. An empty active queue or a surviving runner alone never
makes an old unguarded webhook compatible. Roll back other host behavior behind
that ingress guard; keep the additive backend and evidence it needs. Removing
the receipt protocol requires separate consumer/retention/rollback evidence.

Before production activation, verify authorized staging acceptance, persistence
failure, duplicate/concurrent delivery, lost responses, failed initial/retry
wakeups, dispatcher failure before its callback, worker crashes after each
checkpoint, missing-email/no-order returns, receipt uncertainty, stale leases,
wrong account/mode, provider uncertainty and exhaustion. Verify duplicate pending
and completed events after disabling acceptance and during/after drain/rollback. Prove recovery after an observed successful Stripe acknowledgement.
Measure the acknowledgement, first-claim, order-recording and recovery targets in
[the timing runbook](../runbooks/commerce-intake-timing.md); controlled fixtures do
not establish production latency. Activation and client sales readiness remain
separate decisions.
