# Explicit client commerce admission

C4a adds explicit client admission to the existing closure protocol. Creating a
platform client, registering an account or accepting a syntactically valid domain
does not open commerce. C4b adds current payment readiness, no client
platform-payment fallback and supplier prerequisites. Source delivery does
not establish launch readiness or activate a client.

## Registry versions

The host `NEW_ORDER_CHECKOUT_CONTROL` and backend
`NEW_ORDER_ADMISSION_CONTROL` / `NEW_PROVIDER_SUBMISSION_CONTROL` share one pure
parser. Missing, malformed or unlisted configuration resolves closed.

Version 1 remains exact: two entries for `angelsrest.online` and `zippymiggy.com`,
each with `siteUrl`, `state`, and a positive safe-integer `generation`, at most
4,096 UTF-8 bytes. Its existing response shape and behavior are unchanged.

Version 2 accepts up to 100 explicitly listed entries at most 65,536 UTF-8 bytes.
Each entry has exactly `siteUrl`, `tenantId`, `state`, and `generation`:

```json
{
  "version": 2,
  "tenants": [
    {
      "siteUrl": "client.example",
      "tenantId": "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b",
      "state": "closed",
      "generation": 1
    }
  ]
}
```

This is a synthetic example, not production configuration. A registry replaces
the entire purpose's list; include every intended existing tenant when preparing
an upgrade. An omitted tenant is closed at the host. Changing backend environment
intent does not change an already activated durable row: use the explicit
activation transition to close it.

Domains must be canonical lowercase DNS names without scheme, path, port,
trailing dot or leading `www.`. Each label and the whole hostname are bounded;
IP literals and duplicate domains are rejected. Stable IDs use the existing
`tenant_UUIDv4` format. The same tenant may have separately controlled retained
domains during a rename; duplicate domain entries are never allowed. Host callers
retain their existing URL normalization, while configured entries and backend
request bodies remain canonical.

## Durable authority and identity

The existing tenant-authenticated activation transport and internal mutation
remain the only control writers. The HTTP operation envelopes stay version 1;
registry version 2 is a separate configuration format. Domain syntax validation
does not replace the tenant-specific credential/body-site checks.

Activation must exactly match the purpose's configured state/generation. An open
version-2 tuple, or any first identity binding, must resolve to the registered stable tenant through the existing
tenant/alias authority. The durable row stores that tenant ID. Subsequent
activation cannot transfer or remove it. Upgrading an existing unpinned row
requires a strictly higher generation; same-tuple calls replay and concurrent
identical activation remains idempotent. Admission still requires explicit
agreement with the host generation.

Closing a pinned tuple does not require usable Stripe/supplier credentials or a
present client record. It retains the original tenant and still needs matching
environment intent and a new monotonic generation. A connection problem must not
prevent the operator from closing new work.

Direct, cart and signed-bridge host paths compare the server-resolved client with
the host's pinned ID before reservation/payment. Fresh backend reservations and
Checkout admission require the same activated ID. The initial transition from
`active_prestripe` to Stripe creation rechecks durable control ownership. None of
these checks accepts a browser-supplied tenant as authority.

First provider submission also checks the activated tenant. For retained central
orders without a stored tenant ID or client supplier context, the existing
registered domain must resolve to the control's ID. This bounded legacy path
does not select a supplier or rewrite an order. Client supplier contexts retain
their stricter original-identity requirements.

## Recovery and adoption

Existing reservation replay, already-creating/uncertain/bound Checkout recovery,
and already-admitted provider obligations retain their original identities,
generations and uncertainty fences. Closing new work is not cancellation of a
paid order. This change does not move payments or supplier jobs between accounts,
alter refunds, or create an account replacement path.

Deploy the additive backend before configuring a version-2 host. Verify stable
tenant registration, matching canonical domains, purpose-specific credentials,
all intended entries and the exact durable/host generations before activation.
Complete backend/host adoption, provider and financial acceptance, and the outstanding tax
determination before opening new client commercial activity. Shared backend
deployment, secrets/configuration, live activation and provider acceptance remain
separate effects; release PR #629 is not routine feature-merge authority.

