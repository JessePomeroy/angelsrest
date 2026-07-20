---
"@jessepomeroy/crm-api": patch
---

Flatten the catalog revision table's V1/V2 document union so Convex can evaluate and deploy the dormant V2 schema, with a regression check for unsupported nested top-level table unions.
