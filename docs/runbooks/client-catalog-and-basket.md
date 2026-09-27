# Client catalog and basket activation

The client site owns published content presentation and browser selection. The hub
owns payment execution, frozen catalog admission, orders and fulfillment. A source
merge is not activation or deployment evidence.

## Private catalog uploads

1. Deploy additive Convex and CMS Worker support for
   `CATALOG_PRIVATE_EDITOR_TENANT_ORIGINS`. Use an explicit JSON object mapping each
   tenant domain to its exact canonical HTTPS origin (domain or `www`). Include all
   admitted sites. An absent registry retains Angels Rest only; malformed or empty
   configuration denies all sites.
2. Configure distinct tenant credentials in the existing host-journal, Worker-control,
   storage-caller, inspection-caller and receipt-producer registries. Client hosts hold
   only their own host-journal and storage-caller roles; never broad platform secrets.
3. Schedule that tenant's inspections with its own dispatcher credentials. The existing
   single-tenant Angels Rest dispatcher cannot process another tenant's queue.
4. Publish/adopt the tenant-capable Admin package, then mount its prepare/complete
   factories with stored membership authorization. Complete needs Node 24 and a
   60-second host timeout. Enable the product upload controls only after adoption.
5. Verify prepare → upload → storage → inspection → verified asset → publish using
   designated test files. Confirm foreign origin, token, membership and bearer denial.

Convex freezes the declaration and origin at reservation. Replays preserve those
facts. Worker origin changes intentionally revoke outstanding capabilities; drain or
abandon pending operations before changing the registry rather than rewriting a row.

## Signed multi-item checkout

`POST /api/tenant-checkout/cart` is additive; `/print` retains Reflecting Pool's
existing single-item contract. Configure the tenant's unique signing credential,
allowed redirect origins, `handle-v2`, admission controls, Stripe readiness and
fulfillment policy before enabling any spoke checkout.

The signed JSON body has exactly `siteUrl`, `attempt` (UUID v4),
`attemptStartedAt` (milliseconds), `successUrl`, `cancelUrl`, and `items`.
Each of 1–40 lines contains `selection`, `quantity` (1–20), `unitAmountCents`,
`name`, and `imageUrl` (HTTPS string or null). Selection uses the existing snapshot
keys: product/revision/kind/variant/material/size/border/frame. The spoke must resolve
these from its own published catalog; browser prices and tenant identity are never
authority. Frozen financial admission remains the hub's final check.

Sign `<timestamp>.<exact JSON bytes>` with HMAC SHA-256 and send the existing
`x-checkout-bridge-signature` and `x-checkout-bridge-timestamp` headers. The route
bounds bytes before parsing, authenticates before tenant/Stripe lookup, verifies
redirects and purpose controls, then uses the existing reservation/admission pipeline.
Unit and total amounts cannot exceed 99,999,999 cents. Shipping is currently US-only;
verify the client's shipping policy before activation.

Keep the same attempt across network ambiguity. A cart 409 with
`code: CHECKOUT_NEW_ATTEMPT_ALLOWED` means durable admission proved no Stripe
session was created; only this outcome permits an explicit new-attempt action.
Generic conflicts, release timeouts, Stripe uncertainty and binding failures do not.
The response returns the existing session ID, payment URL and platform fee; the spoke
exposes only a validated Stripe payment URL. Success redirects do not prove payment;
webhooks and hub order records remain authoritative.
