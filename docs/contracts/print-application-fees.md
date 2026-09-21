# Print application fees

Angels Rest collects 5% of the print subtotal on connected-account product
checkouts. `print` and `print_set` catalog kinds are eligible. A print set's
retail price counts once per purchased set, not once per image. Digital
downloads, postcards, tapestries and merchandise are excluded. Shipping and
tax are excluded. Service invoices and hub-owned checkout have no application
fee.

`packages/crm-api/convex/helpers/printFeePolicy.ts` owns the classification,
integer validation and rounding. Sum eligible unit prices times quantities,
then round 5% down once to whole cents. Never round individual lines first.
Reject fractional, negative, non-finite or unsafe money, invalid quantities,
and arithmetic overflow.

All three product checkout producers call `buildTenantProductCheckoutOptions`:

- Direct checkout uses the current catalog-resolved snapshot kind and price.
- Cart checkout uses each resolved snapshot kind/price and validated purchase
  quantity. Browser prices, product kinds and paper fields are not fee authority.
- The signed client bridge uses the authenticated snapshot kind and amount
  after signature, tenant and request validation. It sells one item per request.
  Legacy metadata such as paper fields and product descriptions does not decide
  eligibility.

Account routing, reserved tenant metadata, and the existing admission protocol
remain unchanged. Application-fee amount remains part of the admission request
fingerprint. Corrected non-print bridge fees must not reinterpret an already
started client attempt. New client commercial activation remains closed pending
financial and provider acceptance; preserve original recovery configuration for
any previously admitted attempt. This change does not rewrite historical orders
or refund a previously collected fee.

## Original checkout financial record

`checkoutFinancialSnapshot` is optional on historical admission and order rows.
Every first client order creation now requires an exact `financialIntent` on
the authenticated mark-creating request: version 1, USD, one unit amount and
quantity per catalog line, and the requested application-fee amount. It contains
1–40 lines, quantities 1–20, safe integer cents and bounded arithmetic. It cannot
carry a browser-selected fee policy, account, provider fee ID or product kind.

Inside the same transaction that checks current payment/supplier readiness and
enters `creating`, the backend compares prices against the reservation's frozen
print input, takes product kinds from its snapshot and recomputes the fee. It
saves policy `print_subtotal_5pct_floor_v1`, all product lines and quantities,
whole-product and print subtotals, expected application fee, stable tenant and
original Stripe platform/account/mode. Later catalog changes cannot replace it.
The host derives the intent from the actual Stripe line-item and fee parameters;
first creation requires `financialCaptureVersion: 1` acknowledgement before
calling Stripe. A missing/lost acknowledgement is not permission to charge.

Creating/uncertain/bound replays compare supplied financial intent with any
existing record. They never rewrite that record or recheck today's catalog.
An attempt started before capture explicitly returns `financialCaptureVersion:
0` to the new host, meaning no original financial record exists. That response
is accepted only when the authenticated admission already reported a replay
state, never for first creation. Its existing fingerprint and idempotency fence
remain authoritative; no historical record is fabricated. Old callers that
omit the financial intent retain the original response envelope on recovery.
Hub and invoice checkout do not use this client financial protocol.

Paid intake copies the saved record through the consumed admission/reservation,
checks original tenant/account/currency/mode, subtotal and line quantities, and
requires a payment identity for a nonzero payment. It cannot accept this record
from a browser/admin payload. Failed validation rolls back both consumption and
order creation. Refund calculations can subsequently use the saved original
lines and the order's immutable payment identity. Replays of an existing order
do not replace its financial evidence.

An admission-linked reservation requires that exact admission during intake.
A known financial Session cannot become legacy intake by omitting either or
both metadata markers. Truly historical unlinked reservations retain their
existing path. Omission failures leave the reservation, admission and order
state intact for recovery.

This records **expected amounts**, not proof of an application fee, refund,
supplier charge or payout. It does not schedule any new Stripe read or refund.
Existing original-charge processing-fee capture remains separate. Missing
historical financial records remain unknown and cannot be treated as zero fees.

Roll out the additive backend consumer before activating client producers at
this revision. New client checkout requires both the original supplier capture
and this financial capture. Old first-creation client producers fail closed on
the updated backend. Keep admission closed during the coordinated adoption;
preserve saved records and original recovery settings during rollback. A
successful source/hosting merge does not deploy the shared backend or activate
clients.

## Remaining financial work

Reconcile actual provider fee/refund records separately before enabling guided
partial refunds. The guided
Hub flow must record refunded print items/amounts and return the corresponding
fee with cumulative cent rounding and retry/concurrency protection. Dashboard
refunds with unknown print allocation require reconciliation, not an inferred
percentage of the total refunded charge. Existing whole-order supplier-failure
refund behavior is unchanged here.

Tax responsibility, shared backend/package adoption, provider acceptance and
client activation remain separate gates.
