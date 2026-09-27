# Invoice payment revisions

Invoice amounts and tax can change while a payment is in progress. Each new
checkout keeps its issued items, tax, amount, revision, tenant/account, expiry,
and session identity in `invoiceCheckouts`. Editing the current invoice never
rewrites a previously issued checkout. This records issued payment snapshots,
not a complete audit history of every unsent draft edit.

## Expected behavior

- An invoice increases from $100 to $200 while its original $100 checkout is
  open. Paying that checkout credits $100 and leaves a $100 partial balance.
  The same portal link can start a checkout for the remaining balance.
- Replaying the payment webhook cannot credit the same session twice. Payment
  registration can happen before or after the webhook without reopening an
  already paid invoice.
- If two issued sessions are paid, both real payments are recorded. Any amount
  above the current invoice total is shown as an overpayment for manual review.
- Payments received after cancellation are recorded without reopening the
  invoice. Invoices with checkout/payment history cannot be deleted.
- Manual “mark paid” records settlement of the outstanding amount. It does not
  charge Stripe. A later online payment may therefore create an overpayment.

The dashboard and portal display received amounts and remaining balances. A
partial invoice uses its existing share link for collection; partial-payment
reminder emails are not implemented. Online collection requires at least $0.50
USD. Smaller balances require operator assistance.

Existing Stripe checkout URLs remain usable until provider expiry. They are not
automatically canceled when an invoice changes. This avoids losing legitimate
in-flight payments, but overlapping checkouts can produce an overpayment. No
automatic refund or credit issuance is included. Inspect the invoice, its
checkout rows, activity log, and the matching provider payment before taking a
separately authorized refund/reconciliation action. A customer-facing revision
history viewer is not part of this release.

## Integrity and retry rules

The server prepares the snapshot before creating the Stripe session. Its ID is
the provider idempotency key, and its initial expiry is fixed at 23 hours.
This stays within Stripe's documented [checkout expiration
range](https://docs.stripe.com/api/checkout/sessions/create#create_checkout_session-expires_at)
and [idempotency retention](https://docs.stripe.com/api/idempotent_requests).
Retries reuse that snapshot while the revision, credited balance, account, and
origin remain the same. The signed webhook supplies the session, payment amount,
currency, payment intent, and Connect account. The mutation checks these against
the tenant and snapshot, then records the receipt and invoice balance atomically.

An unbound checkout whose creation result is still unknown near expiry is
blocked for reconciliation instead of being automatically recreated after the
provider idempotency window. Check the provider under the correct account before
retrying. Do not delete the snapshot or guess an amount to bypass this guard.

Historical sessions are retained before the old invoice session slot changes.
If the original fingerprint matches the invoice's exact issued items/tax, the
backend can freeze its amount and accept an older hub handler's webhook without
new arguments. Otherwise, the updated hub must supply verified amount/currency
evidence. Historical completed sessions remain idempotent. A historical partial
invoice without a recorded payment amount is blocked until reconciled.

Sessions overwritten before this change and historically incorrect paid statuses
cannot be reconstructed automatically. No historical production records were
examined or repaired as part of the local implementation.

## Ordered rollout

Follow [Package release and adoption](package-release-and-adoption.md). These are
release steps requiring separate authorization, not actions performed by this
runbook or by merging source alone.

1. Review the CRM schema/mutations and their Changeset; deploy the additive
   Convex backend first. Retain the legacy fields and arguments.
2. Publish the CRM API contract through the existing Changesets workflow and
   verify the immutable version. Adopt it where a host consumes that package.
3. Release the matching Angels Rest checkout and signed-webhook handlers.
   Do not enable the new handler against an older backend without
   `invoices.prepareCheckout` or the new payment evidence arguments.
4. Publish the shared admin package with its Changeset. Prepare an exact-version
   host adoption and lockfile update only after that version is available.
   Admin 6.4.0 provides the corresponding UI. Verify the exact published
   package in the host; checks against an older installed version do not
   establish integration of the new admin behavior.
5. Verify a test invoice through edit, old checkout settlement, partial balance
   settlement, webhook replay, and overpayment review in an authorized test
   environment before any production release.

Reflecting Pool is excluded from this work. Its checkout, integration checks,
package adoption, and deployment have not been performed. Keep that exclusion
explicit when assessing rollout coverage.

If a host release must be rolled back, retain the new backend/ledger and prefer
a forward fix for checkout problems. An old hub cannot collect partial balances
or reliably bind a new snapshot-only session after an early webhook. Removing
the table or reverting the backend after writes risks losing payment evidence.

## Local verification

Convex tests cover edited amounts, old and out-of-order sessions, duplicate
delivery, webhook/registration races, legacy fingerprints, account/tenant
boundaries, cancellation, and uncertain creation. Route tests check frozen
amounts, provider readiness, tax/fractional quantities, and failure before charge.
Shared admin tests check partial and overpaid presentation. Browser fixtures use
synthetic data and no provider writes.

On a Linux host without supported WebKit libraries, use the matching preinstalled
Playwright container image:

```zsh
pnpm test:browser:container
pnpm test:browser:container tests/browser/portal-styles.spec.ts
```

The runner derives the image tag from the installed Playwright version, requires
that image locally (`--pull=never`), disables container networking, and prints its
driver PID. It mounts the checkout so normal local dependencies and browser
results are available. It does not install host OS packages or contact providers.
The recorded WebKit run used `mcr.microsoft.com/playwright:v1.59.1-noble`.

The admin source modal was also inspected at desktop/mobile widths in an isolated
Chromium fixture. Paper tools were unavailable; the handbook update/comparison
remains pending in the screen inventory. This browser pass does not establish
live authentication, provider settlement, or deployed behavior.
