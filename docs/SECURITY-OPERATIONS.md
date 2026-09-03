# Security operations and recovery

This runbook records the current production authority, least-privilege roles,
recovery paths, and incident order for the Angels Rest hub and its spoke sites.
It contains no credential values.

## Authority map

| Surface | Authority | Recovery or compatibility path |
|---|---|---|
| Admin authentication | Better Auth | Provider session recovery; no public password signup |
| Tenant authorization | Convex `platformClients.adminIdentityIds` | Tenant-bounded verified-invite claim only for an unclaimed tenant |
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

The widened claim path is deployed and public signup is disabled. Angels Rest
has one verified stable identity claim, so its authorization no longer consults
the invited-email fallback. The source contract rejects an unverified account
and a different subject presenting the same email.

Reflecting Pool remains unclaimed under the owner's explicit deferral. Its
compatibility path is tenant-bounded, requires a verified invited email, and is
available only while that tenant has no stable identity. Do not remove this
fallback globally until that tenant is claimed or retired. Creating a platform
client records an invitation; it never creates or discloses a password.

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

The 2026-09-02 production inventory found zero connected accounts for both
registered tenants. This gate is therefore inactive and no payment acceptance
was run during R12.

## Dependency and source hygiene

The 2026-09-02 registry-backed audits report zero known vulnerabilities in the
complete Angels Rest, shared Admin, and Gallery Worker dependency graphs.
Relevant builds, type checks, tests, and Worker dry-run bundles pass on the
updated locks. CI and package workflows install with lifecycle scripts disabled;
required builds remain explicit steps.

Five broken machine-local skill symlinks were removed from version control and
`/skills/` is ignored. `AGENTS.md` remains the sole tracked agent-governance
file. The deployable development password/JWKS mutation and its local password
hash and dummy-data scripts were removed. Repository secret scanning found no
tracked credential material.

The older V1–V3 print-fulfillment mutations and deprecated site-scoped shipment
APIs remain deliberately: they are authenticated rolling-deploy and rollback
compatibility for previously published consumers. Current hub code uses V4
print coordination and the tokenized V2 shipment lease. Remove the older
protocols only after a separately reviewed consumer and rollback inventory.

## Release and recovery evidence

For every security-affecting release, retain:

- reviewed commit and tree IDs;
- CI results and exact dependency-lock state;
- package version and registry result when applicable;
- backend and host deployment IDs;
- a redacted production verification result;
- the known-good rollback revision; and
- an explicit record of any deferred risk.

Portable cryptographic release attestation is intentionally deferred by owner
decision: it is unnecessary for the current controlled repositories and
consumer set. Reviewed commits, CI, lockfiles, package versions, deployment IDs,
and rollback revisions remain the release evidence. Revisit attestation only if
distribution expands to untrusted consumers or a regulatory requirement calls
for independently verifiable provenance.

## R12 held cleanup

The value-free 2026-09-02 inventory found these removal candidates with no
active host source consumer: Vercel `ADMIN_PASSWORD`, `SANITY_WRITE_TOKEN`,
`SHARP_SPIKE_TOKEN`, and `NPM_TOKEN`; and the repository Actions secret
`CONVEX_DEPLOY_KEY_REFLECTING_POOL_PROD`. `SHOP_CATALOG_PROVIDER` affects only a
legacy parity diagnostic and may also be removed once that diagnostic default is
accepted. None has been deleted; external cleanup requires an exact owner
approval. Treat `NPM_TOKEN` as package-manager infrastructure until a clean
production install proves that the private package registry does not consume it.

During R12 source verification, Convex's local-deployment setup created the
empty dashboard project shell `angelsrest-r12-local`. The function push used
only a local backend; no application functions or data reached that cloud
project. The unused shell is retained pending explicit owner approval to delete
it.

Retain both dated `R5_BACKUP_RECOVERY_KEY_*` values until the encrypted archive
identifies a single accepted recovery key and a restore recheck passes. Retain
`CHECKOUT_SNAPSHOT_MODE`, which remains active for compatibility intake. Legacy
CMS/media credentials require a role-by-role rotation review before removal.
