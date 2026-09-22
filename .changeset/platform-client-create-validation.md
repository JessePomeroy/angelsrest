---
"@jessepomeroy/crm-api": patch
---

Validate and normalize operator-created platform client names, domains and admin email addresses before assigning tenant identity.

Return duplicate website conflicts as application errors so the operator can recover in production.
