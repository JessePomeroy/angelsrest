# LumaPrints integration

LumaPrints is the print-on-demand fulfillment boundary for eligible shop
orders. Stripe owns payment, Convex owns order state, and LumaPrints owns print
production and shipment.

## Runtime checkpoint — 2026-09-15 UTC

Angels Rest production has used `PRINT_INPUT_PROTOCOL=frozen-v1` since the
September 6 activation. It is still off by default in an unconfigured environment;
those are different facts. Other tenants and historical purchases are unchanged.

Two separate integration repairs are now verified:

- Short print filenames: host [PR #613](https://github.com/JessePomeroy/angelsrest/pull/613)
  and Worker [PR #110](https://github.com/JessePomeroy/gallery-worker/pull/110)
  preserve capability security while issuing `/print-source/<token>/print.jpg`.
  The exact saved artwork produced an identity-checked sandbox order on September 14.
- Immutable artifact replay: Worker [PR #111](https://github.com/JessePomeroy/gallery-worker/pull/111)
  handles real R2 conditional PUT exceptions as well as the documented `null`
  result. On a non-size-related PUT exception, it checks the existing object's
  complete immutable descriptor and checksum; only an exact match succeeds.
  Conflicts, missing objects, and unreadable storage still fail closed. Synthetic
  real-R2 tests reproduced the failure before the patch and passed after it.

Worker version `ef6cdef4-4664-47c9-ad5b-f742947663b7` was deployed at 00:33 UTC.
The already-paid `ORD-014` then recovered through its normal scheduled retry:
artifact preparation and issuance completed, provider order `10002005297` was
identity-confirmed, and the job became `done` at 00:39 UTC. The owner confirmed
the same number in the provider dashboard as Awaiting Fulfillment. This proves
that purchase reached the provider; it does not prove printing, shipment, or
recovery of earlier unresolved orders. No manual replay or extra paid order was
used for that recovery. Detailed incident analysis belongs in the Obsidian project
record; this document retains the current operating contract and bounded evidence.

## Current source flow

The client-ownership work adds an optional saved supplier connection to accepted
orders. When present, one resolved provider client supplies the payload builder,
submission, confirmation and retry lookup; workers must acknowledge that exact
context. Existing orders without context retain central routing. No checkout
producer captures the new context yet, and central shipment intake cannot update
client-scoped orders. Dedicated client shipment intake now authenticates each
connection and scopes every checkpoint and email retry key. Client setup,
pre-payment capture and provider acceptance remain required before activation. See
the
[client supplier contract](docs/contracts/client-lumaprints-connections.md) for
the additive rollout, legacy scope and credential-rotation rules.

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

The immutable Stripe checkout session ID remains the Convex idempotency key and
internal fulfillment-command identity. Existing orders and other tenants also
retain it as their LumaPrints `externalId`.

New Angels Rest orders enrolled in a print job by a compatible host opt into
`printOrderReferenceVersion: 1`. Convex freezes `lumaprintsExternalId` as
`AR-<orderNumber>` (for example `AR-ORD-015`) in the same transaction that creates
the order and job. The `AR-` prefix separates these references from older
unprefixed LumaPrints store IDs. Only Angels Rest webhook authority may opt in;
the caller cannot supply the reference itself. Existing-order replay never adds
or replaces a reference, including when an older host replays a new order.

The current runner acknowledges the stored provider reference when claiming
work. A mismatching or older runner fails closed before new submission or
reconciliation; it cannot reinterpret a readable reference as a Stripe ID.
Provider POST and GET use the saved reference, while Convex receipt, refund,
and reconciliation commands retain the immutable Stripe identity. A single durable claim marker fences provider submission.
The coordinator provides at-most-one provider POST per durable claim; it does not
promise exact-once delivery. After a claim, retries only reconcile that exact
persisted provider reference and do not replay the POST.

Rollout: deploy the additive Convex schema/functions before this host. The host
then opts in only new Angels Rest orders; backend deployment alone does not
rename orders. Rollback must retain a compatible runner for jobs that already
have readable references. No backfill or update of existing provider orders is
part of this change. A future intentional order-number reset must use a new
provider-reference namespace rather than reuse `AR-` numbers already submitted.

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

### Frozen print-input protocol (opt-in; active for Angels Rest)

The reservation endpoint additionally accepts `printInputVersion: 1`. Only a
host deployed with the corresponding paid-input consumer should send it. The
Angels Rest production host explicitly opts in; unconfigured environments do not.
Old reservations/orders are not backfilled.
Deploy the additive Convex schema/functions before enabling a consumer.

For opted-in reservations, Convex captures each line's resolved price, print
dimensions/border, provider subcategory and options, and verified original R2
descriptor in the reservation transaction. Capture requires the exact currently
published revision for that tenant. It is bounded to 40 lines, 20 sources per
line, and 512 KiB of instructions. A replay preserves the first instruction,
including after catalog changes; it cannot switch input versions.

Paid intake transfers that instruction to the order atomically with consuming
the bound reservation. Printed orders require `shippingRecipientName` and the
paid address/quantities. The recipient is distinct from `customerName` (payer).
Order replay does not replace either the instruction or recipient. Existing
orders retain their historical resolution and retry behavior. No provider POST,
refund, receipt, admission, or reconciliation fence is removed by this rollout.

The runner consumes a frozen order directly: resolve from its saved instruction,
prepare/checkpoint the existing recipe, then call the shared recorded-order
submission/recovery coordinator. It does not retrieve a Stripe Checkout Session,
re-resolve the historical catalog, create/replay the paid order, or send its
payment receipt. Fulfillment outcome alerts still use the existing claims.
Orders without frozen input retain the historical runner path. The new
`product` field on job items is additive; deploy this backend before enabling
frozen reservation capture. Source deployment alone does not enable capture.

LP-05 activation is explicit: leave `PRINT_INPUT_PROTOCOL` unset until the
LP-02/03/05 Convex schema/functions and LP-04 Worker (`cdc1b6f`) are deployed and
the corresponding host/runner is available. Then `PRINT_INPUT_PROTOCOL=frozen-v1`
enables only new `angelsrest.online` handle-v2 checkouts. Missing/empty is off;
other values fail closed for this tenant. Other sites remain unchanged.
The reserved version is stamped into Stripe's server-built Session metadata
and admission fingerprint. Paid intake copies the verified shipping recipient
for that version regardless of the current gate, and Convex's bound reservation
remains the instruction authority. Toggling the gate cannot reinterpret an
already reserved attempt; a version conflict requires a fresh checkout attempt.

For frozen jobs, the source row's `descriptor` remains the original.
`artifact: { recipeVersion: 1, descriptor }` records the independently rendered
JPEG. The saved paid input retains requested dimensions/options; the prepared
item records the renderer's orientation-adjusted dimensions. Recipe 1 is the
existing bounded auto-orient/crop/inside-border/opaque-sRGB-JPEG renderer, not a
new image algorithm. Provider URLs are issued only for the artifact. Older jobs
retain their progressing descriptor and token-upload protocol.

The direct upload performs one dedicated authenticated PUT with no automatic
fallback; timeout/retry uses the same content-addressed key and immutable replay.
Both transports are exercised by `pnpm test:print-contract` against real Worker
handlers pinned at `fb0974b5e54f83349d52e04690323f42ff9f6d4f`, with only R2/runtime
substituted and no network fallback. Locally place that Worker revision at
`.contract/gallery-worker`; CI fetches it with the existing private-repo credential.

Rollback: disable new capture first, but keep the frozen consumer, additive
Convex schema and Worker route until all frozen reservations/jobs are drained.
Do not deploy a pre-LP-03 runner over frozen jobs or remove required schema fields.
No backfill/replay, paid test order, credential activation, or manual deployment
is authorized by source merge. Provider acceptance needs separate evidence;
the dated runtime checkpoint above records the purchase actually confirmed.
The [activation and retirement runbook](docs/runbooks/frozen-print-rollout.md)
records the ordered runtime gates, retained callers, and evidence needed before
removing compatibility code.

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

The hub route `/api/webhooks/lumaprints` owns legacy central shipment intake.
`/api/webhooks/lumaprints/[connectionRef]` uses dedicated per-connection Basic
credentials, validates immutable ownership, and resolves confirmed or provisional
numbers only in that connection. All lease/checkpoint calls retain the same scope.
The host shares one parser/orchestrator between these entry points; spokes do not
receive either the hub secret or a second shipment handler. Client email keys are
`shipment-email:<connectionRef>:<providerNumber>`; legacy keys remain unchanged.
See the client supplier contract for registry, credential rotation and provider
subscription acceptance requirements.

Both entry points claim a tokenized Convex lease by canonical order number inside
the authenticated supplier scope, then send through Resend with a stable
idempotency key. Active
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
terminal unless the row has explicit V2 lease evidence. The old central
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

### Authenticated prepared-image diagnostic

`POST /api/admin/commerce/print-image-diagnostic` defaults to `{ "orderId": "…" }`
from a same-origin, authenticated Angels Rest site administrator. The read-only
Convex query independently checks stored membership and selects only an unresolved
frozen order with a provisional provider number, a completed single-source job,
and an existing prepared JPEG of at most 10 MB. It never falls back to an original
or accepts an image URL or artwork descriptor from the caller.

The diagnostic issues a fresh download capability without replacing the saved
one, verifies anonymous HEAD/GET, exact bytes/hash and JPEG dimensions, then makes
one production `POST /api/v1/images/checkImageConfig`. It does not upload artwork,
submit/retry orders, alter order/job/source state, refund, or send notifications.
Responses contain only bounded diagnostic fields: no credentials, capabilities,
private object keys, customer fields, or raw provider messages. A successful
image check proves current retrieval and image compatibility, not asynchronous
order creation or historical acceptance. Production sandbox-mode configuration
fails closed for this default request; it never retries a request.

The report separates `provider.urlMatches` from `provider.dimensionComparison`
(`exact`, `transposed`, `different`, or `unavailable`). `passed` requires HTTP 200,
the exact echoed URL, and same-axis pixel dimensions. An HTTP 200 whose response
cannot be fully verified has outcome `unverified`, not `failed`; reversed axes
are reported without assuming that the provider physically rotated the image.
Neither outcome grants order-submission or retry authority.

#### Explicit sandbox mode

Add `"environment": "sandbox"` for an image-only sandbox check. This uses the
same saved JPEG, Worker issuer, anonymous download verification, and redacted
report, but only `https://us.api-sandbox.lumaprints.com`. The issuer credential
and temporary image URL stay server-side. Separate server-only variables are
required: `LUMAPRINTS_SANDBOX_API_KEY`, `LUMAPRINTS_SANDBOX_API_SECRET`, and
`LUMAPRINTS_SANDBOX_STORE_ID`. Missing configuration fails closed; these never
fall back to or replace production fulfillment credentials.

An explicitly approved provider-order probe additionally supplies
`"sandboxExternalId": "ar-sandbox-prepared-<UUID>"`. It submits one single-item
sandbox order using the exact checked URL and saved print options, quantity one,
and fixed synthetic recipient details. It cannot accept a destination, product,
URL, store, or credentials from the caller. No Stripe operation, customer email,
or order/job/source mutation is involved. The sandbox order probe allows the
observed transposed dimensions only when HTTP 200 echoes the exact URL and both
decoded dimensions match; the conservative image report remains `unverified`.

This operator probe is **not an idempotent fulfillment endpoint**. Record a
durable local attempt marker before sending a submission request, invoke it once,
and never resend after a timeout or lost response. There are no automatic
retries. `queued` means HTTP 201 with a valid provisional order number, not final
acceptance. Follow up with sandbox GET-only reconciliation and compare the saved
external reference, item/options, and `order.imageUrlSha256`. A POST transport
error or malformed success is `unknown`; only 400/406 is `rejected`.

#### Prepared-image sandbox probe — 2026-09-14 UTC

The approved server-side sandbox diagnostic was deployed separately from live
fulfillment configuration. Anonymous HEAD/GET verified the existing prepared
1800 × 1200 JPEG, exactly 1,208,785 bytes and its saved SHA-256. Both the image-only
check and the check immediately before submission received sandbox HTTP 200,
with the exact 614-character Worker capability echoed and dimensions reported
as 1200 × 1800. The conservative image outcome therefore remains `unverified`.

Exactly one sandbox order POST at 22:30 UTC returned HTTP 201 with provisional
number `10000339497`. Subsequent GETs still returned 404 through 22:58 UTC. At
22:36 UTC, the complete store-scoped order list and dashboard contained only the earlier
synthetic-image control (`10000339496`), whose GET still returned 200. This is
unconfirmed asynchronous creation, **not** evidence of a 400/406 rejection.
Do not resubmit the probe or infer the background-processing cause from 201.

The original production order and saved source projection had identical
before/after fingerprints. No production order, refund, job replay, or customer
notification was performed. The issuer credential and image capability stayed
server-side.

The owner subsequently authorized controlled sandbox order tests as needed.
Nine additional tests used byte-identical synthetic JPEGs (49,792 bytes), the
same print/shipping configuration, and distinct test references. Every image
check returned 200 and every order POST returned 201. With a total URL length
of 614 characters, a long query or long parent directory plus `print.jpg` produced
a retrievable order; a 562-character final filename did not. A 128-character
filename also worked, while 240, 255, 256, and 519-character filenames remained
404. The existing Worker URL's final filename is 519 characters.

This isolates long-filename handling as the strongest explanation, not total
URL length or JPEG MIME/bytes. The precise internal limit/mechanism is unknown;
do not describe it as a proven 255-byte filesystem error. A proposed compatible
URL shape is `/print-source/<encrypted-token>/print.jpg`, with the token moved
to the parent segment and the same authorization/expiry semantics. The compatible
fix accepts both shapes in the host and issues the short filename in the Worker
while retaining legacy redemption. The v1 cryptographic domain, expiry, immutable
object checks, and paid-file URL format remain unchanged. Host telemetry scrubs
both print-capability shapes. Roll out the host before the Worker; neither this
fix nor a successful sandbox test authorizes replaying production orders.

Retained Worker logs for 22:28–22:35 UTC contain 15 fulfillment events, all 200
or 206, including three full GET responses immediately after the order receipt.
URLs are redacted, so the timing/route evidence cannot independently identify
the exact capability or caller, nor prove that LumaPrints consumed every byte.
No provider-internal processing trace was available in the inspected dashboard
or published API. No email to the provider was needed for these differential
tests, and none was sent.

#### Short-filename fix verified — 2026-09-14 23:23 UTC

The compatible host change was deployed first as
`dpl_GtYMUyhazxK1kh1Tq2jHZVScc5a1`, followed by CMS media Worker version
`9655e6eb-b9b8-4d89-a5bf-7ccd51f8a6ff`. Worker bindings, observability settings,
compatibility date, and existing Container image were retained; no secrets were
rotated. The host/Worker contract passed against both the old CI-pinned Worker
and the new source. At that checkpoint, CI adopted merged Worker repair
`ff69466907215ff739b2f82545bf8c625a879b18` ([Worker PR #110](https://github.com/JessePomeroy/gallery-worker/pull/110)).

A fresh sandbox order used the same saved 1,208,785-byte, 1800 × 1200 JPEG and
saved print options. Its URL is now 620 characters overall but ends in the
nine-character `print.jpg`. Anonymous HEAD/GET and the saved hash matched;
the image checker still returned 200 with the exact URL and transposed dimensions.

The one-shot POST returned 201 with number `10000339507` at 23:23:27 UTC.
GET returned **200 at 23:23:41 UTC**, with matching store, external reference,
item, options, and submitted image-URL fingerprint. Provider status was
`Pending Payment`; this confirms sandbox order creation, not payment or shipment.
Unlike the earlier long-filename test, the order is now retrievable.

Live anonymous HEAD/GET also succeeded for the legacy URL equivalent, returning
identical bytes. The original production order and saved source projection kept
the same before/after fingerprints. No production order was submitted or replayed.

Checks passed: 960 Worker tests and typecheck; 2,023 host tests, 27 protocol tests,
five build-ignore tests, lint, Svelte check, production build, and seven real
host/Worker contract cases against each Worker source. Svelte check requires
the documented public environment variables. Build retained the existing optional
Sharp-platform and Resend renderer dependency warnings.

#### Live result — 2026-09-14 UTC (September 13 local time)

The approved single-image investigation ran against the existing prepared JPEG
for the unresolved frozen order created on September 6. No new order was submitted.

| Check | Observed result |
| --- | --- |
| Fresh Worker capability | 614-character URL; approximately 24 hours remaining |
| Anonymous HEAD and GET | Both HTTP 200; expected JPEG headers |
| Saved artifact verification | Exactly 1,208,785 bytes; SHA-256 matched the saved descriptor |
| Decoded JPEG | 1800 × 1200 pixels |
| Saved print configuration | 6 × 4 inches; subcategory 103007; option 39 |
| LumaPrints image checker | HTTP 200; reported actual and recommended dimensions of 1200 × 1800 |
| Existing provisional order lookup | Still HTTP 404 |
| Order, job, and source records | Before/after digest identical |

The diagnostic returned `provider_response_unverified`, because its conservative
response check requires the provider's reported width and height to match the
decoded image in the same axis order. This is **not** a provider 400/406 rejection:
the provider returned 200 with transposed dimensions. The published response
contract does not explain that normalization, and that initial report did not
separately retain the URL-echo comparison. The later reporting refinement cannot
recover that missing observation retroactively. Do not reinterpret the result
as proof that the image is invalid or that a physical rotation occurred.

This verifies current anonymous access to the exact prepared artwork and records
the provider's successful HTTP response. It does not establish historical URL
availability, asynchronous order creation, or the cause of the missing order.
The next decisive evidence is LumaPrints' processing trace/error for the original
provisional order number and external reference. Do not clear reconciliation
fences or resubmit the order based on this image check.

Source: [LumaPrints image-check contract](https://api-docs.lumaprints.com/api-5384561).

#### Local preparation checks — 2026-09-14 UTC

The seven host/Worker contract cases pass against both the CI-pinned Worker
revision `cdc1b6f` and the separately checked local Worker revision `ea76d28`.
At that checkpoint the CI pin remained unchanged. The expanded proof renders a synthetic
6935 × 4623 PNG, larger than the blocked jobs' 55 MB originals but within the
existing input limit, through download, decode, geometry, JPEG rendering,
both upload transports, capability issuance, and exact-byte retrieval.

This shows that the current implementations handle that source size/dimension
class locally. It neither identifies the historical `step_failed` operation
nor verifies Vercel/Cloudflare resource limits or production credentials. No
historical jobs were replayed and no provider order endpoint was called.

### Host/Worker artwork contract

`pnpm test:print-contract` connects the actual host upload/URL client to the
actual Worker handlers. It uses synthetic JPEG bytes and an in-memory R2
boundary; unexpected requests fail instead of reaching the network. The proof
covers padded, separate role credentials, immutable replay, byte/hash checks,
tenant isolation, and provider-style unauthenticated GET/HEAD downloads.
It does not prove Cloudflare routing, deployed secrets, real R2 behavior, or
LumaPrints acceptance. The Worker retains its own route/runtime tests.

CI checks out the reviewed Worker revision pinned in `.github/workflows/ci.yml`
under ignored `.contract/gallery-worker`, using the existing read-only
cross-repository token. Locally, create that same source-only checkout:

```bash
git clone --no-checkout https://github.com/JessePomeroy/gallery-worker.git .contract/gallery-worker
git -C .contract/gallery-worker checkout --detach fb0974b5e54f83349d52e04690323f42ff9f6d4f
pnpm test:print-contract
```

Do not install Worker dependencies or copy secrets for this test. Update the CI
pin and these instructions together when adopting a new Worker interface.
Missing access/source is a failed check, never a skipped proof.

Before runtime activation, separately verify the deployed host/Worker revisions,
operation-specific credentials, sealing roots, runner URL/secret, and explicit
provider environment/store. Confirm pending jobs and submission fences before
changing admission. This test creates no order and grants no replay authority.

### Focused unit checks

```bash
pnpm exec vitest run src/lib/__tests__/lumaprints.test.ts
pnpm exec vitest run src/lib/__tests__/lumaprintsUrls.test.ts
pnpm exec vitest run src/lib/server/__tests__/printFulfillment.test.ts
pnpm exec vitest run src/lib/server/__tests__/orderIntake.test.ts
pnpm --filter @jessepomeroy/print-catalog test
```

The owner authorized controlled sandbox checks as needed on September 14, 2026.
Verify sandbox credentials and store before each run; use fresh test references
and never replay uncertain submissions. This does not authorize production test
orders, historical production retries, or unrelated deployment/configuration
changes. Never use a production checkout as a routine development smoke test.

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
