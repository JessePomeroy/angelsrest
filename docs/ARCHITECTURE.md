# Architecture

This is the current system map for Angels Rest. `AGENTS.md` remains the
canonical rule file; this document explains ownership and dependency direction.

## Dependency direction

```text
SvelteKit routes and UI
  ├── Sanity client (editorial reads / preview)
  ├── Convex generated API (operational reads and writes)
  ├── @jessepomeroy/admin (shared admin UI and host adapters)
  ├── @jessepomeroy/print-catalog (pure shared print domain)
  └── server integrations (Stripe, LumaPrints, Resend, gallery workers)

packages/crm-api
  └── Convex schema, functions, and generated public API

packages/print-catalog
  └── pure catalog and pricing data/functions
```

Packages do not import the SvelteKit host. Browser code does not import server
modules or private environment variables.

## Data ownership

| Domain | Owner | Entry points |
|---|---|---|
| Published editorial content during migration | Sanity fallback | `src/lib/sanity/client.ts`, `client.server.ts`, public load functions |
| Embedded Editor drafts, revisions, and media registry | Convex | `packages/crm-api/convex/*Content.ts`, `mediaAssets.ts` |
| Editor media sources and public WebP derivatives | Cloudflare R2 | CMS media worker via `/api/admin/media/*` |
| Private catalog print masters and paid files | Cloudflare R2 bytes; Convex registry and coordination | purpose-separated receipt ingresses in `convex/http.ts`, internal `catalogPrivateAssets.ts` mutations |
| Orders and fulfillment state | Convex | `packages/crm-api/convex/orders.ts` |
| Inquiries | Convex | `packages/crm-api/convex/inquiries.ts`, `/api/contact` |
| CRM, board, invoices, quotes, contracts | Convex | matching Convex modules |
| Platform tenants and connected Stripe accounts | Convex | `platform.ts`, `authHelpers.ts` |
| Private delivery galleries and image metadata | Convex | `galleries.ts`, `portal.ts` |
| Private gallery objects and prepared downloads | Cloudflare R2 | gallery worker via shared admin handlers |
| Print catalog metadata | `@jessepomeroy/print-catalog` | `packages/print-catalog/src/` |

“Portfolio gallery” and “delivery gallery” are separate domains. Use the full
name when an unqualified `gallery` would obscure the owner.

## SvelteKit boundary

- `+page.server.ts` and `+server.ts` compose remote clients and enforce HTTP
  boundary validation.
- `.server.ts` modules contain preview tokens and other private-only logic.
- Public `.svelte` components consume serialized load data or browser-safe API
  clients.
- `src/hooks.server.ts` owns security headers, Sanity preview state, and server
  error capture. Admin authentication lives in the admin layout and auth routes,
  not in the global hook.

### Public inquiry boundary

1. The contact form renders the shared Cloudflare Turnstile widget and submits
   its short-lived response token with the form payload.
2. `/api/contact` validates the payload and sends the token plus client IP to
   the managed siteverify Worker before any email or Convex side effect.
3. A successful route call forwards the server-only `WEBHOOK_SECRET` to
   `inquiries.create`; direct public Convex callers are rejected.
4. The public widget key and Worker URL live in `src/lib/config/turnstile.ts`.
   The widget secret exists only as the Worker's `TURNSTILE_SECRET_KEY` binding.

Future client contact forms may share the managed Worker, but their production
hostnames must first be added to the widget. Browser-only verification is not a
security boundary; keep verification inside the host route.

## Admin architecture

1. Better Auth establishes the browser session.
2. `src/routes/admin/+layout.server.ts` validates the session and checks the
   authenticated email against the host site's stored `adminEmails` membership
   before child server loads return sensitive data.
3. `src/routes/admin/+layout.svelte` authenticates the Convex WebSocket through
   `setupAuth`, driven by the server-validated layout state.
4. Queries use the authenticated WebSocket.
5. Mutations use `/api/admin/mutation`, which validates the cookie and creates a
   fresh authenticated `ConvexHttpClient` for the request.
6. Convex functions enforce site or creator membership through
   `requireSiteAdmin`, `requireDocumentSiteAdmin`, or `requireCreator`.
7. Shared server handlers, including gallery-worker/R2 operations, call the
   host's per-request site-admin verifier before performing side effects.

