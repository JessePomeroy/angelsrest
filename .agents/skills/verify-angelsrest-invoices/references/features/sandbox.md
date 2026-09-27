# Stripe sandbox acceptance — verified 2026-09-27

Recommended target: a dedicated Stripe sandbox, a separate Convex **cloud development**
deployment, and a local Angels Rest app on an unused port. The cloud dev backend
matches the current auth provisioning helper's HTTPS issuer requirement. The local
app and Stripe CLI avoid needing a public preview deployment for webhook delivery.
Use only synthetic clients/invoices. Keep email and unrelated fulfillment disabled.

[Stripe recommends separate sandbox environments](https://docs.stripe.com/sandboxes)
for isolated testing. [Convex development deployments](https://docs.convex.dev/cli/local-deployments)
are distinct from production; nevertheless verify the actual deployment identity.

## Establish the target before writes

Record the approved app origin, Convex deployment name and public API/site URLs,
Stripe sandbox account, installed package versions, synthetic admin identity, and
where private test configuration is managed. Verify the app's effective Convex
URLs point to that development backend. Do not copy production records or secrets.

Check Stripe CLI help/version and active login context. A read-only `/v1/balance`
request must report `livemode: false`; discard amounts and retain only the mode
result. This proves test-mode access, not that the context is a dedicated sandbox
or that the app uses the same account. Match the app's test key/account separately.
In installed CLI 1.45.0, `login list`'s active profile is not necessarily a legacy
`--project-name`: blindly passing the displayed name failed even though default
test API access worked. Do not switch the user's global context silently.

## Recorded environment (2026-09-27)

The user approved provisioning within existing plan capacity. Created:

- Stripe sandbox **Angels Rest Invoice Verification**, account
  `acct_1UKLSCEk5fWun4Lz`; no live-account configuration copied. A dedicated CLI
  config authenticated to this account, and `/v1/balance` returned `livemode: false`.
  The user's default CLI config was preserved.
- Convex `thinkingofview:angelsrest-crm:dev/invoice-verification`, physical deployment
  `adjoining-iguana-707`, URLs `https://adjoining-iguana-707.convex.cloud` and
  `https://adjoining-iguana-707.convex.site`. Created with `--expiration 'in 4 days'`.
  A seven-day request was rejected by the plan's five-day maximum before creation.
- Detached runtime worktree at `60ae085066b1e74176199e146c5b1cfa6865d737`, local app
  `http://127.0.0.1:5198`, actual admin route `/admin/invoicing`.
- Synthetic administrator `invoice-verification-admin@example.invalid`, created
  through the existing provisioning helper with a generated credential. No public
  signup or Google OAuth was enabled. Actual password sign-in returned HTTP 200.
- Synthetic customer created through the authenticated admin mutation endpoint.
  The completed run created two invoices and four paid Checkout sessions.

Secrets remain in a mode-0700 run-private directory, with mode-0600 credential
files. Never include credentials or login cookies in evidence. The browser cannot
load local credential files: hand the login to the user when needed; do not route
around a browser security rejection. Google sign-in is not configured here.

## Prepare an isolated runtime

Use a detached worktree and `pnpm install --offline --frozen-lockfile --ignore-scripts`.
Run `pnpm exec svelte-kit sync` and the package's actual typecheck:
`pnpm --filter @jessepomeroy/crm-api exec tsc -p tsconfig.json --noEmit`.
The current package has `packages/crm-api/tsconfig.json`, not `convex/tsconfig.json`;
`convex dev --typecheck enable` aborts expecting the latter. After the package
check passes, deploy with `--once --typecheck disable` and a dedicated `--env-file`.
Unset ambient deploy/self-host keys and verify the printed target is the new dev
backend. Do not use production/default targeting.

The app needs its own public Convex URLs and origin, sandbox Stripe key, endpoint
signing secret, and matching backend WEBHOOK_SECRET. Generate distinct backend
BETTER_AUTH_SECRET and server-role secrets. Do not copy production configuration.
No email/fulfillment credentials are installed. A dummy Resend key permits client
construction; the [fetch fence](../../scripts/fetch-fence.mjs) blocks fetches beyond
this app, its two Convex origins, and Stripe. Invoice success does not send email.
The fence is a test-process guard, not an operating-system network sandbox.

An empty backend makes the root layout return 503 until published site settings
exist. The isolated fixture seeds synthetic settings and placeholder media metadata;
no object is uploaded to the shared media worker. This is not media-pipeline proof.

## Version-pinned provider delivery

The current handler requires event API version `2026-01-28.clover`. CLI 1.45.0
`listen` selected `2026-08-26.dahlia` in the new sandbox. Source inspection confirmed
`--use-configured-webhooks` loads paths/event types, not endpoint API versions.
Do not relax the handler's version check or rewrite/re-sign events.

Instead, the approved test backend hosts a guarded delivery queue. Its fixture
is [this patch](../../scripts/isolated-convex-fixture.patch), intended **only** for
the detached test worktree. Every fixture function checks the exact isolated
CONVEX_SITE_URL. Apply it there, regenerate Convex API types with the CLI, typecheck,
and deploy only to that target. The fixture is not production product code.
For a future replacement environment, explicitly review/update the guarded target
in the patch and scripts; never simply point the existing fixture at another backend.

The dedicated Stripe endpoint is `we_1UKLXvEk5fWun4LzU4R9Rdnv`, listening only for
`checkout.session.completed` at
`https://adjoining-iguana-707.convex.site/invoice-verification/stripe`, with
`api_version=2026-01-28.clover` and `livemode=false`. Its secret is installed as
INVOICE_VERIFICATION_WEBHOOK_SECRET on this dev backend and STRIPE_WEBHOOK_SECRET
in the local app. Stripe documents [endpoint version selection](https://docs.stripe.com/api/webhook_endpoints/create).

The receiver verifies the Stripe signature/timestamp, rejects live and connected
account events, requires the exact version and invoice metadata, then stores each
original body/signature. The [forwarder](../../scripts/forward-deliveries.py) uses
operator-authenticated internal queries to forward those bytes unchanged to
`/api/webhooks/stripe`, and records the handler's HTTP result. Copy the forwarder
and fence into a private run directory containing the `sandbox-app` worktree before
launching them. Run the forwarder while taking payments; signature tolerance is
five minutes. A stale delivery must be redelivered by Stripe, not re-signed locally.
A queue receipt is not settlement proof: require local handler HTTP 200 and ledger
readback. Stripe's real `events resend --webhook-endpoint ...` targets this endpoint.

Negative fixture checks rejected unsigned, invalid-signature, expired-signature,
live-mode, connected-account, and wrong-version requests with HTTP 400. These are
synthetic boundary checks, not proof of a real Checkout payment.

## Launch and health

Launch on an unused port with the private config and fetch fence:
`node --import /ABS/RUN/fetch-fence.mjs node_modules/vite/bin/vite.js dev --host 127.0.0.1 --port 5198 --strictPort`.
Record the exact app and forwarder PIDs. GET `/robots.txt` returned 200; actual
password authentication also returned 200. The user signed into the browser with the synthetic account; the full payment
journey then passed through actual admin controls and hosted Stripe Checkout.

## Drive and prove

Use actual admin controls and portal **Pay Now**. Do not call internal setters and
report a UI pass. Read current controls in the running UI before choosing selectors.

1. Create synthetic invoice A for $100, save as draft, then **mark as sent**
   without sending email. Copy its share link and open the customer portal in a
   separate tab. For this isolated local host, replace only the copied production
   origin with `http://127.0.0.1:5198`; the tenant key remains angelsrest.online in
   the isolated database. Never navigate the test token to production. Click
   **Pay Now**, keep that Checkout open, and revise the invoice through admin to
   $200. Decline the email resend prompt. The observed portal tab shared the
   browser session; the public portal query does not depend on admin cookies.
2. Complete the original $100 Checkout using [Stripe's documented test payment
   details](https://docs.stripe.com/testing). Confirm `livemode:false` and the amount
   with the Checkout page's `get_order_summary` tool when available. The observed
   run used test card 4242 4242 4242 4242, future expiration, synthetic name/address
   and an example.com email. Uncheck Link information saving. Use page-provided
   `select_payment_method`/`submit_payment` tools when advertised. Observe the actual completion event,
   successful webhook delivery, and stored checkout receipt. Reload admin and
   portal: both must show $100 received and $100 remaining.
3. Redeliver that **same actual event** through a supported Stripe test delivery
   mechanism for the configured destination. Record delivery acknowledgement and
   show that paid amount and receipt count did not increase. A generic generated
   `stripe trigger` event is not the invoice's event and cannot prove replay safety.
   The verified command was `stripe events resend EVENT_ID --webhook-endpoint
   we_1UKLXvEk5fWun4LzU4R9Rdnv --config /ABS/RUN/private/stripe.toml`. Its response
   describes the account-version event; the actual endpoint delivery retained the
   pinned clover version and passed the unchanged handler.
4. Start the remaining-balance checkout from the unchanged portal link. Its total
   must be $100. Complete it, wait for webhook settlement, reload both views, and
   verify $200 received, zero remaining, and two unique paid checkout receipts.
5. On separate invoice B, open a $100 checkout, revise to $200 and open its new
   checkout before paying either. Pay the $200 checkout first, then the older
   $100 checkout. Both views must show $300 received and $100 overpaid. No refund
   should be issued automatically and the portal must offer no further collection.

Record non-secret invoice/session/event IDs, expected/observed integer cent
amounts, webhook HTTP results, reload evidence, and screenshot paths. A success
redirect alone is not settlement proof. Keep credentials, full bearer URLs,
cookies, and unrelated account/customer records out of shareable evidence.

## Observed acceptance results

The portable acceptance summary is in
`docs/verification/invoice-payment-sandbox-2026-09-27.md` at the repository root.

- INV-001: opened $100 Checkout, edited to $200, paid the older session. Both
  freshly loaded views showed $100 received and $100 remaining; status partial.
- Redelivered the same actual Stripe event. Two successful deliveries left one
  paid receipt and $100 received. The original $100 item snapshot was unchanged.
- Paid a new $100 remaining-balance Checkout. Both views showed $200 received,
  zero remaining, status paid, with exactly two unique paid receipts.
- INV-002: opened $100 Checkout, edited to $200, opened the new Checkout and paid
  it first. The backend showed $200 received before the older session was paid.
  Paying that original $100 then produced $300 received and $100 overpaid. Both
  freshly loaded views showed the warning and offered no further collection.
- Four Stripe Checkout sessions were complete/paid, all four charges succeeded
  in test mode, five signed deliveries returned local-handler HTTP 200, and the
  provider reported zero refunded cents. No real funds, email, or fulfillment.

Evidence is in the task's `outputs/invoice-workflow`: `sandbox-replay.json`,
`sandbox-invoice-a-paid.json`, `sandbox-invoice-b-newer-paid.json`, `sandbox-final.json`,
`stripe-provider-results.json`, `relay-guard-results.json`, and `cleanup.json`.
Native browser captures of the actual partial/overpaid states were inspected in
conversation. The earlier twelve PNG artifacts are local fixture screenshots,
not screenshots from the provider run.

Driver corrections: the forwarder must accept empty stdout after a successful
void Convex mutation; its first acknowledgement succeeded but JSON decoding then
stopped the initial process. The corrected driver was restarted and delivered the
remaining events successfully. The in-app browser clipboard reader returned an
empty value despite a successful native copy; ordinary paste into a local search
field exposed the copied link, and keyboard select-all/backspace cleared it before
continuing. Use AX indices for visually lowercased invoice row labels; exact DOM
role names can retain capitalization. Screenshots verified email input that the
DOM snapshot omitted. These are driver limitations, not proven product defects.

## Cleanup and limits

Stop only the recorded local app/forwarder PIDs. After acceptance, disable the
specific test webhook endpoint (recoverable) before the backend expires. This run
disabled `we_1UKLXvEk5fWun4LzU4R9Rdnv` and stopped app PID 312900 and final forwarder
PID 331514; the earlier listener and forwarder were already stopped. Re-enable
the endpoint only after a later run has its intended backend and forwarder ready. Retain payment evidence in the
dedicated sandbox for review. Invoices with payment/checkout history are not
deletable through the app; do not bypass that invariant for cleanup. Expire only
unpaid sessions created in this run when appropriate. Any cloud deployment or
sandbox deletion requires an exact approved target; preserve shared resources.

Acceptance does not cover live funds, refunds, historical invoices, email,
Connect tenant payment readiness, or Reflecting Pool.
