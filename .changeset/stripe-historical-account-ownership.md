---
"@jessepomeroy/crm-api": minor
---

Retain verified Stripe account ownership independently of the active checkout
account. Binding records the immutable client, tenant, attempt, platform, and
mode atomically. Old accounts cannot be reassigned across tenants after their
active selection is removed.

Historical event routing, accepted Checkout retries, and refund reconciliation
retain the original provider account. New Checkout admission still requires the
current selection. Deploy the reader/writer together before any future account
replacement or offboarding; retain history records on rollback. No account
replacement endpoint, live mutation, or provider-access grant is introduced.
