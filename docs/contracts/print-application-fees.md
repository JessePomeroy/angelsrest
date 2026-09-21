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

## Remaining financial work

Fee calculation alone is not a financial ledger. Before guided partial refunds
are enabled, retain the original fee policy, print base, fee amount and payment
identity; reconcile actual provider fee/refund records separately. The guided
Hub flow must record refunded print items/amounts and return the corresponding
fee with cumulative cent rounding and retry/concurrency protection. Dashboard
refunds with unknown print allocation require reconciliation, not an inferred
percentage of the total refunded charge. Existing whole-order supplier-failure
refund behavior is unchanged here.

Tax responsibility, shared backend/package adoption, provider acceptance and
client activation remain separate gates.
