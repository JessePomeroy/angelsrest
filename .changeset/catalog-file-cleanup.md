---
"@jessepomeroy/crm-api": minor
---

Add tenant-scoped catalog file cleanup, expired-upload cleanup, unused product deletion, and inquiry removal. Fence deleted asset reuse and delayed checkout requests; retain assets referenced by immutable catalog history or production snapshots. Keep storage cleanup manifests and completion behind the existing per-tenant server deletion authority.

Add reference-protected content history cleanup, orphan web-media cleanup support, and creator-controlled offboarding with 90-day retention and an explicit early-erasure choice for eligible CRM records. Preserve accepted quotes, signed contracts and payment/linked invoice history. Provider shutdown and complete tenant/account erasure remain separate operator work.

Withhold published tenant content and new catalog checkout resolution immediately on offboarding, while preserving historical records and paid-service processing. Availability resolves retained tenant aliases.

Add authenticated, paginated website-content export projections for current published/draft revisions and registered web/private media. Preserve portable relationships and exclude actor credentials, customer records and storage keys. The companion operator exporter and CMS media Worker byte transport require coordinated rollout.
