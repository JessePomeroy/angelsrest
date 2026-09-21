# Client Stripe onboarding

This records the account-creation foundation. Client-facing onboarding,
account-status webhooks, checkout readiness gates, existing-account connection,
and per-client supplier routing are subsequent work. The existing operator UI
still starts onboarding and still uses account existence for its connected
label. Returning from Stripe is not evidence that a client can accept payments.

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
3. `platform.beginStripeConnectAccount` requires creator membership and the
   hub-only server secret. It freezes an attempt UUID, start time, email, site,
   model version, platform account, and mode on the client. Concurrent requests
   receive the same attempt. Profile edits cannot change its provider payload.
4. Create the account with a stable attempt-derived idempotency key. Reject new
   creation after 23 hours of uncertainty; never rotate the key to bypass an
   uncertain provider result. A small cross-host clock difference is tolerated
   inside the conservative window. A bound account can be retrieved later.
5. Verify the returned account's controller settings and client, immutable tenant,
   and attempt metadata. The account must differ from the platform account.
6. `platform.bindStripeConnectAccount` requires both creator membership and hub
   authority, checks the exact attempt/environment, and atomically prevents
   account replacement and cross-client duplicate binding. Return an onboarding
   link only after binding succeeds. Identical bindings are idempotent.
7. Before issuing a refresh link, verify the stored account and environment
   again. Refresh cannot create an account. The response includes provider-derived
   readiness facts, but those facts are not yet a synchronized dashboard state.

Generic client writes cannot assign account IDs. The retired public and internal
setters remain explicit rejection endpoints so an old caller cannot bypass the
verified protocol. No generated Convex files were hand-edited; existing generated
module/schema imports expose the added functions and field types.

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

Source changes alone do not activate new accounts. Disable access to the old
onboarding endpoint before coordinated backend-first deployment and compatible
hub adoption: an old host creates its Express account before invoking its now
retired assignment mutation. Leave onboarding unavailable through the transition
and until the remaining client workflow has passed acceptance. Rollback must
preserve attempt/account records and keep old raw-assignment hosts disabled.

Tests cover concurrent starts/binds, frozen retries, failed persistence/link
creation, expired uncertainty, mismatched tenant/controller/environment,
duplicate account ownership, hub+creator authorization, request validation, and
retired assignment bypasses. Provider behavior is simulated locally. Actual
Stripe account settings, hosted screens, webhooks, and payments still need
separately authorized sandbox/live verification before production acceptance.

References: [Stripe controller mappings](https://docs.stripe.com/connect/migrate-to-controller-properties),
[idempotency retention](https://docs.stripe.com/api/idempotent_requests), and
[hosted account onboarding](https://docs.stripe.com/connect/standard-accounts).
