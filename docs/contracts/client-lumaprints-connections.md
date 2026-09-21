# Client LumaPrints connection identity

The C3a foundation records a tenant's verified supplier identity independently
of its current selection. C3b1 adds the server credential resolver and explicit
provider client. Paid-order capture/adoption, connection setup, and shipment
isolation still follow; no client-owned fulfillment or store readiness is claimed.

## Ownership and authority

Each client is intended to own its LumaPrints account, Standard Store, and supplier
billing. Angels Rest owns the integration. The hub's own supplier can use the same
identity protocol without a Stripe Connect account.

`platform.registerVerifiedLumaPrintsConnection` requires both a verified creator
session and the hub-only secret. The future host caller must first verify that
the selected store appears under the intended provider credentials, and obtain
explicit operator confirmation of account ownership and billing setup. The
mutation requires both confirmation flags. A client login alone, or a creator
without hub authority, cannot register a supplier.

The provider's [store listing](https://api-docs.lumaprints.com/api-5384565) identifies
available Standard Stores for the authenticated account. It does not establish
who owns the account or whose card pays. [LumaPrints billing setup](https://api-docs.lumaprints.com/doc-421693)
separately requires a primary payment method and the store's default billing
address. The host provider client can verify store access, but no setup route
calls it or registers a connection yet.

## Immutable connection

`lumaprintsConnections` stores:

- Version `1`, an opaque `connectionRef`, stable tenant ID, positive safe-integer
  store ID, and explicit `sandbox` or `production` environment.
- The owning platform-client ID and server timestamps for store verification,
  account-ownership confirmation, and billing confirmation.

No API key, API secret, webhook credential, payment detail, or provider response
body is stored. The reference names server-managed credentials; it is not a
credential itself. Future configuration resolution must verify the whole saved
identity before using those credentials.

Initial registration atomically writes the immutable record and sets
`platformClients.lumaprintsConnectionRef`. An identical repeat returns the same
context without refreshing the original confirmation times. Concurrent setup
cannot change the winning connection, and a reference cannot move between tenants.
Store or environment changes cannot overwrite an existing identity.

Different references may contain equal numeric store IDs. No undocumented global
uniqueness across provider accounts or environments is assumed. Host adoption
must bind credentials to the exact tenant/connection; a bare store or order number
is insufficient routing authority.

## Reads and historical work

`getLumaPrintsConnectionForSite` requires the hub secret and resolves the stable
tenant, including retained domain aliases. An unconfigured client returns null;
it never returns the hub's supplier as fallback. A dangling selection, duplicate
reference, conflicting selection, missing owner, or tenant drift fails closed.

`getLumaPrintsConnectionByRef` also requires hub authority. It resolves immutable
ownership even after a future detachment; it does not assert that the connection
is still selected for new orders. Setup cannot reactivate a detached reference
or replace an existing/historical connection. Reconnect and offboarding need
their own reviewed operational path.

The next adoption slice must freeze this non-secret context before payment and
copy it from the bound reservation into the accepted order. Durable jobs must use
that original context for payload construction, submission, confirmation, and
external-ID lookup. A changed/missing credential mapping must stop the operation,
never reroute it to the latest client store or central configuration. Credential
rotation preserves identity; account/store replacement creates a new identity.
Existing paid work must retain its original central-provider interpretation until
an explicit compatible rollout establishes its context; do not backfill by guessing
the client's current supplier.

## Server credential resolution and provider client

`createLumaPrintsClient(connection)` accepts the complete saved C3a identity,
resolves its server configuration once, and exposes order building, submission,
confirmation, external-ID search, and store-access verification. These operations
share the captured store, environment, and credentials. A configuration change
mid-operation cannot switch accounts between pages or calls. Credentials are
held inside the client, not returned alongside the non-secret order context.

`LUMAPRINTS_CONNECTIONS` is a server-only JSON registry with this shape:

```json
{
  "version": 1,
  "connections": [
    {
      "version": 1,
      "connectionRef": "lp_example_12345",
      "tenantId": "tenant_11111111-1111-4111-8111-111111111111",
      "storeId": 12345,
      "environment": "sandbox",
      "credentialRef": "EXAMPLE"
    }
  ]
}
```

This example is a format illustration, not a client configuration to activate.
The credential reference selects only the dedicated server variables
`LUMAPRINTS_CONNECTION_EXAMPLE_API_KEY` and
`LUMAPRINTS_CONNECTION_EXAMPLE_API_SECRET`. Arbitrary environment-variable names,
caller-selected provider URLs, central keys, and diagnostic keys are not accepted.
Provider URLs are fixed by the explicit environment. No credential value belongs
in this document, Convex, browser input/output, logs, or a spoke deployment.

The registry is bounded to 64 KiB and 100 connections. Every entry must be valid;
duplicate connection or credential references fail closed. All five saved
identity fields must match the selected entry. Copied credential pairs across
tenants or environments are rejected. An unrelated entry's absent credentials
do not prevent a correctly configured connection from resolving. Equal numeric
store IDs in distinct accounts/environments remain valid.

Credential rotation preserves the connection reference, tenant, store, and
environment. A newly constructed client reads the rotated credentials; an
in-flight client retains its original configuration. Before changing credentials,
the operator must verify they still belong to the same supplier account/store.
The registry is trusted operator configuration, not a provider account-ownership
oracle. A different account/store requires a new immutable connection identity.
Never repoint historical references to replacement accounts.

The shared payload builder uses the captured store. Submission rejects a payload
with a different store before HTTP, as an operational configuration error rather
than a refundable supplier rejection. Existing submission uncertainty, bounded
response parsing, confirmation identity checks, pagination bounds and retry
semantics remain in the same implementation. `verifyStoreAccess()` uses the
documented authenticated `GET /api/v1/stores`, checks for the selected store in
a bounded valid list, and retains no provider body or store names. It establishes
API access only; ownership, billing and launch acceptance remain separate.

`createLegacyLumaPrintsClient()` explicitly resolves the existing central
configuration. Existing top-level provider functions temporarily call that
client until the paid-order consumer adopts the saved context. A supplied
client context never falls back to legacy configuration. This source slice does
not yet change order routing or pin supplier identity to an accepted checkout.

## Adoption and verification

The schema and API are additive; existing provider calls and orders are unchanged.
No runtime caller registers connections in this slice. Deploy the compatible
backend and host consumers before any separately approved registration or
activation. Keep Stripe onboarding disabled through the unfinished commerce work.
Retain all connection history on rollback. Do not switch a sandbox binding to
production in place; use isolated sandbox acceptance records and explicit
production setup.

Offline tests cover authorization, two-tenant separation, concurrent requests,
idempotency, immutable fields, aliases, absent configuration, corrupt ownership,
and historical reads. They do not prove actual credentials, billing or fulfillment.
LumaPrints' [sandbox](https://api-docs.lumaprints.com/doc-2394350) does not progress
orders or send shipping events. Simulated authenticated shipment tests and real
production delivery evidence must remain distinct in the acceptance record.