### Editor media boundary

1. The authenticated browser asks `/api/admin/media/capability` for one bounded
   upload capability; the host verifies site-admin membership and authenticates
   to the CMS media Worker with the `angelsrest.online` tenant credential.
2. The browser sends the exact image directly to the capability-bound Worker
   URL. The tenant credential remains server-only.
3. `/api/admin/media/process` verifies the same admin again, asks the Worker to
   finalize and create the fixed WebP derivative set, then registers the ready
   asset through an authenticated Convex mutation.
4. `/api/admin/media/delete` accepts only the Convex media document ID. The
   shared server saga asks Convex for the exact tenant-bound deletion manifest,
   removes those objects through the Worker, then completes the retained Convex
   tombstone through the site's server-only `.convex.site` boundary. Worker or
   completion failures remain retryable; no storage key or tenant authority is
   accepted from the browser.
5. Private sources remain in the CMS private bucket. Public pages receive only
   immutable derivatives from `https://media.angelsrest.online`.
6. This boundary is separate from private client-gallery delivery and does not
   switch any public content type away from its Sanity fallback by itself.

### Private catalog asset registration

1. Storage and independent content inspection use separate tenant-scoped
   credentials at two Convex HTTP receipt ingresses. Reuse across either role or
   tenant makes the complete boundary unavailable rather than broadening access.
2. Either complete receipt set alone creates only a non-authoritative
   coordination record. Matching canonical asset evidence from the other role
   creates the bounded target set and marks it verified in one Convex transaction.
3. No public or authenticated-admin mutation can create these verified rows.
   Responses expose only the status and source-key-to-Convex-ID mapping; storage
   keys, hashes, provenance, capabilities, and private URLs remain server-only.
4. The registration gate is provider-neutral and reusable, while each migration
   must still prove its exact manifest completeness. Sanity remains authoritative
   until that migration's unpublished import, parity, rollback, and cutover gates pass.

Authenticated server reads also create a fresh client through
`createAuthenticatedConvexClient`. The cached `getConvex()` client is reserved
for unauthenticated or server-secret call paths and must never receive
request-specific auth through `setAuth`.

The manual WebSocket setup exists because an older Better Auth adapter could
pause auth during SvelteKit navigation. Treat transport changes as auth changes
and test full client-side navigation, expiry, logout, and concurrent requests.

## Commerce and fulfillment

### Shop checkout

1. The selling site resolves current product/catalog data; browser-supplied
   prices are not authoritative.
2. Angels Rest creates its own Checkout directly. Client spokes call the signed
   `/api/tenant-checkout/print` bridge using their stored bare-domain tenant key.
3. The hub resolves the canonical stored tenant before selecting its
   `CHECKOUT_BRIDGE_TENANTS` entry. Each tenant has independent signing secrets
   and explicit success/cancel redirect origins; two secrets are allowed only
   during bounded rotation. A spoke credential cannot authorize another tenant.
4. After signature and redirect validation, the hub rejects caller-supplied
   dispatch metadata. It stamps the tenant's bare-domain key into reserved
   Session and PaymentIntent metadata, then creates Checkout on the connected
   account or the platform account during an explicitly supported pre-handoff
   phase.
5. The active `Your account` commerce destination sends platform-owned events
   to this repository's `/api/webhooks/stripe`. A future disjoint
   `Connected accounts` destination will send connected-account events to the
   same route with its own signing secret. Client spokes do not own a parallel
   `checkout.session.completed` processor.
6. The webhook reads the raw body once and accepts either bounded commerce
   signing secret. The matched secret authenticates transport only; it does not
   select tenant or business authority. `orderIntake.ts` resolves `event.account`
   back to the stored tenant when present; platform-account events use the
   server-owned metadata key and a webhook-secret-protected Convex profile
   lookup. Conflicting or unknown tenant identities fail closed.
7. `webhookOrders.ts` creates or reuses the Convex order and schedules fee
   capture outside the webhook hot path.
8. Eligible items go through `printFulfillment.ts` and LumaPrints.
9. Notifications are sent through Resend with the resolved tenant's name,
   public origin, and admin recipient. The shared `orders@angelsrest.online`
   mailbox remains the transport sender until per-tenant verified sending
   domains are deliberately onboarded.

