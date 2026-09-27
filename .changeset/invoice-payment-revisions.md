---
"@jessepomeroy/crm-api": minor
---

Retain immutable invoice checkout snapshots across amount and tax edits. Credit
verified payments exactly once against the current balance, preserve partial
payments and overpayments, and reject cross-tenant or conflicting payment
evidence. Add checkout preparation and return the authoritative invoice from
updates. Invoices with checkout/payment history must be retained instead of
deleted.

Deploy the additive Convex changes before the matching hub checkout/webhook
handlers. Legacy handlers remain compatible when their saved fingerprint proves
the issued amount; ambiguous historical sessions need verified payment evidence.
See `docs/runbooks/invoice-payment-revisions.md` for rollout and recovery limits.
