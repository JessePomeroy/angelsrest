# Client refund evidence

This consumer records individual customer refunds for checkouts with an original
`checkoutFinancialSnapshot`. It does not issue customer refunds, return application
fees, approve print allocations or infer a complete refund history from events.

## Adoption

The private host switch `CLIENT_REFUND_EVIDENCE_ENABLED` defaults off. Only the
exact value `true` enables the new consumer. Deploy and verify the additive
shared backend first, then enable the host under separate activation authority.
Source merge/hosting does not enable it. Leave it off while the release/backend
and provider acceptance gates remain open. Its scope is evidence capture, not
permission for the later guided refund producer.

With the switch off, existing event eligibility and whole-order reconciliation
continue. Connected-account Session lookups now have a 10-second timeout with no
SDK retries. Platform-account behavior stays on its existing path.

## Original identity and current provider facts

The existing signed `refund.created`, `refund.updated` and `refund.failed`
consumer validates its destination role, event/account/refund/payment IDs and
the unique paid Checkout Session. When enabled, every connected Session is
classified against the stored order or original bound admission before trusting
mutable metadata to identify an invoice or legacy checkout. A known financial
Session cannot lose its evidence protocol because a tenant marker is omitted or
its type is changed. Such conflicts retain attention state and require recovery.
Genuine historical or invoice checkouts without a financial record retain their
existing handling and do not create an evidence row.

`orders.beginClientRefundObservation` requires the hub secret, even for an
authenticated admin. It resolves the original snapshot and account scope, never
the client's latest connection. A retained admission with its original bound
Session provides context before paid intake has created the order. This lets a
refund arriving first survive and become visible when its order arrives.

The host verifies its configured Stripe platform account/mode, retrieves the
current Refund on the original connected account, and verifies its Charge on
that same account. Session/PI identity, tenant markers, currency/mode, captured
total, original subtotal, refund amount and charge relationship must agree.
All five reads have bounded request behavior for connected refunds; account,
balance and refund reads run together. No provider POST is called.

The signed event triggers a read; its old status is not the current-state
authority. A replayed success event after a later failure therefore records the
current failed status. Pending, requires-action, succeeded, failed and canceled
remain distinct. The provider refund's original amount, charge, payment and
checkout identities cannot be changed by a later status refresh.

## Persistence and recovery

`clientRefundEvidence` has one record per connected-account/refund ID, indexed
also by account/Session. It retains only identity, normalized amounts/status,
timestamps and bounded worker state. It stores no raw provider payload, customer
details, secret or print-allocation assumption.

A 90-second claim fences provider reads. Concurrent readers get busy; expired
or replaced tokens cannot complete or fail a newer observation. Initial claim
and expiry scheduling share a transaction. Expiry becomes explicit attention
without deleting earlier observed facts. Provider uncertainty retains attention
and asks Stripe to retry the webhook. A lost persistence acknowledgement can be
replayed without a second row or any refund POST. The backend expires abandoned
claims even if the host stops before recording an error.

`orders.listClientRefundEvidence` requires the stored order's site membership,
checks original financial identity and returns at most 50 observations with
`hasMore` if additional records exist. It hides claim tokens. Historical orders
report unavailable evidence. An empty list is **not proof of zero refunds**;
event capture is not a complete provider inventory.

## Fulfillment and later work

A partial refund observation does not mark the whole order refunded, cancel a
supplier order or change its fee record. Existing eligible single full-refund
and supplier-recovery handling runs after the observation and keeps its existing
fences. Genuine invoices and platform refunds remain outside this new record.

Guided execution still needs fresh, bounded provider-history reconciliation,
original-line allocation, cumulative cent rounding, separate customer/fee
operations, idempotency-window limits and coordination with supplier-failure
refunds. Multiple partial refunds totaling the payment are not treated as a
whole-order cancellation by this evidence-only slice. Do not activate guided
refunds based solely on this consumer. A later bank failure must remain visible
even if a fee was already returned; it is not authority for an automatic second
customer refund or a fee clawback.

Provider references: [refund object and statuses](https://docs.stripe.com/api/refunds/object),
[late refund failures](https://docs.stripe.com/refunds#failed-refunds), and
[bounded refund listing](https://docs.stripe.com/api/refunds/list).
