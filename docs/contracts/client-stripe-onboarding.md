# Client Stripe onboarding

This records account creation, historical payment identity, the authenticated
client setup page, and ongoing account-status synchronization. Checkout readiness
gates, existing-account connection, and per-client supplier routing remain subsequent
work. The source workflow is disabled by default; returning from Stripe is not
evidence that a client can accept payments.

## Account model

New accounts use explicit Accounts v1 controller properties:

- `stripe_dashboard.type: full`
- `losses.payments: stripe`
- `fees.payer: account`
- `requirement_collection: stripe`

The host retains the pinned Stripe API version and SDK. It does not create
Express accounts or enable preview features. Stripe-hosted onboarding owns the
country/capability selection for these accounts; the host no longer forces US
Express capabilities. Direct charges and application-fee calculation are unchanged.
Tax collection and information-reporting obligations remain separate decisions.

## Creation and binding

1. Validate site input and authorize the selected platform client using the
   caller's per-request authenticated Convex client. The creator's own tenant
   cannot enter client onboarding. No Stripe request runs before authorization.
2. Read the Stripe platform account and balance's test/live mode from the same
   Stripe client. Only those routing facts are retained; balances are not stored.
3. `platform.beginStripeConnectAccount` requires the client’s site-admin or creator membership and the
   hub-only server secret. It freezes an attempt UUID, start time, email, site,
   model version, platform account, and mode on the client. Concurrent requests
   receive the same attempt. Profile edits cannot change its provider payload.
4. Create the account with a stable attempt-derived idempotency key. Reject new
   creation after 23 hours of uncertainty; never rotate the key to bypass an
   uncertain provider result. A small cross-host clock difference is tolerated
   inside the conservative window. A bound account can be retrieved later.
5. Verify the returned account's controller settings and client, immutable tenant,
   and attempt metadata. The account must differ from the platform account.
6. `platform.bindStripeConnectAccount` requires both client site-admin or creator membership and hub
   authority, checks the exact attempt/environment, and atomically prevents
   account replacement and cross-client duplicate binding. Return an onboarding
   link only after binding succeeds. Identical bindings are idempotent.
7. Before issuing a refresh link, verify the stored account and environment
   again. Refresh cannot create an account. Start/resume checks stored disconnection
   before provider work and rechecks membership/disconnection after link issuance,
   withholding a temporary link when access changes while Stripe responds.

Generic client writes cannot assign account IDs. The retired public and internal
setters remain explicit rejection endpoints so an old caller cannot bypass the
verified protocol. No generated Convex files were hand-edited; existing generated
module/schema imports expose the added functions and field types.

## Client entry, return, and activation gate

The operator selects a client in `/admin/platform` and shares the stable hub URL
`/portal/stripe/<client-site-hostname>`. Account IDs are labeled **setup started**,
not connected/ready. The copy control is unavailable while setup is disabled.
Never distribute a temporary Stripe Account Link as an invitation.

Clients use their existing website-admin login on that hub page. The page reuses
Better Auth and the shared login component; it does not grant access to the
creator's `/admin` shell. Convex checks the exact tenant's stored admin identity
(or the verified invited email during the existing identity-claim transition).
Creators can assist. Every begin/bind mutation rechecks membership and requires
the hub-only secret; tenant administrators cannot write provider results directly.
Retained site aliases resolve to the same client. No browser value supplies the
Stripe account, email, platform origin, or return destination.

The same-origin `start` form creates/resumes the durable attempt and redirects
the authenticated holder directly to Stripe. Account Link refresh authenticates
again, verifies the stored account, and issues a private, non-cacheable redirect.
An expired refresh session returns to the same stable sign-in page. Refresh
never creates an account. The callback redirects to that page with a display
marker only; page loads and return visits never create accounts or Account Links.

With setup enabled, an authorized page load reads the account afresh from Stripe,
verifies its ownership, controller settings, platform, and test/live mode, and
stores and shows payments and payouts separately. States distinguish information
still due, pending verification, restrictions, and both payments/payouts enabled.
The page reads committed status after the provider check and reauthorizes tenant
membership; it never displays a discarded concurrent response. Checking,
unavailable, and disconnected states contain no usable readiness flags or
start/resume action. They retain a retry link and access to the client's full
Stripe dashboard. A disconnected connection needs operator review; refreshing
cannot reconnect it. Provider errors are generic. New-sale gates remain C4 work.
**Stripe readiness alone does not activate the store.**

`STRIPE_CONNECT_ONBOARDING_ENABLED` is a server-only activation switch. Only the
exact value `true` permits account creation, link issuance, or client-page provider reads.
Unset/false values keep the feature unavailable, including the JSON onboarding
endpoint and refresh endpoint. Start POSTs also require the hub request origin.
Do not enable this flag as part of source merges. First deploy/adopt compatible
backend code, finish readiness/checkout/supplier work, and run separately approved
sandbox acceptance. No environment configuration is changed by this slice.

## Stored status protocol

The optional `platformClients.stripeConnectStatus` field belongs to the current
verified account. Its state is one of `checking`, `observed`, `unavailable`, or
`disconnected`. Only an observed state contains charges/payouts/details flags and
the four provider readiness states. Pending and failed checks cannot retain a
usable ready snapshot. Timestamps come from Convex, not an event or browser.

- `getStripeConnectStatus` requires exact tenant/creator membership, verifies
  current immutable binding/attempt integrity, and omits the pending refresh
  token from its response. Missing status is unknown, never ready.
- `beginStripeConnectStatusRefresh` requires the hub-only secret and exact
  client/account/platform/mode binding. It replaces a pending claim with a fresh
  server-issued token. A disconnected account cannot begin another refresh.
