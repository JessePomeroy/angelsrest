---
"@jessepomeroy/crm-api": patch
---

Finish deleting tag assignments in bounded scheduled batches when a tag has more
than 500 assignments. Remove the tag immediately to prevent new assignments while
cleanup completes, preserving site authorization and unrelated tags.
