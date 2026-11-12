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

## Before the Convex deploy (read-only)

The deploy removes the scan immediately, so check every platform client first.
From `packages/crm-api`, list the client sites, their backfill rows and their
order counts without printing customer data:

```zsh
pnpm exec convex data platformClients --deployment loyal-swan-967 --format jsonl | jq -r .siteUrl
pnpm exec convex data orderRevenueBackfills --deployment loyal-swan-967 --format jsonl | jq -r '[.siteUrl, .phase] | @tsv'
pnpm exec convex data orders --deployment loyal-swan-967 --format jsonl --limit 10000 | jq -r .siteUrl | sort | uniq -c
```

Stop, and run the verified operator backfill for that site first, if any client
site has orders but no `ready` row, or has a row that is not `ready`. Only sites
with no orders may rely on the empty-site migration below. On 2026-11-11 the
production result was two client rows: `angelsrest.online` (`ready`, all 14
orders) and `queenworm.angelsrest.online` (no row, no orders).

Repeat the same three reads against staging (`--deployment rosy-firefly-366`),
and confirm its `businessSearchMigrations` rows are all `done`, before deploying
this backend there. Then run the migration below against staging as well.

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
`already_ready` for both.

A site rename starts the new domain with an empty `ready` row only when that
domain has no orders. Orders recorded under the old domain stay keyed to it, as
they always were. Re-homing historical orders to a new domain is a separate,
reviewed operator change that must also rebuild that domain's totals. Deploy the backend containing this change before
running the migration. Until it runs, `queenworm.angelsrest.online` shows the
dashboard's unavailable order report.
