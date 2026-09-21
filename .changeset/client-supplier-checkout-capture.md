---
"@jessepomeroy/crm-api": minor
---

Add opt-in tenant supplier capture to authenticated checkout reservations. Freeze
the current immutable supplier with the print input, retain protocol and supplier
identity on replay, and return the saved non-secret context for host pre-payment
configuration checks. Existing reservation callers keep their exact response.
