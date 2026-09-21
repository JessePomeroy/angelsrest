---
"@jessepomeroy/crm-api": minor
---

Add optional saved LumaPrints connection context to reservations and paid orders.
Transfer only the bound, verified identity; preserve it on replay; require workers
to acknowledge it before provider work. Scope supplier-number ownership by
connection while keeping legacy shipment intake limited to central orders.
No checkout producer captures client supplier context yet.
