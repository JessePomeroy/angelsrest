# Performance scaling follow-up — 2026-09-29

Status: implemented and verified locally. No backend deployment, historical
migration, package publication, or host deployment has been performed.

## Delivery galleries

The initial authorized response reads up to 48 image records instead of the whole
gallery. Show more and lightbox navigation fetch subsequent pages. Every page
rechecks portal access, password grants, expiry, and revocation. Selection pages
also require downloads to be enabled. Indexed companion lookups preserve RAW
previews even when the matching JPEG is on a later page.

Select all applies to unloaded images; deselections become explicit exclusions.
Download preparation fetches the selected metadata without expanding the DOM.
Existing download/ZIP authorization remains in place. If a save location is
requested before all metadata is loaded, a fresh **Choose save location** click
opens the browser picker after preparation. Already-loaded galleries keep the
existing direct flow. Preparation can be canceled; stale responses cannot reopen
a closed lightbox or start downloads after unmount.

Existing gallery records require preview-index preparation before the new host
is deployed. New galleries and new uploads receive the index fields immediately.
The old whole-gallery endpoint remains compatible with older consumers.

## Dashboard totals

Order creation atomically records one contribution and updates daily and all-time
buckets per currency. Dashboard reads after activation use these buckets plus the
10 most recent orders, rather than scanning historical orders. A UTC-day query
key refreshes period boundaries while an open dashboard crosses midnight.

These are original paid gross amounts, not net income. Refunds and status changes
do not subtract the original payment. Currency totals stay separate. Malformed
amounts are excluded from safe gross totals; unknown currencies and unsafe totals
remain flagged. Compatibility fields are not suitable for financial reporting.

The resumable backfill copies 100 orders per batch, independently verifies source
contributions, and compares stored bucket amounts/counts before marking the site
ready. Retries do not double-count. New orders arriving during verification also
update its comparison totals. Until readiness, the existing bounded 5,001-row
scan remains active; a failed comparison cannot activate the aggregates.

This adds storage and transactional writes in exchange for bounded dashboard
reads. Orders remain the source records. Supported code has one order-creation
path and no deletion or financial-identity editing path; future such operations
must explicitly maintain the contribution and bucket invariants. This tool is
not a repair utility for manually edited/deleted database rows. A failed comparison
requires investigation; do not bypass it or manually mark the site ready.

## Rollout order and operator commands

1. Deploy the additive CRM backend/schema first, retaining the existing host.
2. Prepare every existing delivery gallery that can be published. Check the
   gallery's index status and run its resumable preparation before host adoption.
3. Backfill each dashboard tenant's totals and confirm the phase is `ready`.
4. Publish the CRM, gallery-delivery, and shared admin package changes. Update
   dependencies with pnpm and repeat host/package contract checks against the
   actual published versions before deploying the host.
5. Verify a real authorized gallery page boundary and dashboard totals after
   deployment. No customer/provider mutation is needed for those read checks.

Use a securely supplied `PUBLIC_CONVEX_URL` and current `ADMIN_CONVEX_JWT` in the
shell environment. Never paste credentials into commands, notes, or logs. The
script does not print credentials. Revenue operations require the creator role;
gallery operations require membership authorized for that gallery's site.

```zsh
# Read-only status (substitute the intended domain or gallery ID).
pnpm exec tsx scripts/commerce/backfill-scaled-reads.ts --site angelsrest.online
pnpm exec tsx scripts/commerce/backfill-scaled-reads.ts --gallery GALLERY_ID

# Explicit writes; run only during the authorized rollout.
pnpm exec tsx scripts/commerce/backfill-scaled-reads.ts --site angelsrest.online --apply
pnpm exec tsx scripts/commerce/backfill-scaled-reads.ts --gallery GALLERY_ID --apply
```

An interrupted run resumes from saved progress. A timed-out request can safely be
retried. If authentication expires, obtain a fresh authorized token and resume.
Do not deploy the paginated host while any accessible old gallery lacks index
version 1: it deliberately rejects unprepared galleries rather than scanning them.

## Local evidence and remaining checks

- Hub: 2,884 unit/integration tests, 28 protocol tests, and 21 script tests passed.
  Svelte check, lint, CRM TypeScript, consumer package-contract checks, and the
  production build passed using fictional public Convex settings. The build retained
  existing optional Sharp/Resend dependency-tracing warnings.
- Shared admin: 1,006 tests, Svelte check, and package build passed.
- Gallery-delivery: 83 tests and its check passed.
- Chromium mobile and WebKit mobile: 10 targeted pagination/download tests each
  passed, including cross-page selection, failure/retry, lightbox closure, and
  save-location handoff. WebKit ran in the cached offline container.
- Backend tests cover permissions, revoked links, RAW companion lookup, backfill
  retries, concurrent orders, and failed aggregate comparisons.
- The 390px save-location state was visually inspected with fictional records;
  no horizontal overflow. Existing light-theme filename contrast remains outside
  this change. Paper tools were unavailable; handbook synchronization is pending
  in the screen inventory.

The admin candidate is locally linked for verification; committed dependency
ranges still refer to the published package. A clean install cannot consume the
new entrypoints until the coordinated release. Reflecting Pool was not upgraded.
Production timing, provider load, and physical-device performance were not measured.
