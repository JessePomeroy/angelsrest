# Invoice verification feature map

This is an invoice-specific map, not coverage of all Angels Rest features.

| Feature | Entry points | Evidence and scope |
| --- | --- | --- |
| [Revision and receipt ledger](ledger.md) | `/api/invoice/checkout`, `/api/webhooks/stripe`, Convex invoice/admin/portal APIs | Exercised locally with real handlers/functions, simulated Stripe HTTP and in-memory Convex |
| [Admin and portal presentation](browser.md) | Installed Admin invoice modal, `/portal/[token]` component | Exercised in Chromium desktop/mobile and mobile WebKit with synthetic callback state |
| [Provider acceptance](sandbox.md) | Authenticated admin → customer portal → hosted Stripe Checkout → signed webhook → backend → reloaded UI | Passed on 2026-09-27: four sandbox payments, same-event replay, persisted receipts, and both reloaded views |

The local workflow was exercised on 2026-09-27 against hub base `60ae0850` plus
this workflow's changes, with installed Admin 6.4.0. Future runs must record their
own source and dependency revisions. A prior pass does not prove a later release.

Not covered: connected-account tenant Checkout, Google OAuth, email delivery,
refund issuance, historical reconciliation, real customer data, or Reflecting Pool.
