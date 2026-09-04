# Tenant identity contract

This staged migration replaces mutable public domains as permanent routing
identity without rewriting historical tenant data in one release.

## Stage A widening

- `platformClients.tenantId` is an opaque, immutable identifier. It is optional
  only while pre-existing rows are being widened.
- `tenantAliases` maps normalized, verified domains and HTTPS origins to that
  identifier. Alias possession is not authorization.
- `resolveTenantContext` is the only module that knows how to resolve an opaque
  ID, an alias, or the bounded legacy `siteUrl` fallback.
- Existing `siteUrl` reads and indexes remain authoritative for existing
  operational records until later adoption and parity gates pass.
- New client creation, operator seeding, and domain changes register identity
  and aliases transactionally.

## Ordered rollout

1. Deploy the additive schema and functions while all readers still accept
   `siteUrl`.
2. Widen each existing platform client with the internal idempotent mutation:

   ```bash
   pnpm exec convex run --prod platform:backfillTenantIdentity \
     '{"siteUrl":"angelsrest.online"}'
   ```

3. Re-run the command. It must report the same `tenantId`,
   `identityAdded: false`, and `aliasesAdded: 0`.
4. Repeat for every intended platform client before Stage B adopts tenant IDs at
   Stripe, checkout, gallery, Admin, or webhook boundaries.

The mutation fails on an unknown site or an alias already verified for another
tenant. Those failures require reconciliation; do not bypass them by editing a
tenant ID.

## Rollback boundary

Stage A is additive. Previous application code ignores the new field and table,
so application rollback does not require deleting tenant identities or aliases.
Do not narrow the optional field, remove `siteUrl` indexes, or rewrite R2 keys in
this stage. Alias removal and domain-control retirement require a separate,
explicit operator path before a former domain can be reassigned.

## Stage A production checkpoint — 2026-09-03

Merged source `1c08b3a` was deployed to the production `angelsrest-crm`
deployment after a dry run showed only the three intended index additions and
no deletions. The owner scoped the data migration to `angelsrest.online`; the
first backfill added its identity and four aliases, and an immediate replay
returned the same identity with no changes. A read-only verification confirmed
that `zippymiggy.com` remained unwidened and untouched.

Stage B must therefore adopt opaque identity only where the resolved Angels Rest
tenant ID is present. Existing `siteUrl` behavior remains the compatibility path
for tenants outside this approved migration scope.

## Stage B1 — Stripe identity adoption

New Angels Rest Checkout Sessions and PaymentIntents carry both
`commerceTenantId` and `commerceTenantSiteUrl`. Webhook resolution compares the
opaque identity with the compatibility domain and fails closed on disagreement.
Unclaimed tenants continue emitting only `commerceTenantSiteUrl`.

## Stage B2 — durable checkout widening

Checkout snapshot reservations and Session admissions may retain an optional
tenant ID beside `siteUrl`. Private protocol parsers accept both the old request
shape and the additive identified shape. An ID is accepted only when it and the
site reference resolve to the same tenant; omission preserves the old protocol
for unclaimed tenants. Host adoption follows only after this backend widening
is deployed.

After the widening is live, the checkout host copies the optional ID from its
server-resolved Stripe tenant bundle into reservation and admission messages.
The browser cannot supply or override it. Hosts whose resolved tenant has no ID
continue sending the exact legacy request shape; this intentionally leaves
`zippymiggy.com` on its existing `siteUrl` compatibility path.

## Stage B3 — order and provider-command adoption

New orders retain the optional tenant ID resolved by the trusted webhook host
and reconcile it with any bound checkout admission or snapshot reservation.
Stripe routing lookups compare a supplied metadata ID with both the compatibility
site and any stored ID. Current print-provider state commands likewise compare
the host's optional ID with the order before crossing their durable fences.

These comparisons supplement authorization; they do not replace the webhook
secret, signed Stripe event, or provider evidence. The ID is not added to the
LumaPrints request and no R2 key changes. A missing ID remains a true legacy
omission. A present malformed or contradictory ID fails before order replay or
provider effects.

## Angels Rest Stage C checkpoint — 2026-09-03

The approved migration scope is `angelsrest.online` only. A read-only production
inventory after Stage B3 found:

| Surface | Angels Rest result | Required action |
|---|---:|---|
| Platform identity | claimed; four verified domain/origin aliases | none |
| Stable Admin identities | one | email fallback is inactive |
| Orders | zero | no backfill |
| Checkout admissions | zero | no backfill |
| Checkout snapshot reservations | zero | no backfill |

Creating an idempotent row migration for empty tables would add unused authority
and rollback surface, so no migration was introduced. The dual-field shape is
the terminal mixed-scope contract for now: `tenantId` is authoritative when
present and verified, while `siteUrl` remains required for existing indexes and
the explicitly deferred unclaimed tenant.

`zippymiggy.com` is outside this checkpoint. It remains unclaimed and must not be
widened, backfilled, or narrowed without a separate owner-approved rollout. The
signed spoke-to-hub bridge therefore remains on the compatibility contract until
an approved claimed spoke exists; this does not reopen the completed Angels Rest
adoption.
