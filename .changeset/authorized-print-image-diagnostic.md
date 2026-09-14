---
"@jessepomeroy/crm-api": minor
---

Expose an authenticated, read-only query for the existing prepared artwork of
an unresolved Angels Rest print submission. The query enforces stored site
membership and bounded frozen-order, completed-job, and JPEG-artifact checks;
it does not mutate order, job, or source state or authorize a fulfillment retry.
