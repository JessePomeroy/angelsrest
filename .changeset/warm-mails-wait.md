---
"@jessepomeroy/crm-api": major
---

Add the tenant-scoped document email delivery and operator-recovery journal,
quote-validity enforcement, and idempotent quote and contract portal actions.
Add `portal.getPublicByToken`, which returns explicit client-safe invoice,
quote, and contract projections that omit database IDs, provider checkout
state, CRM fields, client email, and stored signature evidence. Current Angels
Rest hosts use this final safe query.

The rollout is deliberately backend-widen, then host, then narrow. The Stage-A
backend keeps deprecated `portal.getByToken` on its exact raw 3.x
token/document/client result shape, including `token.documentId`, so an older
production host remains compatible while the new query is deployed. That raw
legacy query is a temporary security hold and must gain no new callers. After
all document hosts use `getPublicByToken`, Stage C narrows only the invoice,
quote, and contract branches of `getByToken` and publishes CRM 4.0.0. Gallery
delivery retains its existing raw result shape through every stage.

Terminal receipt reloads require a token-local atomic quote or contract action;
legacy used-only and administratively revoked capabilities fail closed.
Accepted replacement delivery revokes every prior matching portal capability,
with a bounded per-document history that is enforced before provider work.
