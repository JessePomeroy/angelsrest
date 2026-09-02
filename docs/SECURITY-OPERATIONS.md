# Security operations and recovery

This runbook records the current production authority, least-privilege roles,
recovery paths, and incident order for the Angels Rest hub and its spoke sites.
It contains no credential values.

## Authority map

| Surface | Authority | Recovery or compatibility path |
|---|---|---|
| Admin authentication | Better Auth | Provider session recovery; no public password signup |
| Tenant authorization | Convex `platformClients.adminIdentityIds` | Verified invited-email claim only during the R12 widen/claim rollout |
| Published content and Shop catalog | Convex | Explicit, reviewed Sanity provider selection |
| Editor drafts and media registry | Convex | Retained migration captures and Sanity recovery tooling |
| Editor and private catalog bytes | Cloudflare R2 | Convex receipts, tombstones, and retained source metadata |
| Orders, CRM, documents, inquiries | Convex | Provider exports and deployment backups |
| Checkout and refunds | Stripe, orchestrated by the Angels Rest hub | Close checkout admission, preserve snapshots, reconcile by provider IDs |
| Print fulfillment | LumaPrints, orchestrated by the Angels Rest hub | Stored order/fulfillment state and bounded retry |
| Transactional email | Resend | Durable document-email attempts and provider message IDs |
| Private delivery galleries | Convex metadata plus private R2 objects | Capability-scoped Worker reads and prepared-download recovery |

Sanity is a retained, optional recovery provider. It is not the authority for
new content, Shop reads, or checkout. Reflecting Pool's independent Sanity
project is outside Angels Rest recovery custody.

## Least-privilege roles

- Repository CI reads contents and packages only.
- Package publication uses the repository-scoped GitHub token with package
  write permission; it does not receive deployment credentials.
- Shared Convex deployment is a separate manual workflow with one production
  deploy key and read-only source/package permissions.
- Vercel owns host deployment environment values. Browser bundles receive only
  explicitly public variables.
- The gallery Worker owns scoped R2 bindings. Browser uploads use short-lived,
  tenant-bound capabilities rather than R2 credentials.
- Stripe webhook, checkout bridge, catalog resolver, order lookup, Turnstile,
  and CMS media credentials are purpose-separated. A credential for one role
  must not be accepted for another.
- Site administrators need both a valid Better Auth identity and exact stored
  tenant membership. Creator authority is not inferred from authentication.

## Identity rollout

R12 uses a widen/claim/narrow sequence:

1. Deploy the optional `adminIdentityIds` field, verified claim mutation, and
   disabled public password signup.
2. Deploy hosts that attempt the idempotent claim before checking membership.
3. Sign in normally to each production tenant and verify its stable identity is
   stored.
4. Confirm a different subject with the same email is rejected.
5. Remove the temporary invited-email compatibility read and redeploy.

Do not narrow before every active production tenant has a verified stable
claim. Creating a platform-client record is an invitation; it must never create
or disclose a generated password.

## Backup and restore

- Convex remains the authoritative database. Use deployment-native backups or
  exports and restore into an isolated deployment before changing production.
- R2 recovery is bucket-specific: public derivatives may be regenerated from
  retained private sources; private catalog and gallery objects must remain
  private and be reconciled against Convex metadata before restoration.
- The encrypted Angels Rest Sanity archive, hosted datasets, Studio, and
  provider adapter remain retained until a separate owner-approved deletion.
- Stripe, LumaPrints, and Resend objects are external evidence. Restore local
  state by stable provider identifiers; never synthesize a successful provider
  outcome.
- Roll back host code to a known-good Convex-compatible revision. Once Convex
  has accepted new authoritative writes, do not roll back to stale Sanity data.

## Incident order

1. Stop the narrowest admission path that can create new effects: checkout,
   upload capability issuance, publication, or email action.
2. Preserve request IDs, provider IDs, deployment revisions, and current
   database state without logging secrets or bearer-capability URLs.
3. Classify the boundary: identity, tenant authorization, provider availability,
   data integrity, or presentation only.
4. Reconcile authoritative state before retrying. Reuse durable idempotency keys
   and existing claims; do not create a fresh action for an uncertain one.
5. Rotate only the compromised purpose credential and retain the previous value
   for the minimum bounded overlap required by its documented protocol.
6. Restore admission, verify one bounded operation, and record the final source,
   deployment, and provider evidence.

Capability paths under `/portal/*` and `/delivery/*` are secrets. They remain
private/no-store, excluded from analytics, and scrubbed from Sentry events and
breadcrumbs.

## Connected commerce gate

Connected Stripe commerce is inactive while no platform client has a connected
account. Before the first connected live sale, separately verify account
ownership, destination status, API version, account-scoped webhook signatures,
tenant routing, refunds, durable deduplication, rollback, and credential
recovery. That acceptance is an external-effects gate, not part of ordinary
source deployment.

## Release and recovery evidence

For every security-affecting release, retain:

- reviewed commit and tree IDs;
- CI results and exact dependency-lock state;
- package version and registry result when applicable;
- backend and host deployment IDs;
- a redacted production verification result;
- the known-good rollback revision; and
- an explicit record of any deferred risk.

Release tags and packages currently lack a portable cryptographic attestation
chain. GitHub workflows pin actions by commit and minimize permissions, but the
remaining signed-tag/package-provenance decision must be explicitly accepted or
closed before R12 exits.

## R12 held cleanup

The following production environment names appeared potentially obsolete in a
name-only inventory and must not be deleted without a separate value-free usage
check and owner approval: `ADMIN_PASSWORD`, dated
`R5_BACKUP_RECOVERY_KEY_*` entries, `SHARP_SPIKE_TOKEN`,
`SANITY_WRITE_TOKEN`, and `SHOP_CATALOG_PROVIDER`.
`CHECKOUT_SNAPSHOT_MODE` remains active for compatibility intake and must be
retained. Legacy CMS/media variables require adapter and rotation review before
any removal.