This is a runtime ownership boundary, not merely shared code: one Stripe event
must have exactly one order-intake owner. Future Stripe Connect clients add
tenant configuration and use the bridge; they do not copy the webhook
coordinator into their repositories.

R4 closure uses three purpose-specific, tenant-scoped controls rather than the
platform-wide emergency `ORDER_PRODUCERS_STATE` gate. The host Checkout control,
Convex order-admission control, and Convex provider-submission control use exact
versioned registries and monotonic generations. Unit A adds dormant durable
backend state: universal Checkout admissions fence unknown Stripe creation,
bound Sessions retain signed order intake after new admission closes, and the
V4 provider coordinator persists admission independently from its preparation
lease. Existing V1–V3 callers and schedulers retain their prior semantics until
the compatible host adopts the new protocol. New tables and order fields are
additive/optional, so this widening requires no migration or backfill.

### Retired order replay protection

An owner-approved full reset can remove disposable Angels Rest order rows only
through the fixed internal `orderReset.apply` operation. Both producer states
must be explicitly closed. Invocation also requires fresh deployment evidence
that all producer hosts stayed closed longer than their maximum request runtime.
This quiescence gate drains provider work that passed a legacy claim before the
reset code ran. Reset invocation and producer reopening remain separate
approvals.

The operation has a dedicated 50-row transaction cap and is atomic. It retains
one minimal `retiredOrderSessions` tombstone per Checkout Session, preserves
audit and customer tables, and writes a versioned one-use receipt. The receipt
pins a SHA-256 digest of the exact sorted Session, account, routing, site, and
old-order binding manifest. Retry and verification require that exact manifest
and reject any global live order for a retired Session. The operation stops on
source overflow, all known legacy site aliases, global Session conflicts,
existing tombstones, a bound checkout reservation in any account scope, an
active or recent effect lease, unresolved print submission or reconciliation,
or a provider-owned nonterminal refund.

When the owner has separately attested that every affected order is their own
disposable test data and has accepted any residual provider charge or shipment,
the distinct internal `orderReset.applyOwnerTestOrders` mutation may use the
same atomic reset with one exact literal authority. That exception ignores only
the normalized `print_submission_unresolved` class. Refund activity, a stored
nonterminal provider order, active deadlines, recent activity, source drift,
duplicate Sessions, reset artifacts, and bound reservations still stop the
transaction. The strict `orderReset.apply` behavior is unchanged. Both paths
share the same permanent Session tombstones, manifest receipt, idempotent
`orderReset.verify` query, and global replay-conflict checks.

The owner-test reset has a distinct committed one-use caller, operation ID,
custody directory, and permanent marker. It claims the marker before final host
configuration or any Convex call, launches the mutation at most once, and runs
one read-only verification after an applied or already-applied response. A lost
or malformed mutation response is commit-ambiguous: the caller never retries
the mutation and performs only one verification read, emitting either a fixed
verified-response-loss class or a fixed unknown-outcome class. Child output,
errors, identifiers, counts, receipt data, and raw failures are never exposed.

After a `live_effect` stop, the fixed internal `orderReset.classifyLiveEffect`
query can classify the block only under separate read authority. It uses the
same closed-state requirement, tenant source, and conservative bound. Its
response contains only normalized source or live-effect classes in a fixed
order. It exposes no row, identifier, PII, amount, count, deadline, or provider
data and causes no mutation or external request.

A separately approved provider investigation can use
`orderReset.providerInvestigationTarget` only through the Convex CLI's
explicit Production deployment authority. The selector remains internal and is
not part of the public Convex API. The fixed selector requires both producer
states to be closed, the same bounded canonical source, exactly one unresolved
LumaPrints submission target, no reset artifacts, and no other live-effect
class. Before any configuration, Convex, or provider access, the one-use
operator script atomically creates a permanent attempt marker in its fixed
owner-only local state directory. A missing, unprotected, symlinked, or already
consumed marker path stops the operation. The script holds the selected identity
only in process memory, accepts only explicit or documented implicit Production
provider mode, performs bounded Production GET requests only, rechecks the selector after the scan, and emits one normalized result. It never prints credentials,
identifiers, provider numbers, response bodies, counts, timestamps, or errors.
A match that was not observed is not proof that the earlier submission failed;
it does not clear the durable submission fence or authorize reset.

