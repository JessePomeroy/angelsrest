# Invoice payment sandbox acceptance — September 27, 2026

The invoice revision flow passed actual hosted Stripe Checkout, original signed
webhook delivery, persisted Convex receipts, and reloaded admin/customer views.
This is sandbox acceptance, not a live-money or historical-record reconciliation.

## Scope and provenance

- Runtime base: `60ae085066b1e74176199e146c5b1cfa6865d737`.
- Installed Admin: 6.4.0; CRM API: 6.2.0; Stripe SDK: 20.3.1.
- Dedicated Stripe sandbox: `Angels Rest Invoice Verification`, account
  `acct_1UKLSCEk5fWun4Lz`. Live-account copying was disabled.
- Separate Convex dev deployment: `adjoining-iguana-707`, reference
  `thinkingofview:angelsrest-crm:dev/invoice-verification`, created with a four-day
  expiry under existing plan capacity.
- Local app: `http://127.0.0.1:5198`; synthetic administrator/customer and two
  invoices. The user signed into the real admin UI with the test account.
- Production invoice/auth code was unchanged. An isolated-worktree fixture
  bootstrapped synthetic data and queued original Stripe deliveries, with every
  fixture function guarded to the exact development deployment.

## Results

| Scenario | Observed result |
| --- | --- |
| Open $100 Checkout, edit invoice to $200, pay original session | Partial: $100 received and $100 due in both reloaded views |
| Redeliver that same provider event | Two HTTP 200 deliveries; one paid receipt and $100 received |
| Collect the remaining $100 | Paid: $200 received, zero remaining, exactly two unique receipts |
| Pay newer $200 Checkout, then older $100 Checkout | $300 received against $200 total; $100 overpayment warning in both views; no further collection button |

Stripe reported four complete/paid Checkout sessions, four successful test
charges, and zero refunded cents. Five original signed deliveries, including
the replay, returned HTTP 200 from the local commerce webhook. The original
issued item snapshot remained unchanged after invoice edits. No real funds,
application email, fulfillment, or automatic refunds were used.

The receiver rejected unsigned, invalid-signature, expired-signature, live-mode,
connected-account, and wrong-version requests. These were synthetic negative
boundary checks, separate from the four real provider sandbox payments.

## Delivery and verification constraints

The account's CLI listener used `2026-08-26.dahlia`; the app requires
`2026-01-28.clover`. A dedicated Stripe endpoint pinned the latter version. The
fixture forwarded the original body and Stripe-Signature unchanged to the local
handler. It did not rewrite events or loosen validation. Stripe's supported
`events resend` command exercised the actual duplicate-delivery case.

The initial forwarding driver acknowledged its first delivery successfully but
then stopped parsing an empty successful CLI response as JSON. The corrected
driver completed the replay and remaining deliveries. All five acknowledgements
and four paid receipts were read back from the backend.

The standard regression workflow passed three handler/ledger cases and six
browser cases across desktop Chromium, mobile Chromium, and mobile WebKit.
The full local baseline passed 2,846 hub tests, 27 protocol tests, six script
tests, lint, and Svelte check. The isolated Convex fixture passed its package
typecheck. The maintained skill and helper syntax were validated.

Private event/ledger JSON and native browser captures were retained with the
audit task. Credentials, bearer portal links, and production customer records
are not part of this repository. The earlier twelve local fixture PNGs are
not captures of the provider run.

The local app and forwarder were stopped. The specific test webhook endpoint
was disabled, and sandbox payment evidence was retained. The backend expires
automatically; a later run must verify or replace the isolated environment.

## Repeat and remaining coverage

Use the [project verification skill](../../.agents/skills/verify-angelsrest-invoices/SKILL.md)
and its environment guards. A previous pass does not verify a later release.
The public portal was observed in a separate tab sharing the browser session;
it uses the public token query, but no separate anonymous-context claim is made.

This run does not cover live funds, refund issuance, historical invoice repair,
Google OAuth, email delivery, connected-account acceptance, or Reflecting Pool.
Paper design comparison is tracked separately in the design handbook.
