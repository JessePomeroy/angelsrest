# LumaPrints integration

LumaPrints is the print-on-demand fulfillment boundary for eligible shop
orders. Stripe owns payment, Convex owns order state, and LumaPrints owns print
production and shipment.

## Current source flow

The current host uses the V5 coordinator with additive compatibility state.
Verify the actual production deployment and admission state before live work;
source code alone is not evidence that fulfillment is ready.

```text
Stripe checkout.session.completed
  → src/routes/api/webhooks/stripe/+server.ts (signature verification)
  → src/lib/server/orderIntake.ts (event and tenant routing)
  → src/lib/server/webhookOrders.ts (idempotent Convex order creation)
  → Convex printFulfillmentJobs (atomic enqueue; webhook returns after receipt)
  → /api/internal/print-fulfillment (one leased, resumable step)
  → src/lib/server/printFulfillment.ts (print orchestration)
  → src/lib/server/lumaprints.ts (LumaPrints HTTP API)
  → packages/crm-api/convex/orders.ts (fulfillment state)
```

The immutable Stripe checkout session ID is both the Convex idempotency key and
LumaPrints `externalId`; its documented local shape (`cs_test_`/`cs_live_` plus
ASCII alphanumerics) fits the provider string contract and is global across
platform tenants. A single durable claim marker fences provider submission.
The coordinator provides at-most-one provider POST per durable claim; it does not
promise exact-once delivery. After a claim, retries only reconcile that exact
persisted session ID and do not replay the POST.

The reviewed adapter assumes a store-scoped order list: each GET
supplies the configured `storeId` and a one-based `page`, then scans the strict
`orders`/`totalOrders`/`currentPage`/`totalPages` envelope locally for a
case-sensitive `externalId` match. It never sends the undocumented
`externalId` or `limit` query parameters. The scan is capped at 10 pages, 100
rows per page, 1,000 rows total, and a 20-second total lookup budget. Duplicate rows and changing pagination are
treated as retryable instability, as are responses that exceed the finite page,
row, or byte resource bounds; distinct orders with the same exact identity are
blocked as ambiguous. A stable absence or first-page list-level 404 is returned
as pending because submitted orders can take time to appear. These rules need
authoritative provider-contract verification before activation.

Create and reconciliation responses use byte-bounded JSON readers, strict
envelopes, parsed JSON media-type/UTF-8 charset and content-encoding tokens, and
canonical positive provider-number normalization. Store configuration must be
a positive safe integer. Other envelope shapes are contract failures, not
guessed compatibility paths.

## Ownership

| Concern | Source of truth |
|---|---|
| Public product content and retail variants | Published Convex catalog |
| Shared papers, sizes, frames, canvas options, Luma IDs, and wholesale data | `packages/print-catalog/` |
| Order/payment/fulfillment state | Convex `orders` |
| LumaPrints request construction and HTTP calls | `src/lib/server/lumaprints.ts` |
| Stripe-to-Luma orchestration and error classification | `src/lib/server/printFulfillment.ts` and `webhookErrorClassification.ts` |
| Private print-source capability issuance | `src/lib/server/catalogCommerceClients.ts` |

Do not add a second catalog table in the host app. Extend
`@jessepomeroy/print-catalog` when shared print metadata changes.

## Image and option constraints

- LumaPrints accepts JPEG/JPG/PNG, not WebP.
- Every print source is fetched, auto-oriented, center-cropped to the ordered
  canvas, flattened to opaque white, and encoded as an exact-ratio sRGB JPEG
  before submission. The immutable result is stored by content hash and exposed
  through a short-lived URL issued by the authenticated Convex/Worker boundary.
- Rendering targets 300 DPI for paper or 200 for canvas, capped by native source
  resolution and a 40-million-pixel output budget. That memory bound must not
  remove larger sizes from the catalog. The provider's non-order validator
  accepts lower-density images; this is not a guarantee of print quality.
- Option `39` (no bleed) is used only for direct Fine Art Paper because bleed
  option `36` changes the effective aspect ratio and can trigger rejection.
- Framed Fine Art Paper uses its mat option groups without direct-paper option
  `39`. Canvas uses its canvas-specific option group.
- Private print-source capabilities must retain at least 23 hours of their
  documented 24-hour Worker lifetime when returned. Short-lived or stale
  capabilities fail preparation before the provider-submission fence.
- Borders are rendered inside that exact outer canvas, so their width does not
  change the dimensions LumaPrints validates.

Keep these rules in the request builder and its tests rather than duplicating
them in route code.

## Submission, reconciliation, and errors

- The former anonymous `/api/shop/validate-image` and
  `/api/shop/shipping-price` provider relays are retired. Their paths remain only
  as compatibility tombstones that return a fixed empty HTTP 410 response
  without reading the request body or calling LumaPrints.
- New print orders use durable jobs: resolve one paid line, prepare one image,
  issue download capabilities in batches of at most 20, then submit. Source
  descriptors and progress are checkpointed in Convex; restarting a step does
  not re-render the whole order. A scheduled watchdog recovers interrupted
  calls. The job holds a separate lease from the irreversible provider fence.
- Only new orders created by the updated host are enrolled. Deployment does not
  replay historical orders. Non-print orders retain their existing path.
- After POST, new jobs wait at least a minute before GET confirmation and retry
  inconclusive reads with backoff through the existing 24-hour window. A retry
  never clears an uncertain submission or repeats its POST. Older orders retain
  their prior retry policy.