If target selection stops before a provider request,
`orderReset.classifyProviderTargetConflict` can run only under separate bounded
read authority. It reuses the exact selector assessment and returns only source,
other-live-effect, no-conflict, or deterministic target-conflict classes. It
never returns the selected row, Session, provider number, count, timestamp, or
raw error and causes no mutation or external request. Its fixed one-use operator
caller first requires the host producer state to be explicitly closed, pins the
Production Convex deployment, and consumes a separate protected local marker
before the internal read.

When that classifier returns `unresolved_multiple`, a separately approved
multi-target investigation can use the internal
`orderReset.providerMultiInvestigationTargets` selector. The selector shares the
same bounded canonical source and live-effect checks. It requires at least two
and at most 50 unresolved LumaPrints targets. Every target must have no provider
number, a live unique Checkout Session, and no other target conflict. It returns
the sorted identities only to the trusted local process. The operator claims a
distinct permanent marker before configuration or data access. It performs one
bounded GET-only Production provider scan, compares all identities in memory,
rechecks the exact target array, and emits only `all_observed`, `some_observed`,
`none_observed`, `inconclusive`, or a normalized conflict. It prints no identity,
provider number, count, response, timestamp, credential, or raw error and makes
no provider or business-data mutation. Provider absence is not proof of failed
submission and does not clear the durable fence or authorize reset.

If multi-target selection stops before its provider scan,
`orderReset.classifyProviderMultiTargetConflict` can run only under separate
bounded read authority. It reuses the exact multi-target assessment and returns
only source, other-live-effect, no-conflict, cardinality-change, or aggregate
target-shape classes in a fixed order. It never returns a target, count,
provider number, timestamp, or raw error and causes no mutation or external
request. Its fixed caller requires the host state to be closed, pins the
Production Convex deployment, sanitizes the child environment, and consumes a
separate one-use protected marker before the read.

The internal `orderReset.classifyProviderMultiLookupEligibility` query further
reduces only whether the exact accepted multi-target conflict still has
provider-observer-shaped Checkout Session identities. It requires explicitly
closed producers, reuses the same bounded source and target assessment, and
returns only `source_conflict`, `live_effect_conflict`, `state_changed`,
`lookup_shape_eligible`, or `lookup_shape_ineligible`. The stored fulfillment
type participates only in the conservative normalized-state recheck; it is not
provider authority and never selects eligible versus ineligible. Identity shape
uses the shared Stripe Checkout Session validator that accepts exact test and
live forms. The query returns no row, Session, per-target mode, count,
correlation, provider fact, timestamp, or raw error and causes no mutation or
external request. `state_changed` is only normalized category drift, not proof
of row-set continuity. Neither eligibility class authorizes a provider request;
any later operation must freshly select and recheck its exact target array under
separate review, rollout, custody, and invocation gates. The classifier's
fixed one-use caller pins the Production Convex deployment, exact Convex URL,
unique operation ID, and explicitly closed host state. It claims a separate
protected marker before final environment validation or the read, passes only
the minimum CLI environment, bounds time and output, parses only exact one-key
normalized JSON, and maps every child or parser failure to a fixed error class.

After a separately approved `lookup_shape_eligible` result, the internal
`orderReset.providerMultiLookupEligibleTargets` selector can prepare one fresh
bounded provider observation without treating stored fulfillment type as
provider authority. It reuses the canonical 50-row source and other-live-effect
checks, requires two to 50 unresolved rows, accepts only the shared exact test
or live Checkout Session shape, and rejects preparation-only state, any stored
provider number, or global Session non-uniqueness. It sorts the identities and
returns them only to the trusted local process. The distinct one-use caller
claims its protected marker before final configuration, Convex, or provider
access; requires the host and Convex producer states closed; pins the Production
Convex target and Production-only LumaPrints configuration; performs one
existing bounded GET-only scan; and then re-reads and compares the exact sorted
identity array. Any recheck failure or drift suppresses the observation as a
target conflict. Final output is limited to aggregate all, some, none, or
inconclusive observation, normalized source/target/live-effect conflicts, or
fixed configuration/availability errors. It prints no target, count, provider
number, response, timestamp, credential, or raw error and has no mutation path.
A none-observed result is not proof of non-submission and never clears the
durable uncertainty fence or authorizes reset. Source review, rollout, custody,
and Production provider invocation remain distinct gates.

