# LumaPrints integration

LumaPrints is the print-on-demand fulfillment boundary for eligible shop
orders. Stripe owns payment, Convex owns order state, and LumaPrints owns print
production and shipment.

## Local release-candidate flow

This section describes local, uncommitted source. It is not merged, released,
or deployed. Production remains rolled back, and new fulfillment remains
closed.

```text
Stripe checkout.session.completed
  → src/routes/api/webhooks/stripe/+server.ts (signature verification)
  → src/lib/server/orderIntake.ts (event and tenant routing)
  → src/lib/server/webhookOrders.ts (idempotent Convex order creation)
  → src/lib/server/printFulfillment.ts (print orchestration)
  → src/lib/server/lumaprints.ts (LumaPrints HTTP API)
  → packages/crm-api/convex/orders.ts (fulfillment state)
```

The immutable Stripe checkout session ID is both the Convex idempotency key and
LumaPrints `externalId`; its documented local shape (`cs_test_`/`cs_live_` plus
ASCII alphanumerics) fits the provider string contract and is global across
platform tenants. A single durable claim marker fences provider submission.
After a claim, retries only reconcile that exact persisted session ID. They
never send a second provider POST.

The reviewed local adapter assumes a store-scoped order list: each GET supplies
the configured `storeId` and a one-based `page`, then scans the strict
`orders`/`totalOrders`/`currentPage`/`totalPages` envelope locally for a
case-sensitive `externalId` match. It never sends the undocumented
`externalId` or `limit` query parameters. The scan is capped at 10 pages, 100
rows per page, and 1,000 rows total. Duplicate rows and changing pagination are
treated as retryable instability, as are responses that exceed the finite page,
row, or byte resource bounds; distinct orders with the same exact identity are
blocked as ambiguous. A stable absence or first-page list-level 404 is returned as pending because
submitted orders can take time to appear. These rules need authoritative
provider-contract verification before activation.

Create and reconciliation responses use byte-bounded JSON readers, strict
envelopes, parsed JSON media-type/UTF-8 charset and content-encoding tokens, and
canonical positive provider-number normalization. Store configuration must be
a positive safe integer. Other envelope shapes are contract failures, not
guessed compatibility paths.

## Ownership

| Concern | Source of truth |
|---|---|
| Public product content and retail variants | Selected Sanity fallback or published Convex catalog |
| Shared papers, sizes, frames, canvas options, Luma IDs, and wholesale data | `packages/print-catalog/` |
| Order/payment/fulfillment state | Convex `orders` |
| LumaPrints request construction and HTTP calls | `src/lib/server/lumaprints.ts` |
| Stripe-to-Luma orchestration and error classification | `src/lib/server/printFulfillment.ts` and `webhookErrorClassification.ts` |
| Sanity image URL preparation | `src/lib/shop/lumaprintsUrls.ts` |

Do not add a second catalog table in the host app. Extend
`@jessepomeroy/print-catalog` when shared print metadata changes.

## Image and option constraints

- LumaPrints accepts JPEG/JPG/PNG, not WebP.
- `prepareSanityUrlForPrint` removes presentation transforms and requests a
  high-quality print source.
- Option `39` (no bleed) is used only for direct Fine Art Paper because bleed
  option `36` changes the effective aspect ratio and can trigger rejection.
- Framed Fine Art Paper uses its mat option groups without direct-paper option
  `39`. Canvas uses its canvas-specific option group.
- Private print-source capabilities must retain at least 23 hours of their
  documented 24-hour Worker lifetime when returned. Short-lived or stale
  capabilities fail preparation before the provider-submission fence.
- Bordered images are composed before submission and should not be transformed
  a second time.

Keep these rules in the request builder and its tests rather than duplicating
them in route code.

## Validation, pricing, and errors

- `/api/shop/validate-image` fails closed: an upstream validation outage returns
  `{ valid: false, degraded: true }`.
- `/api/shop/shipping-price` returns HTTP 503 when LumaPrints cannot quote the
  basket. It does not invent a flat-rate fallback.
- Transient submission failures are rethrown so Stripe can retry the webhook.
- Create-order failures use an operation-specific disposition. Only the
  documented non-acceptance statuses `400`, `406`, and `429` are definitely
  rejected. Network failures, timeouts, server or unexpected statuses, and
  malformed success responses remain uncertain; evidence is bounded and never
  retains the provider body.
- Network, timeout, rate-limit, server, and not-yet-visible reconciliation
  results remain retryable. They keep the durable submission claim.
- A documented create non-acceptance can enter the refund path only after an
  atomic, claim-bound rejection checkpoint. Reconciliation read rejection does
  not prove that the earlier create request was rejected.
- Malformed reconciliation responses, ambiguous results, and local client
  faults persist a bounded `reconciliation_blocked` class. Normal webhook
  retries stop GET work at that state. A leased operator alert remains
  retryable. Recovery needs a reviewed, GET-only result and the
  webhook-authoritative reconciliation mutation.
- Classified permanent failures enter the Stripe-refund/Convex-failure-state
  path and send an admin diagnostic. Changes to this path must preserve payment,
  refund, order-state, and notification idempotency together.
- A provider-verified manual refund can update payment state after submission
  starts. This update keeps the uncertain submission claim, so checkout retries
  cannot send a second provider order.
- The exact fenced POST result can resolve after a refund. A GET-verified result
  can also resolve an uncertain or blocked claim. Both transitions store the
  validated provider number without changing refund truth or sending replay
  notifications.

The lower-level client throws `LumaPrintsError`; routes and orchestration own the
customer-facing policy.

## Environment

```dotenv
LUMAPRINTS_API_KEY=
LUMAPRINTS_API_SECRET=
LUMAPRINTS_STORE_ID=
LUMAPRINTS_USE_SANDBOX=true
```

Use `.env.local` for local development. Keep sandbox mode enabled in local and
Vercel preview environments; production is the only environment that should
submit real orders.

## Verification

```bash
pnpm exec vitest run src/lib/__tests__/lumaprints.test.ts
pnpm exec vitest run src/lib/__tests__/lumaprintsUrls.test.ts
pnpm exec vitest run src/lib/server/__tests__/printFulfillment.test.ts
pnpm exec vitest run src/lib/server/__tests__/orderIntake.test.ts
pnpm --filter @jessepomeroy/print-catalog test
```

Any end-to-end provider check needs separate approval and a verified target.
The current owner has no usable sandbox procedure and does not authorize more
sandbox work. Never use a production checkout as a routine development smoke
test.