- Preparation errors or exhausted step retries stop for operator review with
  a safe order diagnostic, without inferring provider rejection or refunding.
- HTTP 201 means only that preliminary checks passed and asynchronous processing
  was queued; it does not prove that the order was accepted into production.
- Create-order failures use an operation-specific disposition. Only the
  documented non-acceptance statuses `400` and `406` are definitely rejected.
  Network failures, timeouts, rate limits, server or unexpected statuses, and
  malformed success responses remain uncertain. Error bodies are byte-bounded
  and reduced to fixed reason labels, known request-field paths, numeric
  provider codes, and validated image dimensions; raw text, URLs, and customer
  data are never retained. Submission failures report the
  safe evidence and HTTP status to Vercel/Sentry before recovery, with a bounded
  Sentry flush. Diagnostics do not change the submission disposition.
- Network, timeout, rate-limit, server, and not-yet-visible reconciliation
  results remain retryable. They keep the durable submission claim.
- A documented create non-acceptance can enter the refund path only after an
  atomic, claim-bound rejection checkpoint. Reconciliation read rejection does
  not prove that the earlier create request was rejected.
- Malformed reconciliation responses, ambiguous results, and local client
  faults persist a bounded `reconciliation_blocked` class. Normal webhook
  retries stop GET work at that state. A leased operator alert remains
  retryable only inside the email provider's idempotency window. The host
  reauthorizes the lease immediately before a send. An unconfirmed completion
  after that bound becomes delivery-uncertain and cannot send again. Existing
  V2 claims return baseline `unavailable`; an additive read exposes uncertainty
  to the current host.
  Recovery needs a reviewed, GET-only result and the
  webhook-authoritative reconciliation mutation.
- Classified permanent failures enter the Stripe-refund/Convex-failure-state
  path and send an admin diagnostic. If a Stripe refund request returns no
  provable result, the request becomes `request_outcome_unknown`; automatic code
  cannot submit it again. Changes to this path must preserve payment, refund,
  order-state, and notification idempotency together.
- A provider-verified manual refund can update payment state after submission
  starts. This update keeps the uncertain submission claim, so checkout retries
  cannot send a second provider order.
- The exact fenced POST result can resolve after a refund. A GET-verified result
  can also resolve an uncertain or blocked claim. Both transitions store the
  validated provider number without changing refund truth or sending replay
  notifications.

The lower-level client throws `LumaPrintsError`; routes and orchestration own the
customer-facing policy.

## Shipment notifications

The hub route `/api/webhooks/lumaprints` is the only shipment intake owner. It
claims a tokenized Convex lease by the canonical provider-global order number,
then sends through Resend with a stable provider-number idempotency key. Active
leases and send/checkpoint failures return retryable non-2xx responses inside
the bounded idempotency window. A send failure releases its lease and stores
only a bounded failure code. An expired lease can be reclaimed only before that
window closes and only when a durable bounded-retry marker retains the immutable
first attempt. A pre-rollout released row without that evidence becomes delivery
uncertainty instead of starting a new retry window. The host reauthorizes the
lease immediately before sending. Later unconfirmed delivery becomes durable
uncertainty; V2 returns baseline `completed`, and no second email is sent.
Later shipment events can still update tracking data without clearing this
email fence. Historical shipped rows and legacy email markers remain
terminal unless the row has explicit V2 lease evidence. The old provider-global
claim/checkpoint functions remain only as an inert rollout bridge for V2 rows;
the site-scoped shipment lookup, claim, and checkpoint APIs remain deprecated
admin-auth compatibility surfaces. They require authenticated stored site-admin
membership and reject webhook-secret-only callers.

## Environment

```dotenv
LUMAPRINTS_API_KEY=
LUMAPRINTS_API_SECRET=
LUMAPRINTS_STORE_ID=
LUMAPRINTS_USE_SANDBOX=true
PRINT_FULFILLMENT_RUNNER_SECRET=
```

Deploy shared Convex job support before the updated host. Configure the same
unique runner secret in both, and set Convex `PRINT_FULFILLMENT_RUNNER_URL` to
`https://www.angelsrest.online/api/internal/print-fulfillment`. This callback
accepts only a job ID and live lease token; it never accepts an order payload or
tenant selected by a caller. Set production `LUMAPRINTS_USE_SANDBOX=false`
explicitly; retain `true` for previews. Do not point a production scheduler at
a preview deployment.

Use `.env.local` for local development. LumaPrints sandbox and production are
isolated, and production test orders can revoke API access. Keep sandbox mode
enabled in local and Vercel preview environments; never use a production order
as a development test.

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

Before another paid attempt, confirm the store's default billing address and
primary payment method, then use the authenticated, non-order
[`POST /api/v1/images/checkImageConfig`](https://api-docs.lumaprints.com/api-5384561)
with the exact print source and options. The
[`POST /api/v1/pricing/shipping`](https://api-docs.lumaprints.com/api-10598366)
endpoint can check the destination and print configuration without ordering.
Do not retain private source URLs or customer details in diagnostic records.

On 2026-09-04, ORD-003's verified PNG (6935 × 4623, 55,009,177 bytes), glossy
subcategory `103007`, landscape 6 × 4 size, and option `39` passed image
validation with HTTP 200. A shipping quote using the saved order address also
returned HTTP 200 with six methods. The owner confirmed both billing
prerequisites. These checks created no order or charge; they do not establish
why the earlier order POST was rejected or guarantee order acceptance.