Retired Sessions are terminal replays. Live-order and tombstone coexistence is
a routing conflict. The webhook acknowledges a retired Session before line-item,
order, provider, fee, or email work. `orders.create` also rejects it, and
reservation reconciliation returns before a provider read. Paid downloads are
closed with the producer gate during reset quiescence and check the order or
retirement state before Stripe or file reads. The versioned tombstones and reset
receipt are permanent compatibility data. Do not roll
Convex or the webhook host back to code that does not understand them. Order
numbers can restart at `ORD-001`; old customer lookup and download surfaces
intentionally no longer resolve deleted orders.

### Manual refund reconciliation

The signed commerce webhook accepts `refund.created`, `refund.updated`, and
`refund.failed` as Stripe refund authority. A full, succeeded USD manual refund
is matched to exactly one paid Checkout Session in the event's platform or
connected-account scope. A
Clover Your-account Snapshot can put the platform account in `event.context`
without setting `event.account`. The verified destination role authorizes that
value only as Stripe `stripeContext` for the related Session lookup. It never
becomes connected-account, tenant, site, or Convex scope authority. Connected
refunds continue to require verified `event.account` and Stripe `stripeAccount`.
A webhook-only Convex transaction marks an eligible `new` order as `refunded`
and stores the refund ID. Eligibility includes an exact provider result that
raced ahead of the refund. If the refund arrives first, Convex keeps a
provider-verified intent that makes later order creation terminal. Partial,
automated, ambiguous, or conflicting evidence fails closed. This path sends no
email and does not change checkout snapshot reservations. Manual reconciliation
also cancels pending fee capture before another provider read can store data.
Print fulfillment uses an expiring preparation lease and an atomic submission
fence. A verified refund that wins before the fence clears the preparation
claim. The V3 coordinator stamps its version durably before work and is the only
normal host contract allowed to project a verified refund after the POST fence;
the separately gated incident recovery is the sole exception. Exact V1/V2 rows
remain unversioned. In particular, an exact V1 claimed row whose phase is absent
is uncertain, never evidence that submission has not started. While either a V1
or V2 claim is in flight, Convex returns a retryable reconciliation result and
the webhook host returns a retryable server error; it does not acknowledge and
lose the signed refund. The refund converges only after the legacy host stores
its provider result and Stripe retries the signed event. The V3 tokenized
completion or a webhook-authoritative GET result can store the validated
provider number without changing refund truth.

Deterministic reconciliation faults persist a bounded blocked class. Repeated
GET attempts durably record one bounded outcome class: transport, rate/server,
resource bound, client exception, or result not observed. The bounded per-class
tally escalates by age or total attempt count to durable operator review. That
escalation does not claim the provider order is absent, issue another provider
POST, or authorize a refund. A leased, non-sensitive operator alert can retry
only inside the Resend idempotency window. If its completion stays unknown past
the bounded retry window, delivery becomes durable operator-attention state and
no later automatic send occurs. A reviewed recovery remains GET-only.

