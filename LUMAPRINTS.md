# LumaPrints integration

LumaPrints is the print-on-demand fulfillment boundary for eligible shop
orders. Stripe owns payment, Convex owns order state, and LumaPrints owns print
production and shipment.

## Current flow

```text
Stripe checkout.session.completed
  → src/routes/api/webhooks/stripe/+server.ts (signature verification)
  → src/lib/server/orderIntake.ts (event and tenant routing)
  → src/lib/server/webhookOrders.ts (idempotent Convex order creation)
  → src/lib/server/printFulfillment.ts (print orchestration)
  → src/lib/server/lumaprints.ts (LumaPrints HTTP API)
  → packages/crm-api/convex/orders.ts (fulfillment state)
```

The Stripe checkout session ID is the order idempotency key in Convex. A stored
LumaPrints order number prevents duplicate physical submissions on webhook
retries.

## Ownership

| Concern | Source of truth |
|---|---|
| Public product content and retail variants | Sanity |
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
- Option `39` (no bleed) is the default for paper prints because bleed option
  `36` changes the effective aspect ratio and can trigger rejection.
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
- Classified permanent failures enter the Stripe-refund/Convex-failure-state
  path and send an admin diagnostic. Changes to this path must preserve payment,
  refund, order-state, and notification idempotency together.

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

For an end-to-end change, use a Stripe test event and LumaPrints sandbox, then
verify the Convex order, upstream order/refund, and expected emails. Never use a
production checkout as a routine development smoke test.
