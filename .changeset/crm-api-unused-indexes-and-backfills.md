---
"@jessepomeroy/crm-api": patch
---

Drop 42 unused database indexes and retire two finished migrations. The hourly
business-record search backfill cron, its internal mutations and the
`businessSearchMigrations` table are removed; every record writer already
maintains `searchText`. Dashboard statistics now require maintained revenue
totals and no longer fall back to scanning historical orders: a site without
`ready` totals gets an explicit error. New sites without orders start `ready`,
and the internal `orders.seedEmptyDashboardTotals` migration seeds existing
empty sites. The public `api` surface and the `getStats`/`getStatsForDay`
return types are unchanged; the generated `internal` and `dataModel` types drop
the removed internal mutations and the `businessSearchMigrations` table.
