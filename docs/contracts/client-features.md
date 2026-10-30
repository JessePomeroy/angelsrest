# Shared client feature policy

`packages/crm-api/src/clientFeatures.ts` owns tenant permission resolution.
`platformClients.tier` supplies the complete Basic/Full bundles. There are no stored
module overrides, module settings APIs or per-module controls. Messages remain
creator-only.

The existing creator-only `platform.updateSubscription` and `updateClient` mutations
manage tiers. `platform.getFeatureAccess` exposes the tier, effective permissions
and site identity for presentation. It is not write authority.
`adminAuth.checkAdminAccess` returns effective permissions only after stored
membership validation.

Host admin loads serialize those permissions. HTTP adapters authorize their route's
feature after membership. Backend entrypoints enforce the same policy for direct
Convex calls. Shared Admin follows the server session and refreshes it when the
stored tier changes. Never derive creator authority from a site's UI config.

Basic includes dashboard, editor, portfolio galleries, orders and inquiries, with
checkout, LumaPrints fulfillment and digital products included in its shop. Full
adds CRM, board, invoicing, quotes, contracts, email templates and private gallery
delivery with proofing. These capabilities are included automatically, with Basic/Full
as the only feature controls in creator client details. Journal and expanded uploads
remain outside Queen Worm's installed support until their complete public/Worker
contracts are verified.

## Customer continuity

Tier downgrades prevent new Full-tier owner activity; they do not revoke issued
recipient tokens. Keep token read/accept/sign/proof/download paths independent of
the current owner tier.
Their ordinary tenant, expiry, password and revocation checks still apply.
New token issuance, document sends, checkout admission and owner workflows use the
current tier. Existing admitted orders retain their saved fulfillment and provider
connection; do not gate webhook persistence or fulfillment completion on the owner tier.

Tier inclusion does not set host environment variables, establish Stripe/LumaPrints
connections, grant unsupported product kinds, or activate commercial service. Existing
service readiness, product permissions and commercial activation gates still apply.
Preserve closed checkout until separately authorized.

## Standard host adoption

Admin exports `createStandardAdminAPI` from its pure `client-integration` entrypoint.
Both hosts use it instead of independent optional API lists. Keep the source typed
against the generated API and mount actual standard routes. Queen Worm's
`adminIntegration.test.ts` verifies modern bindings and required customer routes;
fixture component equality alone cannot prove host completeness.

The shared `server/customer-services` helpers own checkout binding and signed
confirmation reads. Only the bound buyer's server sends the tenant-signed bridge
request; the hub checks its registered credential and Stripe account/tenant metadata.
Return a validated amount/item/status projection without customer PII. Public order
lookup keeps the hub-only lookup credential and Turnstile verification on the hub.

## Release

Deploy the additive backend/schema before adopting the new package APIs. Publish
Admin, CRM API and gallery-delivery candidates, pin their actual releases in both
hosts and run relevant checks and browser workflows. A local packed candidate is
not a published release. Record source/environment-specific evidence after the
observed rollout. Do not mark a client ready from source-only or synthetic checks.
