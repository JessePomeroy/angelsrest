---
"@jessepomeroy/crm-api": minor
---

Add verified, hub-owned Stripe connection status storage with tenant-authorized reads, fresh refresh claims, stale/expired-response rejection, and terminal disconnection. Preserve immutable payment-account ownership and refuse implicit reconnection. This is the storage contract; status producers and activation follow separately.
