# Architecture retrofit production verification — 2026-09-03

Status: AR-FINAL verification complete; canonical roadmap seal awaits the
owner's final acceptance.

This record closes the production-verification portion of the AR-01–AR-08
retrofit. It does not authorize a new payment, provider effect, capability-link
creation, credential rotation, archive deletion, or cleanup of unrelated local
worktrees.

## Release evidence

| Surface | Verified reference |
|---|---|
| Reviewed source | `main` at `7bdb555a5d5549c477c6b17a629983d972d82d1e` (AR-08 Angels Rest closure, PR #502) |
| Production host | Vercel `dpl_FE4bCo8XT8NZvY33ZwbA3KDKPFeS`, `READY`, serving both Angels Rest aliases |
| Production backend | Convex `prod:loyal-swan-967`, deployed after a no-deletion dry run |
| Rollback boundary | Host `13de2f1` / backend `1c29dc6`; the preceding compatible host and backend remain valid mixed-version rollback points |

The complete repository gates passed from the reviewed source: Biome, Svelte
check, 1,646 unit/integration tests, seven protocol tests, the package consumer
contract, the print-catalog check and 13 tests, and the CRM API TypeScript check.

## Production smoke evidence

- `/`, `/gallery`, `/shop`, `/blog`, `/about`, and `/admin` returned HTTP 200.
- A published portfolio gallery, Shop product, and Blog post each returned HTTP
  200 with an SSR heading. Four sampled public media derivatives returned HTTP
  200 as `image/webp`.
- The owner had already verified the repaired Better Auth claim by signing out
  and back in and observing the Admin dashboard render immediately. This final
  run also verified the unauthenticated Admin shell and security headers without
  attempting to reuse or export the owner's browser session.
- Deliberately invalid delivery-gallery and document-portal capabilities
  returned HTTP 404. No live bearer capability was copied into a command or
  provider log. The focused projection, no-store, tenant, and token lifecycle
  tests cover the retained valid-link contracts; the owner also confirmed a
  production delivery-gallery download during this release window.
- An invalid checkout preflight returned the documented HTTP 503 admission
  response. Production new-order admission remains closed, so no Checkout
  Session, order, payment, fulfillment, or provider effect was created.

The two-hour Vercel observation contained no HTTP 5xx responses. The 24-hour
query contained no `commerce.tenant_identity_mismatch` event. Error-level
entries were expected 404 probes, including the deliberate invalid capability
check above. The Stripe CLI's live credential required reauthentication, so no
claim is made that this run inspected the Stripe dashboard. That does not hide
an active sale: production order, checkout-admission, and checkout-reservation
tables were empty, checkout admission was closed, and connected-commerce
activation remains a separately documented gate.

The shared browser navigated production successfully, but its snapshot capture
failed twice. Consequently this record claims HTTP, SSR, media, contract, and
owner-observed verification—not a fresh automated visual comparison.

## Explicit compatibility outcomes

- `tenantId` remains optional at the mixed-scope boundary. Angels Rest is
  claimed and adopted; `zippymiggy.com` remains deliberately unclaimed and
  unchanged.
- Existing R2 keys, domain indexes, the signed spoke compatibility shape, and
  low-risk historical domain fields remain unchanged.
- `CHECKOUT_SNAPSHOT_MODE`, the new-order admission control, older authenticated
  print protocols, provenance labels, and empty generated-API compatibility
  stubs remain for the reasons recorded in the active architecture and security
  runbook. None is an undocumented temporary flag.
- The accepted encrypted Sanity recovery baseline and archived Studio source
  remain retained evidence. Sanity is not a live application dependency.
- The AR release worktree was clean before this record. Pre-existing alternate
  homepage and historical local worktrees were inventoried and preserved; no
  user work or archive was deleted to manufacture a globally clean worktree
  list.

## Deferred boundary

The successor roadmap owns Zippy/Reflecting Pool identity adoption and later
global narrowing, connected-commerce activation, purpose-credential rotation,
legacy-protocol retirement, generated-stub retirement, held provider cleanup,
and optional local worktree/archive reconciliation. Cryptographic attestation
remains deferred unless distribution or regulatory conditions change.

The canonical roadmap may be marked complete and sealed only after the owner
accepts this production behavior and the exact deferred boundary.
