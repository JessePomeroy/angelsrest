---
"@jessepomeroy/crm-api": minor
---

Add reversible catalog publication mutations with exact pointer/updatedAt CAS and monotonic server timestamps, plus bounded public reads governed by each tenant's enabled product kinds. Independently resubmitted stale or duplicate application mutations conflict without writing; Convex transport retries are the only exactly-once retry boundary, and clients reconcile ambiguous responses through current Editor query state.