Automated fulfillment refunds persist the Stripe refund ID and provider status
separately while the status is `pending` or `requires_action`. Only
`succeeded` populates the terminal order refund ID or authorizes customer/admin
refund-success notifications. Signed `refund.updated` and `refund.failed`
events carrying the server automation marker converge `succeeded`, `failed`,
and `canceled` states even if the checkout worker crashed after Stripe accepted
the idempotent request. Print submission uncertainty or a later verified print
order does not block this signed convergence. If no refund ID was observed, an
expired first request or a request error enters `request_outcome_unknown`; it
never submits another refund automatically. Active no-ID leases remain busy, and known IDs permit retrieval-only checks
while a print fence remains. A definite print rejection writes a one-use
pre-request marker, so the first refund lease is allowed but no later no-ID
checkpoint can submit again. Failed/canceled refunds enter a durable operator-blocked
state and send only an operator alert. Pending or `requires_action` refunds that
exceed the bounded attempt/age policy enter `refund_attention` and authorize one
leased operator-only attention alert; later signed updates may still resolve
them to succeeded, failed, or canceled. New success, failure, and attention
alerts use tokenized leases, stable Resend idempotency keys, and explicit sent
markers. Refund-attention alerts use one order-derived provider identity across
unknown-to-known transitions. An additive claim and pre-send key marker make
mixed-host retries fail closed if either host version could use a different
key. Their
first attempt time is stable. A bounded-retry marker prevents a pre-rollout
released row with no immutable first-attempt evidence from starting a new retry
window. The host reauthorizes the exact lease immediately before
each send, and automatic retries stop before the provider idempotency window
expires. A missing completion then becomes a durable delivery-uncertain state.
Existing V2 claim unions stay exact:
uncertain notification and reconciliation-alert rows return `unavailable` to an
older host, while separate additive reads expose the richer state to this host. Legacy terminal rows still suppress
success/customer notices. If
signed authority moves a legacy row from pending to failed/canceled, it may
authorize one new operator-only failure alert.

Production deployment has a hard precondition: prove that zero V1 or V2 print
submissions are in flight before deploying this backend. Keep new fulfillment
closed while deploying the additive schema, V3 claim/coordinator, and
refund/notification lease mutations, then deploy the V3 host before reopening
fulfillment. The V2 claim return union and object shapes remain exact: a blocked
row maps to baseline `busy`, an uncertain nonblocked row maps to baseline
`reconcile`, and richer blocked state is V3-only. Remove the temporary
baseline-host completion bridge only in a later reviewed release. The bridge
accepts one exact webhook-authorized completion and rejects replays, but it
cannot suppress a confirmation email already owned by an in-flight old host.
It never lets an administrator write provider-global identity.

After any order has V3 coordinator fields, rollback is host-only. Keep the
additive Convex schema, indexes, V3 mutations, and compatibility functions
deployed; do not roll Convex back to a baseline schema or function bundle that
does not understand persisted V3 state. Before rolling the host back, close new
fulfillment and let the V3 host drain every nonterminal V3 row. There must be no
nonterminal V3-marked order, including one with an active or expired preparation
lease, a released preparation lease, a `submitting`/uncertain result, blocked
reconciliation, or an outstanding V3 retry. A fenced submission must reach an
exact POST completion or provider-authoritative GET result; absence never
authorizes a replay. If that drain cannot be proved, keep or restore the V3 host
and do not resume producers on the baseline host. Only after the drain is proved
may the host roll back, with the additive Convex deployment retained.

A disabled-by-default admin recovery route exists only for the reviewed
historical refund incident. `POST /api/admin/orders/refund-recovery` requires an
exact same-origin request, a Better Auth session, stored site membership, the
one server-owned recovery ID, and a matching private environment gate. Convex
also requires the exact incident manifest, the same short-lived private gate,
its exact built-in Production URL, and the same derived admin actor. The route
durably claims the recovery before provider reads. It then retrieves the exact
historical Stripe Event, current Refund, PaymentIntent, and exact Checkout
Session and validates their Charge binding in the server-owned platform context.
Browser input cannot provide Stripe or tenant facts. Convex records normalized
provider evidence for accepted checks and a bounded failed-check list for
rejected checks. It completes a valid reconciliation in the existing order
transaction. A missing order creates no refund intent. Failed or incomplete
claims never become reusable. An audit-write failure returns an explicit
indeterminate result. The route has no admin UI control and sends no email or
fulfillment request. Deployment, gate enablement, invocation, gate removal, and
code cleanup are separate approvals.

The accepted historical reservation closeout retains one minimal non-sensitive
tombstone in `checkoutSnapshotReservationCloseouts`. The table remains in the
schema as audit evidence. The temporary host route, public Convex mutation,
private gate, and incident-only identity evidence are removed after acceptance.
No callable closeout mechanism or reservation capability material remains in
source.

Stripe delivery has three logical consumers. The platform-subscription
`Your account` destination sends subscription events to
`/api/platform/webhooks/stripe`. The commerce `Your account` destination sends
platform-owned commerce events to `/api/webhooks/stripe`. A future
`Connected accounts` commerce destination will send connected-account events to
the same commerce route. Each destination must use Snapshot payloads and API
`2026-01-28.clover`; thin V2 notifications are unsupported. The repository pins
Stripe SDK `20.3.1` exactly because its generated types use that contract. Every
Stripe client constructor also sets the version explicitly. A signed Snapshot
event is rejected before dispatch unless its `api_version` matches.

