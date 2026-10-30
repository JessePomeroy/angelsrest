# Connected client workflows

These additive shared-backend contracts support Angels Rest and Queen Worm. Host
and Admin adoption follows backend deployment and package publication; merging
these contracts does not enable the new controls on a client website.

## Private real-site previews

The authenticated draft-preview queries in `content`, `portfolioGalleries` and
`catalogProductGraphs` require stored tenant membership and the exact current
draft revision. They return the same safe content projections as public reads,
without changing publication. Invalid, incomplete or superseded drafts fail
closed. Existing anonymous queries remain published-only.

Hosts issue short-lived preview URLs only after site authorization. Preview loads
must repeat authorization, validate the session-bound grant and exact public
path, and read the revision through the authenticated client. Responses must be
private, uncached and excluded from indexing. Preview purchases and contact
submissions must remain unavailable.

## Inquiries and booking

`inquiries.linkClient` creates a lead or links an existing client from the same
tenant. Repeating the same action returns the existing link. The original inquiry
stays intact; a new lead receives the request in its notes, and the CRM activity
records the inquiry link. Existing client notes and booking status stay intact. Unlinking requires the expected current client and retains the original request and CRM audit history.

`getWorkflow`, `clientOptions`, `linkClient`, `unlinkClient`, `updateFollowUp` and `listForClient`
require Full access and stored site membership. Follow-up dates use calendar
dates; completed follow-ups leave the due list. The paginated inbox can select
due work before limiting its read. Ordinary Basic-tier inquiry triage is
unchanged.

## Private delivery proofing

`galleries.updateImage` accepts bounded editing notes and favorites only while
proofing is enabled and the selection is open. `submitProof` requires a current
gallery token, any password grant, and the expected proofing round. It freezes
the selected filenames and notes into a submission plus child records. The
gallery's existing 2,000-image bound also bounds this transaction.

Repeated submission returns the same submission. The owner can explicitly reopen
the selection; earlier snapshots stay immutable, and a stale submission from the
previous round is rejected. Owner management requires Full access; reads are tenant-authorized and paginated.
Submission raises the Galleries admin notification flag and records CRM activity.
The indexed submitted-selections filter reaches older galleries and orders them
by their latest submission; reopened selections leave that queue.
Gallery deletion includes bounded cleanup of submission and snapshot records.
Host notification email and recipient controls require the corresponding host
adoption; these backend contracts alone do not establish email delivery.

## Catalog and collection reads

`zine` is a fixed-price, merchant-fulfilled physical product with gallery media.
It uses the existing variants, publication, stock, shipping, checkout snapshot
and merchant fulfillment boundaries. Zines do not accept print selectors or
production-partner fulfillment. A tenant's product-kind policy must explicitly
include `zine`; the new type does not activate commerce.

`portfolioGalleries.listPublishedNavigation` reads one cover and the count for
each published, visible collection. Detail remains available through
`getPublishedBySlug`. The existing `listPublishedSummaries` response stays
unchanged for existing consumers.

## Rollout order

1. Merge verified backend source and publish its CRM API release.
2. Deploy the shared Convex backend at the reviewed merged source.
3. Publish the compatible shared Admin additions.
4. Adopt the published packages and wire host previews, workflow controls and
   gallery recipient pages in Angels Rest and Queen Worm.
5. Preserve each tenant's product permissions while adding the approved zine
   capability; verify the enabled UI with synthetic content.
6. Release the hosts and verify their enabled public and private features.

Queen Worm checkout remains closed until separate commerce activation. Paper
handbook synchronization remains deferred at the user's request. None of these
local checks replaces the client integration readiness gate or owner handoff.

## Host adoption: saved previews and inquiry workflows

The host now pins Admin 6.11.0 and binds the Full inquiry follow-up/client-link
and owner proof-history APIs. Its editor preview controls issue session-bound
links through `POST /api/admin/draft-preview/[kind]`. Site settings render on `/`,
About and Contact share `/about`, portfolio drafts render on `/gallery/[slug]`,
and products use `/shop/[slug]` or `/shop/sets/[slug]` according to their kind.
Each preview load rechecks stored site membership and the exact current draft.
Private projections pass through the same validated public adapters. Hidden
portfolio drafts are visible only inside the authorized preview; storage
visibility and publication do not change.

Contact/booking and purchase actions are disabled in previews. Existing baskets
stay untouched. Signed preview parameters are omitted from analytics and scrubbed
from telemetry. Both preview pages and grant endpoints retain private no-store,
noindex and no-referrer controls, including rejected requests. Ordinary published
pages continue through the existing public boundaries and cache policy.

Zine is enabled in this host's product editor; tenant policy and service
activation remain separate. Recipient proofing controls and notification email
still need their own host adoption. Queen Worm's matching host changes are a
companion release. Package and backend publication alone do not make these
website controls live.

The granular auth and preview entrypoints are used by public loaders to avoid
tracing unrelated email modules into their bundles. The original barrel-import
adoption measured 275,657,186 function bytes and exceeded the existing limit.
A controlled granular-import trial measured 273,022,310 bytes. The normal
production build using published Admin 6.11.0 measured 273,022,310 bytes under
the unchanged 275,200,000-byte limit, with six functions and a largest function
of 70,154,852 bytes. Its built HTTP preview denial test passed. Local lint,
zero-diagnostic Svelte checks, 115 script tests, 3,139 unit tests and 28 protocol
tests also passed. Authentication mocks were updated to target the new public
entrypoint; production authentication behavior is unchanged.

The final desktop/mobile preview cases preserve the visible product category and
stored basket while disabling contact and purchases. Both rendered preview notices
were inspected. The rebuilt host repeated the private HTTP check and size budget,
and final type/lint checks passed with synthetic public Convex build endpoints.