- `finishStripeConnectStatusRefresh` rechecks binding and accepts only the latest
  pending token, less than 60 seconds old. A stale/expired/replayed result returns
  `applied: false`. A successful result must agree with its payment/payout flags;
  provider or account-verification failures become explicit unavailable states.
- `markStripeConnectDisconnected` requires the same hub authority and verified
  binding. It retains a bounded signed-event identifier, invalidates pending
  work, and preserves account ownership/history. Repeated disconnection is a
  no-op. Begin/bind account creation cannot clear this state or silently reconnect.

Status refresh is safe to repeat because it retrieves current facts; event
creation timestamps and delivery order are not version authority. Only the
current pending claim may commit. An obsolete successful read is discarded even
when a newer read fails; the connection then remains unavailable until retry.
There is no background worker or automatic timeout retry in this storage layer.
An abandoned claim remains checking until the next authorized refresh.

## Page and signed webhook producers

`stripeConnectStatusSync.ts` claims before all provider reads, including platform
and mode verification. Stripe reads and link issuance use 10-second timeouts with
SDK retries disabled; parallel platform/mode reads precede the account read, within
the 60-second claim window. Database write failures propagate. Provider failures
replace usable readiness with unavailable; ownership/controller/environment
mismatches are recorded separately from transient provider failures.

The existing commerce webhook handles `account.updated`, `capability.updated`,
and `account.application.deauthorized` after signature, pinned API-version, and
destination-role checks, before order/email/supplier adapters initialize. These
events are independent of the order-producer gate. Only the current verified
account binding and matching test/live mode can change status. Unknown,
history-only, or unmanaged connections are acknowledged without provider work.

Updates retrieve current provider facts rather than trusting event snapshots or
event timestamps. A current failed provider check is persisted, then returns 502
for Stripe retry; a superseded result is acknowledged. Account mismatches remain
unavailable for operator investigation. Deauthorization uses the signed top-level
`event.account`, not the application object ID, and never attempts to retrieve an
account whose API access may be gone. The terminal marker prevents later updates
or in-flight reads from reviving a disconnected connection.

Source delivery does not configure webhook event subscriptions or activate the
backend/provider integration. Keep the onboarding switch off through coordinated
backend adoption and acceptance. Lifecycle processing applies only to accounts
bound by the verified protocol; it remains available after onboarding is disabled
so existing connections can still be restricted or disconnected. C4 must enforce
verified fresh readiness and remove platform-charge fallback before client sales.

## Historical payment identity

A verified binding also writes one immutable `stripeAccountBindings` record in
the same transaction. It pins the owning client/tenant, creation attempt, Stripe
platform account, and test/live mode. Repeated binding preserves that record;
removing or changing the client's active selection cannot free the account for
another tenant. No account replacement or offboarding endpoint is added here.

Account-scoped webhook routing, order replay, accepted Checkout binding, and
manual/automated refund reconciliation resolve that historical owner. Delayed
provider requests keep the account stored on the payment or signed event, even
when the returned client's current checkout selection differs. Missing owners,
duplicate ownership rows, tenant drift, and conflicting current assignments fail
closed. Existing active mappings without a history record remain readable;
verified onboarding writes the record when binding is next confirmed. This is
not an account migration or a way to adopt unverified accounts.

New connected-account Checkout reservations and admissions require the currently selected account.
Exact existing attempts can replay and previously reserved sessions can finish
binding in their original account. Historical ownership is not new-sale admission.
The separate platform-charge fallback/readiness policy remains C4 work.
Original order/refund records are not rewritten. Provider deauthorization can
still remove API access; retaining identity does not grant access or implement a
new dispute processor. Reconnect/offboarding procedures remain later work.

Deploy the ownership reader and writer together in the shared backend before any
future operation can remove/change an active mapping. Retain ownership records
on rollback; old readers cannot recover detached-account history. Source/host
integration does not itself activate this backend or authorize live changes.

## Uncertainty and recovery

If Stripe succeeds and binding fails, a retry within the window repeats the
same frozen request/key. If the link fails after binding, a retry retrieves the
saved account. After the window expires without a binding, onboarding stops for
operator reconciliation. There is intentionally no automatic reset or account
replacement. Inspect provider evidence before designing any recovery action;
do not clear the attempt, delete accounts, or re-run creation with a fresh key.

The owner confirmed there are no existing Express connections. This work has no
Express migration or compatibility flow. Unexpected pre-existing account IDs
without the recorded protocol are rejected rather than adopted automatically.

## Adoption and verification

Source changes alone do not activate new accounts. Keep the activation switch
unset/false through coordinated backend-first deployment and compatible hub
adoption: an old host creates its Express account before invoking its now
retired assignment mutation. Leave onboarding unavailable through the transition
and until the remaining client workflow has passed acceptance. Rollback must
preserve attempt/account records and keep old raw-assignment hosts disabled.

Tests cover concurrent starts/binds, frozen retries, failed persistence/link
creation, expired uncertainty, mismatched tenant/controller/environment,
duplicate account ownership, hub+tenant/creator authorization, request validation, and
retired assignment bypasses. Provider behavior is simulated locally. Actual
Stripe account settings, hosted screens, webhooks, and payments still need
separately authorized sandbox/live verification before production acceptance.

References: [Stripe controller mappings](https://docs.stripe.com/connect/migrate-to-controller-properties),
[idempotency retention](https://docs.stripe.com/api/idempotent_requests), and
[hosted account onboarding](https://docs.stripe.com/connect/hosted-onboarding).
