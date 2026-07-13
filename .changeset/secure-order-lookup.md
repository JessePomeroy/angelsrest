---
"@jessepomeroy/crm-api": major
---

Remove the deprecated unauthenticated `orders.lookup` query. Customer order lookup must use the hub broker and the dedicated server-authorized `orders.lookupForCustomer` query.
