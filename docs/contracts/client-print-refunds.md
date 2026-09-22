# Guided client print refunds

The Hub route `/portal/refunds/[siteUrl]` lets an authenticated member of the original client tenant choose amounts from the original order lines. The linked Stripe setup page supplies the existing sign-in flow. Recent orders are bounded to 20; a known order ID can be opened directly with `?order=...`. Older orders without the financial snapshot need operator review.

The server persists the request before sending money. Customer refunds use the original connected account and charge. Angels Rest returns its fee separately on the platform: cumulative refunded print principal × 5%, rounded down to cents, less prior allocated fee returns. Downloads, services, shipping and tax contribute no fee. The separate exact application-fee refund avoids Stripe's whole-charge proportional calculation. The customer refund must succeed before the fee POST.

## Authority and recovery

- Browser amounts are proposals. Convex checks the immutable financial snapshot, original tenant membership, remaining line amounts and the private Hub capability. Current domain renames preserve the original tenant's access; creator identity alone does not grant client refund authority.
- One active request per order; each request has a 90-second worker lease. A repeated browser token with the same allocation returns the same request. A changed allocation with that token is rejected.
- Every execution verifies the original platform, mode, Session, PaymentIntent, charge and fee. Complete provider refund lists are bounded at 100 each. Unknown Dashboard refunds, incomplete lists or contradictory evidence stop for operator review; no proportional allocation is inferred.
- Each financial POST has a durable timestamp, stable idempotency key and private server-generated recovery proof. A lost response can be recovered from the exact original provider scope and expected amount. Unknown POST outcomes are not reposted after 23 hours. Fee retries never repeat a successful customer refund.
- Pending/requires-action customer refunds wait. Failed/canceled refunds do not return a fee. Signed refund events refresh current evidence and resume active guided operations. Later failure after success is preserved as attention, including any fee already returned; it does not automatically claw back a fee or issue another customer refund.
- A client may cancel a request only before the first customer POST checkpoint. A canceled worker cannot cross that checkpoint. Expired leases resume via the same request/status action or a matching signed provider event.

## Supplier boundary

A financial refund does not cancel or refund a LumaPrints order. The page requires acknowledgement. In-flight or unresolved supplier submissions block a new guided request. An active request blocks supplier submission. A confirmed existing supplier order is displayed explicitly and remains unchanged.

After any guided customer POST attempt, the legacy automatic full-refund producer is fenced for that order. A later permanent supplier failure is recorded as `fulfillment_error` for guided/operator review, without sending misleading refund-success or manual-fulfillment mail. A full successful customer refund closes the order. Partial refunds do not cancel the remaining fulfillment automatically.

## Rollout and limits

`CLIENT_PRINT_REFUNDS_ENABLED=true` **and** `CLIENT_REFUND_EVIDENCE_ENABLED=true` are required. Both remain off unless separately approved. Deploy the additive backend through the approved shared release process before enabling the host. Source merge does not publish the CRM package, deploy Convex, change secrets/flags, or execute provider operations.

Once guided records exist, rollback must preserve their backend producer fences and recovery data. Turning the host flag off stops new guided execution; it does not authorize old automatic refunds to take over affected orders. Resolve those orders with operator review before removing this contract.

Offline tests cover actual Convex transactions and the host worker, signed webhook handling, lost acknowledgements, concurrency, original account scope, pending/failed states, bounded history, supplier conflict, HTTP form authorization and desktop/mobile native form submission. No real refunds, supplier orders or emails are sent. Live provider acceptance, package/backend activation and tax advice remain separate work.
