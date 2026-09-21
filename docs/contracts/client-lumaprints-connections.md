# Client LumaPrints connection identity

The C3a foundation records a tenant's verified supplier identity independently
of its current selection. C3b1 adds the server credential resolver and explicit
provider client. C3b2 consumes saved order context and fences older workers.
C3c adds authenticated client shipment intake and scoped notification retries.
Pre-payment capture, connection setup, and provider acceptance still follow;
no live client-owned fulfillment or store readiness is claimed.

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

The later checkout producer must freeze this non-secret context before payment.
The paid-intake consumer now copies it from the bound reservation into the order,
and durable jobs use that original context for payload construction, submission,
confirmation, and external-ID lookup. A changed/missing credential mapping stops the operation,
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
configuration. `createOrderLumaPrintsClient(savedContext)` selects that legacy
client only when the saved context is absent. A supplied context never falls back.
The independent top-level operation wrappers were removed after host adoption;
fulfillment receives one client factory and constructs one client per operation.

## Saved paid-order context

Reservations and orders accept an optional `lumaprintsConnection` containing the
five immutable, non-secret identity fields. No checkout writer emits this field
yet. The paid-order API does not accept it as an argument, and Stripe/browser
metadata cannot set it. Paid intake transfers it only from the exact bound
reservation, alongside frozen print input, in the same transaction that creates
the order/job and consumes the reservation. A missing or mismatched immutable
connection, wrong tenant, or context without frozen print input aborts the entire
transaction. Replays return the original order context; they do not infer or
backfill it from the client's current selection.

The worker passes this saved context through the shared recorded-order coordinator.
Before claiming provider work, the coordinator checks tenant identity and resolves
one captured provider client. Missing/mismatched configuration stops without a
provider request or automatic refund. Non-print orders need no supplier client.
The V5 claim requires exact acknowledgment of the saved context and validates
historical ownership. Legacy V1–V3 workers cannot claim context-bearing work;
V4/V5 callers without the matching acknowledgment cannot submit or reconcile it.
All existing uncertainty, lease, refund, provisional-receipt and retry fences stay
in place. A credential outage cannot authorize a second POST.

Confirmed and provisional supplier numbers are unique within the immutable
connection reference. An absent context is a separate legacy scope. Both lookup
types use bounded compound indexes over `lumaprintsConnection.connectionRef` and
the provider number. Thus equal numeric order IDs in separate supplier accounts
do not conflict or change each other's orders. Calls from the central shipment
endpoint search only the legacy scope. They cannot confirm a client receipt or
claim its shipping email. Client shipment intake authenticates its own scope
before using these same operations.

The existing Angels Rest incident-image diagnostic is explicitly legacy-only;
it refuses context-bearing orders instead of testing them under central keys.
This does not introduce a general client diagnostic or restore retired public
image/pricing relays.

## Authenticated shipment intake

`/api/webhooks/lumaprints/[connectionRef]` selects an entry from the same bounded
registry, then authenticates the request before consuming its body or accessing
orders. The reference is public routing information, not authorization. Dedicated
server variables are `LUMAPRINTS_CONNECTION_<credentialRef>_WEBHOOK_USERNAME`,
`_WEBHOOK_PASSWORD`, and optional `_WEBHOOK_PASSWORD_PREVIOUS`. Password rotation
keeps the username and immutable connection fixed. Retain previous credentials
only for the explicitly managed overlap window. No credential values belong in
client/browser data, this document or logs.

Current/previous credential pairs cannot overlap another connection or the central
webhook pair, including connections owned by the same tenant. Both sides of an
overlap fail closed. Central intake remains independent when no client registry
is configured; a malformed configured registry blocks intake until corrected. A missing unrelated
pair does not disable a correctly configured connection. Incoming shipments do not
require working outbound API keys, so revoking order-creation access need not
strand already-submitted work. Keep immutable history and the original inbound
credentials available until historical deliveries are settled.

Each V2 claim, send authorization, uncertainty lookup, release and completion now
accepts an optional saved supplier context. Absence means legacy central scope.
The backend independently checks exact saved order context and historical
ownership; an order ID or claim token alone cannot cross supplier scopes. A valid
shipment can resolve a provisional receipt only within that same scope. Current
selection changes do not retarget old work, and stable tenant/domain history
resolves the current notification profile for retained old-domain orders.

Client shipping-email keys include the immutable connection reference and provider
number. Central keys retain their original format to preserve active retry
windows. The existing 15-minute lease and 23-hour automatic recovery bound remain;
an unconfirmed completion after that bound becomes delivery-uncertain without a
new automatic send. [Resend retains idempotency keys for 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys).
The host does not claim that a provider acceptance response proves mailbox delivery.

The provider supports a [store subscription with a unique URL and optional Basic credentials](https://api-docs.lumaprints.com/api-9678991).
Our integration requires those credentials. Its subscription probe must receive
200, but the documented request does not fully specify that probe's payload or
method. Confirm it during separately authorized sandbox acceptance before
subscribing a client; do not add an unauthenticated or empty-body success exception.
The new route retains the bounded shipment parser and does not subscribe, contact
the provider, or activate new checkouts on deployment.

## Adoption and verification

The schema/claim protocol are additive. Existing orders without context retain
central routing; no backfill occurs. No runtime caller registers connections or
captures checkout supplier context in this slice. Deploy the compatible backend,
host consumer, and authenticated shipment intake before separately approved
registration/capture/activation. Keep Stripe onboarding disabled through the
unfinished commerce work. Once context-bearing work exists, rollback must retain
the optional schema fields, scoped indexes and compatible workers until that work
is drained; an older worker cannot take it over. Retain connection history and
historical credential references. Do not switch a sandbox binding to
production in place; use isolated sandbox acceptance records and explicit
production setup.

Offline tests cover authorization, two-tenant separation, concurrent requests,
idempotency, immutable fields, aliases, absent configuration, corrupt ownership,
and historical reads. They do not prove actual credentials, billing or fulfillment.
LumaPrints' [sandbox](https://api-docs.lumaprints.com/doc-2394350) does not progress
orders or send shipping events. Simulated authenticated shipment tests and real
production delivery evidence must remain distinct in the acceptance record.
