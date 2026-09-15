# Commerce intake contract

Angels Rest is the single composition root for commerce and fulfillment events.
This contract applies to the hub and every spoke.

## Owners

- `/api/webhooks/stripe` owns payment-mode Shop order intake, refunds, routing,
  fee scheduling, fulfillment, and order notifications.
- `/api/platform/webhooks/stripe` owns platform subscription state only.
- `/api/webhooks/lumaprints` owns provider-global shipment updates and shipment
  notification.
- Spokes may request Checkout through the signed tenant bridge. They do not run
  a second `checkout.session.completed` or LumaPrints shipment consumer.

## Authority

The browser never selects tenant, price, sender, recipient, Stripe account, or
redirect authority. The hub derives tenant scope from verified `event.account`
or server-stamped Checkout metadata and resolves it against stored platform
state. Webhook signatures authenticate transport but do not select a business
tenant.

Every non-repeatable provider action has a durable claim or admission fence,
uses the frozen idempotency identity, and stores completion separately. Unknown
outcomes remain uncertain. They do not authorize a new provider request.

## Order identities

The immutable Stripe Checkout Session ID remains the order-creation idempotency
key and the internal fulfillment-command identity. For newly enrolled Angels
Rest print orders, trusted webhook intake can request `printOrderReferenceVersion: 1`.
Convex generates and freezes `orders.lumaprintsExternalId` as `AR-<orderNumber>`
atomically with the order and job; callers cannot supply arbitrary references.
Provider POST and GET use that exact saved value. Other tenants, historical
orders, and existing-order replay retain their original identity and behavior.

The V4/V5 claim boundary requires the runner to acknowledge a stored readable
reference before submission or reconciliation. A missing/mismatched acknowledgement
fails closed; the additive field cannot make an old runner issue a different
provider identity. This is not authority to backfill, rename, or resend an order.

## Rollout

Cross-runtime changes widen the backend first, deploy compatible consumers
second, and narrow only after all known consumers are verified. Rollback retains
the additive backend whenever persisted state uses the widened protocol.
Production destination, credential, event-matrix, replay, or account changes
require a separate explicit approval.
