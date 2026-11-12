# Frozen print input: activation and retirement

LP-01–05 are additive source changes, not a production acceptance result.
The new checkout protocol is disabled by default. This runbook grants no runtime
effects: deployments, configuration changes, synthetic R2 writes, provider
requests, and historical recovery require their own explicit scope/approval.
Reflecting Pool remains deferred.

The interface, rendering rules, and submission policy live in
[LUMAPRINTS.md](../../LUMAPRINTS.md). Do not substitute a paid test order for
contract verification or assume HTTP 201 proves provider acceptance.

## Verified deployment checkpoint — 2026-09-15 UTC

Angels Rest explicitly enabled `PRINT_INPUT_PROTOCOL=frozen-v1` on September 6.
The September 14–15 repairs additionally verified short-filename provider
acceptance and real-R2 immutable artifact replay. Worker
`ef6cdef4-4664-47c9-ad5b-f742947663b7` let the existing `ORD-014` scheduled retry
complete; provider order `10002005297` was confirmed at 00:39 UTC. No historical
job replay was required. Printing, shipment, and earlier unresolved orders were
not established by that result. See the [runtime checkpoint](../../LUMAPRINTS.md#runtime-checkpoint--2026-09-15-utc)
for source and deployment evidence.

The unchecked list below is a reusable procedure for a future activation, not
a claim that the production gate remains disabled. Configuration defaults,
source availability, deployed activation, and provider confirmation are separate.

## Ordered activation checklist

These are operator gates, not actions automatically completed by source PRs.

- [ ] Record exact deployed revisions, target tenant/provider environment/store,
  and existing reservations/jobs/submission states using authorized read-only
  inspection. Closing checkout admission does not stop already scheduled work.
- [ ] Keep host `PRINT_INPUT_PROTOCOL` unset. Deploy the additive shared Convex
  schema/functions containing LP-02, LP-03, and LP-05 (host source `7cea0cd` or a
  reviewed descendant). Shared Convex deployment is a separate manual workflow.
- [ ] Deploy Worker LP-04 (`cdc1b6f914edc79fad256ce3a98bd7ab8b50e1ea` or a reviewed
  descendant). Verify the dedicated `PUT /v1/catalog-assets/print-artifacts`
  route is available at the host's configured Worker origin.
- [ ] Verify the corresponding host/runner is deployed. Confirm the production
  callback URL and matching runner authentication, operation-specific upload and
  issuance credentials, fulfillment sealing roots, and explicit provider mode
  and store. Never copy credential values into the evidence log. Package
  publication/adoption, if needed by a consumer, follows the separate
  [package release procedure](package-release-and-adoption.md); do not take over
  an unrelated release PR.
- [ ] Run the pinned `pnpm test:print-contract` and matching CI. This exercises
  actual host/Worker code over synthetic R2 with no network fallback. Separately
  verify deployed configuration/routing: local proof cannot establish real R2,
  Cloudflare routing, credentials, or provider access. A synthetic live artifact
  upload is an R2 write and needs an approved exact target and cleanup plan.
  Include first PUT, identical replay, and conflicting replay against the same
  key. A local R2 substitute returning `null` cannot verify native R2 exceptions.
  Record unchanged bytes/ETag on conflict and remove only task-created fixtures.
- [ ] Only after the preceding gates pass, explicitly authorize enabling host
  `PRINT_INPUT_PROTOCOL=frozen-v1` for new Angels Rest handle-v2 checkouts.
  Other tenants stay unchanged. An existing attempt cannot switch versions;
  a protocol conflict needs a fresh checkout attempt, not reservation mutation.
- [ ] Record runtime evidence separately from source completion. Authorized
  non-order image validation must use the exact rendered artwork/options; it
  does not prove billing or order acceptance. Provider confirmation requires
  matching stored external identity/store, not merely a provisional number or
  absence from the dashboard. No new order or replay is authorized here.

## Rollback without changing existing purchases

Disable new capture first. Existing reserved/paid frozen inputs remain versioned
and must continue through the compatible consumer even after the gate is off.
Keep the additive schema, direct-finish runner, and dedicated Worker route until
their outstanding reservations, callbacks, and jobs are accounted for. Prefer a
forward fix over deploying an old runner that cannot read already-written state.

Never turn a frozen order into an old-protocol order, backfill its recipient
from the payer, clear a provider fence, or resend to replace an expired provider
URL. A missing GET/list result is not proof that the previous POST had no effect.
Payment, refund, cancellation, and notification truth remain independent.

Print URL redemption intentionally depends on fulfillment sealing roots and
the sealed tenant/object claims, not the upload/issuance registries. Removing
an issuer credential alone does not revoke an already-issued print URL. Root
rotation, object revocation, and expiry affect existing capabilities and need
separate review; do not use them casually as a rollout toggle.

## Retirement disposition

Source inspection at `7cea0cd` found the following paths still reachable.
No production drain inventory was performed for this source-only refactor.

| Surface | Why it stays | Condition before narrowing |
|---|---|---|
| Non-frozen branch in `printFulfillmentJob.ts`: historical source resolution and `handleCheckoutCompleted` | Existing paid jobs lack frozen specification/recipient | Account for old jobs, delayed payment intake, retries and callbacks; retain a reviewed recovery reader for existing purchases |
| `printFulfillment.ts` snapshot builder and `preparePrintSources` | Existing non-prepared orchestration still calls them | Prove all calling paths and supported old-order recovery have moved, not merely that new checkout capture is on |
| `storeRenderedPrintSource` and token-upload branch in `catalogCommerceClients.ts` | Old preparation and non-frozen jobs still use token issuance plus PUT | Inventory host versions and Worker consumers before removing either side; do not remove browser/editor upload behavior |
| Original descriptors and accepted provenance | Existing bytes and validation depend on them; frozen rows distinguish original from rendered artifact | Retain readable history; this is not an executable Sanity dependency |
| Submission/refund/notification claims and uncertainty adapters | Existing external effects cannot safely be inferred or repeated | Separate evidence-backed lifecycle work, never generic migration cleanup |

These callers mean no production code or behavioral tests are deleted in LP-06.
The direct frozen path replaces the handoffs for new opted-in orders; the old
path is retained for real state, not run in parallel as a second sender.
Independent receipt scheduling, artifact caching, and moving the renderer are
not prerequisites and remain separate proposals.

## Evidence record

For each authorized rollout, record revision/CI links, date, tenant, gate state,
checks performed and their bounded result, and the remaining permitted action.
Do not log secrets, private capability URLs, raw provider responses, or customer
details. Keep source merge, runtime activation, provider queue acknowledgment,
identity-checked confirmation, and shipment as distinct milestones.

## Source retirement assessment — November 9, 2026

The debloat pass retains the versioned fulfillment APIs. Current Hub calls in
`src/lib/server/printFulfillment.ts` use `claimPrintFulfillmentV5`. V4 and V5
already share `claimPrintFulfillmentWithAdmission`; deleting the small V4 wrapper
would remove compatibility rather than a second coordinator implementation.

An older name can still own current work: `expirePrintFulfillmentPreparationV4`
is scheduled by the shared coordinator and explicitly handles both V4 and V5
rows. Removing it would break preparation expiry for the current protocol.
V1–V3 also retain exact result shapes and fences that prevent older hosts from
claiming newer obligations after a lease expires or is released. The existing
order tests exercise these mixed-version guards; they are not dead-symbol tests.

Local caller searches cannot establish deployed or historical non-use. No live
order inventory or provider operation was performed for this assessment. Before
a separate retirement change, establish all of the following:

- Every deployed runner, supported package consumer and retained rollback source
  has adopted the replacement contract; an archived consumer is not assumed gone.
- Authorized operational evidence shows which unresolved obligations, old row
  shapes and scheduled callbacks still require each version, with a reviewed
  continuation or drain plan. Absence from a local import graph is insufficient.
- The API removal has an explicit compatibility/release disposition and an
  ordered deployment/rollback plan. A source cleanup does not authorize that rollout.
- Current V5 expiry and old/new-host concurrency, uncertain submission, refund
  and notification evidence remain protected by focused tests and contract checks.

Until those conditions are met, retain the APIs and their tests. This assessment
completes the bounded investigation; it does not declare retirement safe or
request a migration, live-data read, deployment or provider retry.

## Retirement — November 11, 2026

The owner approved retiring the superseded entry points in the next major
`@jessepomeroy/crm-api` release. `orders.ts` no longer exports the V1–V4
`claimPrintFulfillment*` claims, `completePrintFulfillmentSubmission`, the V1
`claimAutomatedFulfillmentRefund`, `completeAutomatedFulfillmentRefund`, the V1
`claimFulfillmentFailureNotification`, or the deprecated site-admin shipment
exports. The hub already calls only `claimPrintFulfillmentV5` and the V2/V3
notification and refund coordinators.

Retained behavior:

- `claimPrintFulfillmentV5` still resumes rows admitted under coordinator
  version 4 and refuses released or unadmitted version-3 rows.
- `expirePrintFulfillmentPreparationV4` remains the scheduled expiry for both
  version-4 and version-5 preparation leases.
- Historical unversioned and version-3 rows stay readable. Begin, reject,
  reconcile, reconciliation-blocking, manual-refund and shipment-intake paths
  handle them without the removed claims.

Evidence (2026-11-11, read-only production checks without customer data):
14 orders, all `angelsrest.online`. The non-terminal coordinator-version-4 rows
are owner-confirmed $1 launch-rehearsal orders (ORD-002 to ORD-009), which V5 and
the recovery paths above still handle. `galleryDownloads` had 0 rows. The hub has
called only V5 since #518 (2026-09-05), and no production rollback candidate
older than that is retained for this retirement.

Before the Convex deploy, re-count `galleryDownloads` in every target deployment
(`pnpm exec convex data galleryDownloads --deployment <name> --limit 1`). Until
then `galleries.logDownload` is still a live mutation, so rows could appear. Stop
if any exist.

Rollout order: deploy the hub on admin 7 first, then the matching Convex
functions, then publish the package. Every remaining consumer must have
stopped calling the removed functions before the Convex deploy. This source
change does not authorize that deployment.
