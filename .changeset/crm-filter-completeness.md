---
"@jessepomeroy/crm-api": minor
---

Apply CRM category/status filters through indexes before bounded selection and
support the same status filter in the paginated list. Report a truncation flag
when CRM statistics reach their bounded scan limit so consumers can label partial
totals explicitly.
