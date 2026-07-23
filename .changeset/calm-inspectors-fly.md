---
"@jessepomeroy/crm-api": patch
---

Enforce a global single-flight lease for CMS editor inspection dispatch claims while preserving fenced retries, tenant-scoped stale reconciliation and one-shot terminal outcomes. Legacy leases without expiry now fail closed across tenants until their owner repairs or terminalizes them.
