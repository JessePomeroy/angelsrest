---
"@jessepomeroy/crm-api": patch
---

Support positive fractional invoice quantities with per-line cent rounding, rounded tax, and finite safe-cent validation on invoice creation, numeric edits, and quote conversion. The host portal and invoice checkout use the same arithmetic; no stored invoice migration is performed.
