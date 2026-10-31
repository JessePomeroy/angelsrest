# Shared client host adoption — October 30, 2026

This host adopts published `@jessepomeroy/admin` 6.13.0 and the reviewed shared
client feature contract from hub source `7fd1934952c5e393dddfdeb4ab46f92105777748`.
The CRM and gallery-delivery packages resolve through this hub's workspace.
CRM API 6.12.0 and gallery-delivery 0.4.0 were published by merged version PR
#740 at `59a81a9e7e029caa9ef28578d3a5f1603eb61365`; immutable registry metadata
was verified. Shared Convex deployment run 41143203883 succeeded at the reviewed
backend source above, after its exact merged-source CI passed.

Both Angels Rest and Queen Worm bind the standard Admin API factory. Basic and
Full are the feature controls; individual capability switches and module pauses
are absent. The backend enforces the tier for new activity while preserving
existing recipient links. Angels Rest retains its explicit draft-only Contact
editor configuration.

The host reuses shared checkout binding, adds a signed tenant checkout-confirmation
read with connected-account and stored-tenant checks, routes buyer lookup through
the hub's verified tenant-scoped broker, and reuses complete gallery-page iteration.
The checkout-confirmation response contains payment amounts and items, without
customer names, email addresses or shipping addresses. This adoption does not
activate Queen Worm checkout or provision provider credentials.

## Observed local verification

Against the installed published Admin 6.13.0:

- Strict peer installation, lint, Svelte type check and package consumer contract passed.
- All 115 Node tests, 3,148 Vitest tests and 28 mutation-protocol tests passed.
- The production build and size-budget check passed. Existing optional dependency tracing warnings remain.
- All 595 published Admin `dist` files byte-match the previously tested candidate.

Checks use the documented CI fixture environment. Prior local browser evidence
covers 16 shared Admin composition/tier checks and 24 configured customer workflows
in Queen Worm with the same Admin implementation. That fixture evidence does not
establish owner login, provider delivery, payment activation or deployed acceptance.
The pinned gallery Worker interface is unchanged.

Reflecting Pool remains pinned to Admin 3.41.6 and CRM 3.1.0. Read-only inspection
confirmed its existing Full-only delivery-gallery UI and additive session handling;
no dependency upgrade, build or live browser verification was performed there.

## Release limits and recovery

The observed current READY provider deployments before host cutover are:

- Angels Rest: `dpl_5Ue2Aen1ZLTta9eNqTim3BpouFd6`, source
  `7fd1934952c5e393dddfdeb4ab46f92105777748`.
- Queen Worm: `dpl_GJ5qZoLkdqrk2sV2RJHJb4ywSTVV`, source
  `7f26358403b75eff89a368b04f242c6b7be9bc97`.

Retain these deployments. Provider readiness and source identity were observed;
final host CI, staging/runtime observations and production acceptance must still
be recorded. The live public feature-access read returns expected Full features
for Queen Worm and Angels Rest; this does not establish authenticated acceptance. No live email, customer record,
payment or gallery mutation was performed for this verification.
