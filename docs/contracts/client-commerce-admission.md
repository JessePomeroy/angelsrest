# Explicit client commerce admission

C4a adds explicit client admission to the existing closure protocol. Creating a
platform client, registering an account or accepting a syntactically valid domain
does not open commerce. C4b still owns current payment readiness, no client
platform-payment fallback and supplier prerequisites. This source change does
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
Complete C4b readiness enforcement, financial acceptance and the outstanding tax
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
