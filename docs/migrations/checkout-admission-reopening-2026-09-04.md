# Checkout admission reopening — 2026-09-04

Status: complete for `angelsrest.online`; `zippymiggy.com` was not changed.

This record closes deferred follow-up DF-04. It records a bounded production
reopening, not a live purchase or a connected-commerce activation.

## Reopening sequence

- The Angels Rest host, backend admission, and provider-submission controls
  began closed at generation 4. The existing Zippy controls remained open at
  generation 1 throughout this work.
- The backend controls were advanced first to open generation 5, followed by
  the matching host control and production deployment.
- The first non-creating `{}` checkout preflight failed closed before Stripe.
  It created no checkout admission, snapshot reservation, order, payment, or
  fulfillment effect.
- The existing Angels Rest reservation-secret registry and its fingerprint
  manifest were aligned from Convex production to the host without printing or
  rotating either credential. The signed Zippy bridge registry was not read or
  changed.
- The preflight then exposed a source defect: reservation credentials are keyed
  by canonical tenant hostname, while the same-origin route supplied the full
  public URL. The host now applies the existing commerce-tenant normalizer at
  that lookup boundary.

## Verification evidence

| Surface | Result |
|---|---|
| Host deployment | Vercel `dpl_D1wLiG23TsWVH96kRW16Fzz9pocV`, `READY`, serving both Angels Rest aliases |
| Backend | Convex `prod:loyal-swan-967`; Angels Rest admission and provider controls open at generation 5 |
| Bounded preflight | HTTP 428 `CHECKOUT_ATTEMPT_REQUIRED`; the three challenge fields were present and their values were not retained |
| Durable effects | `checkoutSessionAdmissions`, `checkoutSnapshotReservations`, and `orders` remained empty |
| Telemetry | No `checkout.failed` event followed the successful final preflight |
| Focused source check | Seven checkout-role configuration tests and Biome passed |

The preflight stopped before Stripe initialization and therefore did not create
or inspect a Checkout Session. The first actual customer purchase remains the
bounded live observation point for Stripe, order intake, email, and fulfillment
telemetry.

## Rollback boundary

Control generations are monotonic and must never be reused. To stop new orders,
advance Angels Rest host, backend admission, and provider-submission controls
to **closed generation 6 or later**, backend first. Do that before rolling the
host back to a revision without the canonical lookup fix; the prior host build
cannot serve open generation 5 checkout successfully. Leave the Zippy generation
1 entries unchanged.

DF-03 credential inventory and rotation remains deferred. This reopening did
not treat configuration alignment as a rotation and did not revoke any
credential.
