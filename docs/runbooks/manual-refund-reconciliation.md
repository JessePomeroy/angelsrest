# Manual refund reconciliation

Use this runbook when a signed Stripe refund event intersects an uncertain or
in-flight print order. It describes current operation; the full pre-AR-04 design
record remains in
[`../migrations/architecture-pre-ar04-2026-09-03.md`](../migrations/architecture-pre-ar04-2026-09-03.md).

## Authority

Only signed `refund.created`, `refund.updated`, and `refund.failed` events enter
the normal path. A full succeeded USD refund must resolve to exactly one paid
Checkout Session in its verified platform or connected-account scope. Partial,
automated, ambiguous, or conflicting evidence fails closed.

Stripe event context is Stripe lookup context only. It never becomes tenant,
site, connected-account, or Convex authorization. A successful reconciliation
marks the eligible order refunded, stores the provider refund ID, cancels
pending fee capture, sends no manual-reconciliation email, and leaves checkout
snapshot reservations unchanged.

## Safe sequence

1. Keep or close the narrow producer gate if new provider work could race the
   investigation.
2. Verify the signed event role, API version, Stripe account scope, Session,
   amount, currency, and persisted order identity.
3. Inspect the durable fulfillment phase. Never treat a missing provider result
   or expired lease as proof that submission did not occur.
4. Let an in-flight legacy claim converge through its owning host and Stripe's
   signed retry. Do not acknowledge and lose a retryable signed event.
5. For current coordination, accept only a tokenized completion or an
   authoritative provider GET result. Do not issue a second provider POST.
6. Record the normalized blocked or completed state and retain provider and
   deployment identifiers without copying secrets or customer data.
7. Resume the narrow producer only after the authoritative state is terminal
   and the compatible host/backend pair is verified.

## Failure and notification rules

Repeated provider reads use bounded classes and attempts. Age or attempt limits
escalate to operator review without asserting provider absence. Automated
refunds retain their provider ID and status; only `succeeded` authorizes the
terminal customer/admin success notification. Failed, canceled, exhausted, or
unknown outcomes use their established operator-only path.

Notification claims are leased, reauthorized immediately before send, and use
stable Resend idempotency keys. A completion still unknown after the provider
window becomes durable delivery uncertainty; no later automatic send occurs.

## Rollback

Keep new fulfillment closed while changing the coordinator. Once an order has
current coordinator fields, roll back the host only after every such row is
terminal and no preparation, submission, reconciliation, refund, or
notification lease remains. Retain the additive Convex schema and functions;
do not deploy a backend that cannot interpret persisted current state.
