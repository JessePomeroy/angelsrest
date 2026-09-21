# Client LumaPrints connection identity

This C3a foundation records a tenant's verified supplier identity independently
of its current selection. It does not change existing fulfillment, capture an
order's supplier yet, provision accounts, configure credentials, or establish
that a store is ready for sales. Host adoption and shipment isolation follow.

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
address. There is no provider verification in this database-only foundation.

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
