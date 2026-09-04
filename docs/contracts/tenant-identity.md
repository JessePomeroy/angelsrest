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
