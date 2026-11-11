# Dashboard revenue totals

The admin dashboard reads only the maintained per-currency order totals
described in [performance scaling follow-up](../performance-scaling-follow-up.md#dashboard-totals).
The historical-order scan fallback was removed on 2026-11-11. A site whose
`orderRevenueBackfills` row is missing or not `ready` gets an explicit
`Dashboard revenue totals are not ready for this site` error from
`orders.getStats`/`orders.getStatsForDay`; the shared Admin dashboard shows its
"order report could not load" state and links to the order list.

## How a site becomes ready

- **New sites.** `platform.createClient` (including `createClientWithAdmin`),
  `platform.seedClient`, `stagingSetup.bootstrap`, and the domain changes in
  `platform.updateClient`, `platform.ensureSiteAdmin` and
  `platform.renameClientSiteUrl` insert a `ready` row with empty totals in the
  same transaction, but only when the site has no orders and no recorded totals.
  `orders.create` then maintains the totals for every new order.
- **Existing sites with orders.** Run the verified operator backfill in the
  [rollout section](../performance-scaling-follow-up.md#rollout-order-and-operator-commands).
  Never insert or patch a `ready` row by hand.
- **Existing sites without orders.** Run the one-time migration below.

## One-time empty-site migration

`orders:seedEmptyDashboardTotals` is an idempotent internal mutation. It reads 25
platform clients per call and reports one outcome per site:

| Outcome | Meaning |
|---|---|
| `seeded` / `would_seed` | No orders and no totals; a `ready` empty row was (or would be) inserted |
| `already_ready` | Nothing to do |
| `backfill_in_progress` | An operator backfill is underway; finish it |
| `has_orders` | Refused; run the operator backfill for that site |
| `has_totals` | Refused; totals exist without orders, so investigate before any backfill |

Run it from `packages/crm-api` only with explicit authorization for a production
write. Preview first, then apply. If `isDone` is `false`, repeat with the
returned `continueCursor`.

```zsh
cd packages/crm-api
pnpm exec convex run --prod orders:seedEmptyDashboardTotals '{"dryRun":true}'
pnpm exec convex run --prod orders:seedEmptyDashboardTotals '{}'
# Only when the previous result had isDone: false
pnpm exec convex run --prod orders:seedEmptyDashboardTotals '{"cursor":"CONTINUE_CURSOR"}'
```

As of 2026-11-11, `angelsrest.online` is `ready` and the platform client
`queenworm.angelsrest.online` has no row and no orders, so the expected result is
`seeded` for that client and `already_ready` for the hub. Re-running reports
`already_ready` for both. Deploy the backend containing this change before
running the migration. Until it runs, `queenworm.angelsrest.online` shows the
dashboard's unavailable order report.
