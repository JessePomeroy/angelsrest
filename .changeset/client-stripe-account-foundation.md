---
"@jessepomeroy/crm-api": major
---

Replace unverified Stripe account assignment with a durable creation attempt and
atomic, unique account binding. The new onboarding protocol requires creator
membership and hub server authority, freezes tenant/provider request identity,
and refuses changes to the Stripe platform or test/live environment.

Direct account assignment through createClient, updateClient, seedClient,
updateStripeConnectedAccount, and setStripeConnectedAccount is no longer
supported (an unchanged value on updateClient remains a no-op). Coordinate the
hub adoption while onboarding is disabled; old onboarding hosts are incompatible.
