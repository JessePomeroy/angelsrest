---
"@jessepomeroy/crm-api": major
---

Add the tenant-scoped document email delivery and operator-recovery journal,
quote-validity enforcement, and idempotent quote and contract portal actions.
Add `portal.getPublicByToken`, which returns explicit client-safe invoice,
quote, and contract projections that omit database IDs, provider checkout
state, CRM fields, client email, and stored signature evidence. Current Angels
Rest hosts use this final safe query.

The rollout used a backend-widen, then host, then narrow sequence. Stage A kept
deprecated `portal.getByToken` on its exact raw 3.x document shape while current
hosts moved to `getPublicByToken`. After that host cutover, Stage C narrowed the
invoice, quote, and contract branches of `getByToken` to the same client-safe
projection. Gallery delivery retains its existing raw result shape.

Terminal receipt reloads require a token-local atomic quote or contract action;
legacy used-only and administratively revoked capabilities fail closed.
Accepted replacement delivery revokes every prior matching portal capability,
with a bounded per-document history that is enforced before provider work.
