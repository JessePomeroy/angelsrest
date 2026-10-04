# Angels Rest staging

The permanent staging environment uses a separate Vercel project and Convex
deployment. Provider labels call their stable targets “production”; these are
the staging project's own targets, separate from the live site.

| Resource | Staging | Live production |
| --- | --- | --- |
| Public host | `https://staging.angelsrest.online` | `https://www.angelsrest.online` |
| Vercel project | `angelsrest-staging` | `angelsrest` |
| Convex deployment | `rosy-firefly-366` | `loyal-swan-967` |
| Convex project reference | `thinkingofview:angelsrest-crm:staging` | `thinkingofview:angelsrest-crm:prod` |

Use synthetic customers and orders. Never copy live customer records, private
gallery objects or production credentials. Provisioning resources or deploying
the staging application does not establish checkout, media or handoff acceptance.
Record actual release and journey evidence separately.

## Configuration and setup

Set `PUBLIC_SITE_URL`, `PUBLIC_CONVEX_URL` and `PUBLIC_CONVEX_SITE_URL` to the
staging host, `https://rosy-firefly-366.convex.cloud` and
`https://rosy-firefly-366.convex.site` together. A mixed staging configuration
fails before the request is resolved. Staging responses carry a no-index header.
The canonical tenant
key remains `angelsrest.online` inside this separate database.

Direct and cart checkout use that canonical key for admission controls, attempt
proofs, tenant lookup and catalog reservations. Their success/cancel URLs use the
staging public origin, which the host passes as the exact allowed return origin.
Checkout role credentials and the backend's test intake scope must therefore be
keyed by `angelsrest.online`, not the staging hostname. This separation does not
change signed spoke routing or production checkout attempts.

Generate fresh, distinct `BETTER_AUTH_SECRET`, `WEBHOOK_SECRET`,
`ORDER_LOOKUP_SECRET`, `COMMERCE_INTAKE_RUNNER_SECRET` and
`PRINT_FULFILLMENT_RUNNER_SECRET`. Share only the applicable role's new credential
between this staging host and this staging backend. Keep credentials in the
provider's environment store and an approved local secret store, outside Git.
Never put them in command arguments, evidence or screenshots.

The backend's `SITE_URL` must be `https://staging.angelsrest.online`. Its runner
URLs must use that origin with `/api/internal/commerce-intake` and
`/api/internal/print-fulfillment`. Each dispatcher binds its allowed host to the
physical Convex deployment. Unknown deployments and cross-environment callbacks
are rejected before sending the bearer credential; redirects remain forbidden.

Use a deployment-scoped Convex key for `rosy-firefly-366` and verify the printed
target before a push. Do not rely on the project's default production selector.
Run the package's `tsc -p tsconfig.json --noEmit` check before deployment: the CLI's
legacy typecheck expects a different configuration filename in this repository.
Generate API bindings with the CLI; do not edit generated files.

For an empty staging database, generate a fresh administrator password and hash
it with the installed Better Auth `hashPassword`. Temporarily install the hash as
`STAGING_BOOTSTRAP_PASSWORD_HASH`, then run the internal
`stagingSetup:bootstrap` function with an explicit staging target. It creates
`staging-admin@example.invalid` through the existing authentication helper and
grants stored creator membership. Remove the bootstrap hash after successful
login verification. A repeat preserves the existing credential; a populated
environment is never reset. Public signup and Google OAuth are not enabled.

`stagingSetup:seedSiteSettings` creates synthetic published settings so the root
layout can load. It preserves existing content. The SEO asset is placeholder
metadata only: no object is uploaded, and its presence does not prove a working
media pipeline. Media uploads, delivery galleries and SEO images require their
own isolated storage/Worker configuration and acceptance.

## Provider containment

- Stripe must use a dedicated sandbox and a test key. Verify the account ID and
  `livemode: false` independently before installing credentials. The host rejects
  live keys in staging. Create a separate webhook endpoint pinned to the app's
  Stripe API version and install its fresh signing secret. Do not reuse the old
  invoice-verification endpoint or rewrite signed events.
- LumaPrints must use its sandbox credentials/store with
  `LUMAPRINTS_USE_SANDBOX=true`; staging rejects a live supplier endpoint and any
  dedicated connection registry containing a production entry. Leave
  supplier credentials absent until the sandbox account and store are verified.
- Commerce mail uses a fresh, domain-restricted sending key in
  `STAGING_RESEND_API_KEY`. Its transport sends from
  `Angel's Rest staging <staging@angelsrest.online>` only to
  `delivered@resend.dev`, removing CC, BCC and Reply-To and preserving idempotency
  keys. Resend documents this recipient as a
  [delivery simulation](https://resend.com/changelog/sending-test-emails).
  Other mail operations are refused. Keep `RESEND_API_KEY` absent on both host
  and backend. Shared Admin's independent mail transport remains unavailable in
  staging; commerce mail acceptance does not imply CRM email acceptance.

Keep `ORDER_PRODUCERS_STATE=closed` and new intake disabled during setup. Enable
only the exact staging site/test scope when its dependencies are ready. Production
activation remains a separate decision. Follow the
[commerce intake runbook](commerce-intake.md) for interruption, duplicate,
draining and rollback checks. Record actual provider observations; local fixture
success and a successful deployment are not provider acceptance.

## Deployment evidence

Use a focused, reviewed source revision and the isolated Vercel project. A local
prebuilt deployment avoids distributing package-registry credentials; retain its
source revision, local check results and artifact/deployment identity. Verify
the staging alias resolves to that deployment and that its public configuration
selects the staging backend. Preserve a healthy staging rollback deployment.

Record missing services explicitly. Resource creation, HTTP health, login,
checkout settlement, notification simulation, supplier submission, queue recovery
and controlled release adoption are separate checks. Never mark all of staging
verified based on its first successful page load.
