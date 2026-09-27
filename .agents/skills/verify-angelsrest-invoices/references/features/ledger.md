# Revision and receipt ledger

Driver: `src/lib/server/__tests__/invoicePaymentJourney.test.ts`, included in the
normal hub Vitest suite. Run the command in SKILL.md; it needs no server or account.

The fixture seeds one in-memory hub tenant and synthetic customer. Admin identity
is supplied by convex-test; it does not prove Better Auth sign-in. The test invokes
the real HTTP handler functions with Requests, not a running SvelteKit router.
Convex HTTP calls execute the real schema and function references in convex-test.
The real Stripe SDK serializes checkout creation and verifies webhook signatures;
only its HTTP response transport is replaced. Email calls fail the test.

Scenarios:

1. Create and mark a $100 invoice sent, create its share token, then start Checkout
   through the route. Revise the invoice to $200 through its admin mutation.
   Deliver the signed original $100 completion twice. Admin and public portal
   queries must both show a partial invoice with $100 received. A fresh checkout
   must request only $100, using the remaining-balance line. Deliver it twice:
   both views must show paid with $200 received and exactly two paid ledger rows.
   The first checkout's issued item remains $100.
2. Start $100 and revised $200 checkouts, settle the newer one first, then settle
   and replay the older one. Both views must retain $300 received against $200
   total; the balance helper reports $100 overpaid and zero due.
3. Send a completion with an incorrect signing secret. The real webhook handler
   must reject it with 400 and leave the invoice sent with no credit.

Amounts in backend/provider payloads are integer cents. These assertions cover
cross-module contracts and persisted in-memory records, not provider settlement,
cloud database durability, frontend routing, or delivery retries from Stripe.
Each case owns a fresh database and restores mocked transports/environment values.