For rollback, close new admission using the retained version-2 identity and a new
generation. Preserve compatible consumers for captured reservations, paid orders
and admitted provider work. Do not downgrade a pinned durable control, clear
history, or remove credentials required by accepted work.

## Verification

Offline tests cover shared parsing and bounds, exact legacy compatibility,
registered/unknown/foreign identities, aliases, concurrent activation,
monotonic upgrade/no-downgrade, missing host/tenant identity, scoped HTTP
authentication, reservation replay, Stripe-creation recovery, and provider
admission/recovery after closure. No test establishes actual provider readiness,
billing, tax responsibility or live activation.


## C4b: first client payment readiness

New non-hub charges require a stable registered tenant and its currently selected,
immutable `full-v1` Stripe binding. A missing or malformed connected account never
falls back to Angels Rest's platform balance. Angels Rest's own checkout retains
platform-account routing. Payment target lookup and historical account ownership
use verified tenant aliases, including canonical requests for stored full URLs;
this does not migrate catalog/content partitions or create aliases automatically.

The hub-only `platform.getClientPaymentTarget` query requires `WEBHOOK_SECRET`
and validates tenant/domain/account ownership before returning the creation
attempt and safe current status. It never exposes refresh tokens. Customer
checkout does not impersonate an admin. First order attempts claim a status
refresh after signature/proof/abuse checks and admission, then verify the Stripe
platform, mode, account identity, controller and payment/payout status through
bounded provider reads. The latest committed status is authority; a discarded
provider observation cannot authorize a charge. Missing, checking, restricted,
unavailable and disconnected states stop new payments.

All new client order checkout uses the opt-in frozen-input/supplier-capture
protocol. A digital or merchant-only reservation explicitly returns null supplier
and needs no LumaPrints account. Supplier-backed print lines use their saved
connection for outbound/shipment credential validation and a bounded store-access
read. The supplier environment must match the verified Stripe mode. Store access
proves API usability, not supplier billing or shipment acceptance.

The version-1 `mark-creating` HTTP envelope now accepts an optional UUID
`checkoutSnapshotHandle`. The hub sends it for client order checkout. Before the
first transition from `active_prestripe`, the backend requires this handle,
checks the matching reserved account/tenant and frozen-input/capture protocol,
and rechecks current Stripe binding plus observed charges/payouts readiness less
than 60 seconds old. Supplier-backed reservations additionally require the same
current saved supplier, matching mode, and an open durable provider-submission
control for that tenant. The admission pins the snapshot hash and binding cannot
substitute a different snapshot afterward. Old hub envelopes remain unchanged.

Already creating, uncertain or bound attempts replay their original Stripe
idempotency identity before new readiness checks. A supplied snapshot handle
must still match the pinned one; legacy replay may omit it. Host retries do not
re-read current supplier credentials or provider status once creation may have
started. Preserve protocol enrollment and original request/configuration needed
for replay; removing capture enrollment or changing the current payment target
is not an account-recovery operation.

A failed pre-payment check returns a resetting 409 only after the backend
positively confirms `released: true`. A false or unknown release result keeps
the attempt and returns a 5xx failure. This distinction preserves the existing
browser retry protocol and prevents replacing an attempt that another request
may already have sent to Stripe. A later authenticated admission read confirming
`released_definite_no_session` also permits a reset after a lost release response.

Service invoices verify current payment readiness after resolving a valid
payable token, without supplier requirements or an application fee. They retain
the existing invoice fingerprint/idempotency protocol; invoice retries refresh
readiness again, so a newly unavailable connection can temporarily withhold the
Checkout URL. This slice does not introduce order-admission semantics into
invoice payments or change their paid-event processing.

Adopt the updated backend before enabling client capture/commerce on the host.
Deploying source alone leaves enrollment and client activation closed. Existing
paid orders, original-account refunds and already admitted provider work retain
their previous recovery rules. Closing new commerce remains possible without
Stripe/supplier readiness. No account creation, live provider request, secret
change, fee/tax policy change or automatic commercial activation is performed by
this source delivery.
