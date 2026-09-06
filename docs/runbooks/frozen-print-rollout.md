# Frozen print input: activation and retirement

LP-01–05 are additive source changes, not a production acceptance result.
The new checkout protocol is disabled by default. This runbook grants no runtime
effects: deployments, configuration changes, synthetic R2 writes, provider
requests, and historical recovery require their own explicit scope/approval.
Reflecting Pool remains deferred.

The interface, rendering rules, and submission policy live in
[LUMAPRINTS.md](../../LUMAPRINTS.md). Do not substitute a paid test order for
contract verification or assume HTTP 201 proves provider acceptance.

## Ordered activation checklist

These are operator gates, not actions completed by the source PRs.

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
