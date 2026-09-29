---
"@jessepomeroy/crm-api": patch
---

Make publishing a portfolio gallery restore its public visibility atomically,
including when republishing the same saved revision after hiding it. Existing
authorization, draft checks, and public asset validation remain in place.