The two active `Your account` destinations both select
`checkout.session.completed`. The platform route handles only subscription-mode
Sessions marked `platform_subscription`; the commerce route handles only
payment-mode Sessions and also ignores that marker. Commerce
signing-secret roles must also agree with `event.account`, but signature identity
does not select the tenant or business domain. Commerce PaymentIntent failures
require the server-owned commerce tenant marker. Connected-account events also
require the connected signing-secret role and use `event.account` to resolve and
verify the tenant. Before a customer payment-failure email attempt, Convex claims
the signed event ID within its Stripe account scope. Retries, manual resend, and
overlapping destinations converge on that claim. The claim is intentionally
at-most-once for the external attempt: a process failure after the durable claim
can lose an email, but it cannot send a duplicate.

Production rollout is consumer-first:

1. Keep the two active `Your account` destinations unchanged while the commerce
   domain guards, API-version alignment, and payment-failure email deduplication
   are developed and reviewed.
2. Before deploying role enforcement, prove without retaining secret values that
   `STRIPE_WEBHOOK_SECRET` signs the active Your-account destination for
   `/api/webhooks/stripe` and `STRIPE_PLATFORM_WEBHOOK_SECRET` signs the active
   Your-account destination for `/api/platform/webhooks/stripe`. Treat
   `STRIPE_CONNECT_WEBHOOK_SECRET` only as the future connected role. Prove all
   configured role credentials are distinct. If either condition cannot be
   proved, use a separately approved rotation to establish both mappings and
   distinct credentials for every configured role. Retain only value-free
   evidence. Deployment is blocked until this gate passes.
3. Confirm the current commerce destination's Snapshot version and event matrix.
   It currently lacks `refund.created`, `refund.updated`, and `refund.failed`.
4. Under separate deployment authorization, deploy and verify the domain guards,
   explicit API-version contract, and durable payment-failure deduplication.
   Stop before connected-destination creation, secret staging, or event expansion
   until all three consumer prerequisites pass.
5. Before adding connected-account delivery, prove a non-delivering destination
   creation path or approve a revised safe rollout. Stripe's documented API flow
   creates an enabled destination and disables it afterward.
6. Under separate destination-creation authorization, create the connected
   destination in the approved non-delivering state with the exact route,
   Snapshot format, reviewed API version, and five-event matrix. Do not enable
   delivery.
7. Under separate secret-staging authorization, obtain and stage the distinct
   connected-commerce credential. Under separate deployment authorization,
   deploy and verify the exact consumer without changing either active
   Your-account destination.
8. Under separate authorization, enable connected delivery and add all three
   refund events to Your-account commerce. Retain both commerce secrets through
   Stripe's retry window. Historical event replay is not part of configuration.

A code rollback is unsafe while both destinations can deliver or retry events.
First pause the affected checkout producers. Keep the dual-secret consumer active
while deliveries drain. Disable the destination that the old consumer cannot
verify, confirm that it has no pending or retryable deliveries, and preserve its
secret. Only then deploy the old consumer with environment configuration that
retains its one matching destination secret. Verify the retained destination
before resuming its producer. Automated fulfillment recovery remains a separate
owner of its tagged refunds.

### LumaPrints shipment webhook

`/api/webhooks/lumaprints` is the single shipment-intake owner for hub and spoke
orders. It verifies the provider's configured Basic credentials, accepts the
documented top-level shipping payload, and resolves the provider-global
LumaPrints order number to exactly one stored tenant before updating tracking or
sending branded email. Client spokes do not receive the broad Convex webhook
secret or run a second shipment processor. Shipment email delivery uses a
hub-only tokenized lease keyed by the canonical provider-global number. Resend
uses the same stable idempotency key when a completion checkpoint crashes.
The host reauthorizes the exact lease immediately before sending. Automatic
retries stop before the provider idempotency window expires. An unconfirmed
completion after that bound becomes durable delivery uncertainty and the V2
claim returns baseline `completed`; this host verifies the richer state and the
webhook acknowledges without another email send. Only a bounded-retry marker
with an immutable first attempt permits reclaim. A pre-rollout released row
without that evidence becomes durable uncertainty. Active or failed work inside
the bound returns non-2xx so the provider retries. Historical
shipped/claimed rows without explicit V2 evidence remain terminal.

