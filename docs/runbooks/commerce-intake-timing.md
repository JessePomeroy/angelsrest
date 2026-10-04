# Commerce intake timing and recovery targets

These internal acceptance targets guide the completed-commerce-checkout inbox
work. Invoice payments, refunds and account lifecycle events retain their current
handling. Public sales activation and client service commitments remain separate
decisions under the client readiness gate.

## Baseline and measurement scope

At source `051e6680c6b35c338301093912d53424fee3645e`, the commerce webhook waits for
signature verification, account-scope checks, lifecycle/replay handling and the
entire `processStripeWebhookEvent` call before returning HTTP 200. The host allows
120 seconds. Existing `webhook.processed` and `webhook.failed` timers cover only
the intake function. A failed intake is timed before its awaited generic failure
alert. Those fields cannot establish complete handler latency.

The October 4, 2026 UTC read-only Vercel discovery queried this hub project and team,
production, all branches, `/api/webhooks/stripe`, the previous 24 hours and a
100-result bound. The command returned no JSON rows. Retention/filter coverage is
not established; no production latency percentile, retry rate or no-traffic claim
can be inferred. No raw provider logs or customer records were retained.

The route now emits one `webhook.commerce_response` event on normal return or
exception. Its monotonic `durationMs` includes verification and every awaited
handler step, including early replay/lifecycle exits. It ends before telemetry
emission and SvelteKit/provider response transmission; external delivery latency
still needs the provider's request timing. Hard process termination can prevent
the final log and must be counted from provider timeout/error records separately.

The closed metric fields are:

| Field | Meaning |
| --- | --- |
| `metricVersion` | `1` |
| `phase` | Last entered phase: configuration, verification, scope, lifecycle, admission or intake |
| `category` | Commerce/invoice/other checkout, payment failure, refund, account lifecycle, other or unverified |
| `destination` | Verified Your-account/connected-accounts destination, or unverified |
| `mode` | Live, test or unknown from the verified event |
| `status` | Handler response status, original HTTP-error status or 500 for another exception |

This event contains no event/session/account IDs, tenant, customer fields, body,
metadata, signature, credentials, provider URL or error text. The original error
and response are preserved if timing telemetry fails. Existing intake failure
events additionally expose `retryCause` from known error classes:

| Cause | Retry boundary |
| --- | --- |
| `checkout_snapshot` | Trusted routing, admission or snapshot validation |
| `order_receipt`, `payment_failure_email` | Durable email/receipt handling |
| `print_reconciliation_alert`, `print_reconciliation_pending` | Existing provider evidence or alert recovery |
| `provider_submission_closed` | Explicit provider submission control |
| `automated_refund`, `automated_refund_notification` | Existing refund or notification recovery |
| `manual_refund_reconciliation`, `client_refund_evidence`, `client_refund` | Existing refund event paths, outside the checkout inbox rollout |
| `unclassified` | Existing generic failure-alert path |

These categories describe failed processing attempts, not unique Stripe events or
proof that another effect is safe. Preserve every existing idempotency, receipt,
refund and provider-uncertainty fence.

## Controlled baseline

The route regression holds verification for 250 ms and intake for another 1,250 ms
on a controlled clock. It verifies that no response metric appears before intake
finishes and that the final handler metric is 1,500 ms. Separate cases exercise a
503 admission rejection, an acknowledged replay and a failing telemetry sink.
Existing real Convex intake and signed-refund fixtures preserve receipt ordering,
reconciliation and duplicate-effect guarantees with outbound networking disabled.

This is a causal fixture baseline: acknowledgement currently waits for intake.
It is not a measurement of Stripe, Convex, Resend or LumaPrints production latency.
The initial deployed distribution remains pending a representative sample.

## Acceptance targets for the background path

| Measure | Internal target | Required evidence |
| --- | --- | --- |
| Verified commerce acknowledgement | Handler p95 ≤ 1 s, p99 ≤ 3 s | At least 100 attempts per mode/destination; report count, time window and provider timeouts separately |
| Durable acceptance → first worker claim | p95 ≤ 10 s, p99 ≤ 30 s | Inbox acceptance and first-claim timestamps under healthy dependencies |
| Durable acceptance → recorded order | p95 ≤ 30 s, p99 ≤ 120 s | Exact accepted event and order checkpoint; print completion is measured separately |
| Worker crash → another eligible attempt | ≤ 5 min | Controlled lease expiry/watchdog test and an authorized staging observation |
| Exhaustion or ambiguous effect | Visible blocked state at its terminal checkpoint | Operator query and recovery tests; no blind provider reissue |
| Persistence failure | No successful acknowledgement | Transaction-failure test proving Stripe can retry |

Do not combine successful requests with rejected signatures, intentionally closed
intake, different destinations/modes, or unrelated webhook categories. Keep failed
and timed-out attempts visible beside success percentiles; below 100 samples,
report individual bounded results and mark percentile acceptance incomplete.

Stripe recommends prompt acknowledgement and asynchronous work, and retries failed
live deliveries for up to three days. The inbox must own recovery after a successful
acknowledgement. [Stripe webhook guidance](https://docs.stripe.com/webhooks).
Convex scheduling from a mutation commits with that transaction, allowing durable
acceptance and its initial dispatch to be atomic.
[Convex scheduled functions](https://docs.convex.dev/scheduling/scheduled-functions).

Before activation, verify the staging failure matrix, queue draining and independent
host rollback. Keep the additive backend whenever accepted work depends on it.
Do not change webhook destinations, credentials, event scope or live processing
mode solely to collect timing samples.