The published site-scoped shipment lookup, claim, and checkpoint APIs remain as
deprecated admin-auth compatibility surfaces, along with their site-scoped
index. They require authenticated stored site-admin membership: the broad
webhook secret cannot authorize them, and arbitrary legacy error strings are
never stored. Rejecting former webhook-secret-only callers is a major-version
compatibility break.

### Invoice checkout

`/api/invoice/checkout` creates payment sessions for token-authorized invoice
flows. Invoice settlement is dispatched by the commerce webhook and recorded in
Convex. Amounts are integer cents across the Stripe boundary.

### Customer order lookup

The hub is the public lookup broker. Convex exposes a bounded customer view only
through a query protected by the dedicated hub-only `ORDER_LOOKUP_SECRET`; this
capability is separate from the broader webhook bearer and is never distributed
to a client spoke or browser. No unauthenticated Convex customer-order lookup is
exposed.

### Platform subscriptions

`/api/platform/webhooks/stripe` is separate from the commerce webhook. It owns
CRM subscription state rather than shop orders or invoice settlement. A
completion activates a tier only when it is a subscription-mode Session with a
nonempty operator-stamped site, customer, and subscription identity. CRM tier
onboarding is operator-controlled; no public self-service subscription-session
creator is exposed. A future self-service flow would require a
tenant-authenticated billing bridge that derives tenant, billing identity, and
redirect authority server-side.

## Convex organization

- `schema.ts` defines the shared platform schema.
- Public functions validate every argument and derive identity through Convex
  auth.
- Tenant data is always checked against stored site membership; a caller-supplied
  `siteUrl` is not authorization.
- Webhook-callable public functions require the shared webhook secret or an
  authenticated authorized caller.
- Queries use indexes and bounded reads. Use pagination or durable aggregates
  when a bounded result cannot truthfully represent a complete result.
- Node-only external SDK work belongs in `"use node"` actions; database changes
  remain in queries/mutations.

Read `packages/crm-api/convex/_generated/ai/guidelines.md` before Convex work.

## Package release boundaries

`@jessepomeroy/crm-api` ships TypeScript re-exports and the Convex source/type
surface to known Vite/SvelteKit consumers. It is intentionally type-check-only;
there is no `tsconfig.build.json` or emitted `dist` requirement.

Public Convex/schema changes require a changeset:

```bash
pnpm changeset add
```

The publish workflow uses Changesets to open a version PR and publishes after
that PR is merged. It no longer hashes generated declarations or auto-increments
every API change.

## Documentation policy

- `AGENTS.md`: canonical implementation rules and checks.
- `docs/ARCHITECTURE.md`: current system ownership and flows.
- `LUMAPRINTS.md`: current print integration details.
- Package READMEs: package-specific consumption/release instructions.
- `docs/archive/`: historical context only. Archived documents must carry a
  warning and must not be cited as current implementation guidance.

Update the smallest authoritative document when a boundary changes. Do not copy
the same workflow into multiple root files.

## Platform repositories

| Repository | Responsibility | Direction |
|---|---|---|
| `angelsrest` | Public creator site, platform hub, shared Convex/package owner | Composition root |
| `angelsrest-studio` | Angel's Rest Sanity instance | Downstream of Studio template |
| `reflecting-pool` | Maggie's client spoke and tenant admin host | Consumes shared packages/services |
| `reflecting-pool-studio` | Maggie's Sanity instance | Downstream of Studio template |
| `sanity-studio-template` | Shared Studio schemas, desk, components, and actions | Upstream for client Studios |
| `admin-dashboard` | Source for `@jessepomeroy/admin` client/server package | Upstream for host admin UI/adapters |
| `gallery-worker` | Separate gallery-delivery and CMS-media Workers with distinct R2 boundaries | Called through host/admin adapters |

Cross-repository contract changes land in the owning upstream first, then flow
to each affected consumer with repository-specific checks.
