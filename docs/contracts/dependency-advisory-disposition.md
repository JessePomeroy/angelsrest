# Dependency advisory disposition

Reviewed on November 6, 2026 for Angels Rest and the shared Admin package.
This is source and installed-dependency evidence, not a live deployment
attestation or permission to dismiss repository alerts. Recheck it when enabling
auth plugins, changing adapters, adding enhanced forms, or accepting new build
configuration inputs.

## Compatible framework patch

Both repositories require `@sveltejs/kit ^2.70.4` and lock 2.70.4, within the existing
SvelteKit 2 major. Admin's public `^2.0.0` peer range is unchanged; its development
upgrade does not upgrade a host. Angels Rest retains the installed Admin package
version and its current auth configuration.

The [official 2.70.4 release](https://github.com/sveltejs/kit/releases/tag/%40sveltejs%2Fkit%402.70.4)
backports escaping of cache-control values inserted into prerendered HTML.
The [maintainer advisory](https://github.com/sveltejs/kit/security/advisories/GHSA-27mw-82g8-phjj)
lists 2.70.4 as patched, but its prose and GitHub alert metadata also refer to
3.0.0. The published 2.70.4 npm artifact, verified against its registry SHA-512
integrity, calls `escape_html(value, true)` for that attribute. This patch selection
therefore rests on the release and shipped code, not an assumed alert closure.

The lock changes update Kit's peer snapshots and reuse the already-locked
`set-cookie-parser` 3.2.2 for Kit, removing its older duplicate. No other package
version, auth peer constraint, override, generated API, or application code changes.

## Current reachability and remaining work

| Advisory | Required path | Current evidence and disposition |
| --- | --- | --- |
| [Kit prerender cache-control XSS](https://github.com/sveltejs/kit/security/advisories/GHSA-27mw-82g8-phjj) | Untrusted cache-control passed through `setHeaders` while prerendering | Hub has no route prerender declaration; its `setHeaders` cache policies are fixed `private, no-store`. No configured exploit path established. Apply the compatible 2.70.4 defense anyway. |
| [Kit enhanced-form open redirect](https://github.com/sveltejs/kit/security/advisories/GHSA-pfhg-q3qv-9q6r) | Enhanced form actions on a route accepting a pathname beginning `//` | Neither repository imports `$app/forms` or uses `use:enhance` in application source. Hub has native form actions; those do not establish the enhanced-form prerequisite. Published fix is 3.0.0; do not claim this separate advisory is fixed by 2.70.4. Review before introducing enhancement or undertaking a Kit major migration. |
| [Better Auth Magic Link with OAuth](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm) | Magic Link plugin alongside social OAuth and the stated state-storage conditions | Hub enables Google OAuth and the Convex adapter, but its complete server plugin list contains only the Convex plugin. Magic Link is absent; the configured vulnerable path is unreachable. |
| [Better Auth OAuth Proxy](https://github.com/better-auth/better-auth/security/advisories/GHSA-r4xp-prcw-77qf) | OAuth Proxy and the stated shared-secret, cookie-state and account-linking conditions | OAuth Proxy is absent from the server configuration. No configured proxy flow or attacker-selectable plugin was found. |
| [Better Auth device authorization](https://github.com/better-auth/better-auth/security/advisories/GHSA-q84f-53jg-9ppm) | Opt-in device authorization plugin | The Convex plugin includes bearer behavior, but device authorization is absent. Bearer support alone does not expose the missing flow. |
| [Better Auth PostgreSQL rate limiter](https://github.com/better-auth/better-auth/security/advisories/GHSA-44jh-23m7-hpcf) | PostgreSQL/Drizzle/Kysely database-backed rate-limit records | Hub uses `authComponent.adapter(ctx)` and no rate-limit storage override or secondary storage. Installed Better Auth defaults to memory rate limiting for this configuration. The PostgreSQL prerequisite is absent. |
| [Deepmerge prototype poisoning](https://github.com/TehShrike/deepmerge/issues/273) | Attacker-controlled merge input | Both locks retain deepmerge 4.3.1 through `@sveltejs/vite-plugin-svelte` 6.2.4. Its invocation merges local Svelte/Vite configuration and plugin defaults/options at build time. No request, customer record or uploaded document input path was found. This is internal build reachability; upstream disagreement does not prove general safety. No published patch is assumed. |

Hub auth evidence lives in `packages/crm-api/convex/auth.ts` and
`src/lib/auth/client.ts`. Admin declares Better Auth only as a development
dependency and does not instantiate an auth server. The relevant build entry
points are each repository's Svelte/Vite configuration and the installed Svelte
plugin's `src/utils/options.js` configuration merge.

Both repositories retain Better Auth 1.6.34. The installed Convex component
`@convex-dev/better-auth` 0.12.6 requires `better-auth >=1.6.11 <1.7.0`; the listed
advisory fixes are outside that range. A supported adapter/auth upgrade needs
its own compatibility and auth/session verification. Do not bypass the peer
constraint or enable an affected plugin under this disposition.

A supported newer component exists: 0.13.0 requires Better Auth
`>=1.7.16 <1.8.0`. Its [official upgrade guide](https://github.com/convex/better-auth/blob/v0.13.0/docs/content/docs/upgrading/from-0-12.mdx)
and [changelog](https://github.com/convex/better-auth/blob/v0.13.0/CHANGELOG.md)
describe breaking endpoint, adapter, schema and session changes. This is a
concrete follow-up candidate, rather than evidence that no upgrade path exists.
Keep that coordinated migration separate from this framework patch. The same
changelog identifies a compatible 0.12.7 component security patch, with unchanged
Better Auth peers and component schema/generated bindings. Keep it as the next
bounded dependency slice:

- [Request-origin poisoning](https://github.com/convex/better-auth/security/advisories/GHSA-9qq3-v9g3-cxhw)
  requires self-hosted Convex without the relevant header normalization, matching
  dynamic hosts, and an email-link flow. Hub config has no reset, verification,
  Magic Link or account-deletion email handler. Repository configuration targets
  Convex Cloud; this does not attest to a live backend. Environment-supplied host
  extensions were not inspected. The SvelteKit proxy also filters forwarding
  headers, although direct Convex HTTP requests bypass that proxy.
- [Premature Convex JWT issuance](https://github.com/convex/better-auth/security/advisories/GHSA-4qvm-r4pr-v3wg)
  requires the opt-in `twoFactor()` plugin, which Hub does not enable. JWT
  authorization is present; membership checks would not replace a second factor
  if that plugin were introduced.

Neither configured exploit path was established. The compatible maintenance
patch still warrants its own sign-in/session verification: 0.12.7 clears the
Convex JWT at sign-in/callback and issues it after an established-session request.
Hub's server reads that cookie and LoginPage reloads after sign-in. Verify the
registered router, trusted/untrusted origin handling, cookie establishment,
session recovery and sign-out before accepting the patch. A frontend-only deploy
would not update Convex auth runtime. This framework patch does not claim the
component's complete advisory set is resolved.

An independent read-only validation found no current configured exploit path
for the four Better Auth advisories and no untrusted-request path into deepmerge.
Package matches and upstream alerts remain recorded; no alert was dismissed.
These conclusions do not establish what revision or configuration a live
Convex backend runs. Worker dependency alerts were also checked; there were no
open alerts at the observation time and no Worker dependency changes in this slice.

## Delivery boundaries

Run the existing auth/session/HTTP/SSR, type, lint, test, build and package-consumer
checks for the dependency candidates. Source-PR review and current-head CI remain
required. A Kit upgrade reaches the Hub runtime only after its separately
approved hosting deployment. An Admin source merge does not publish or adopt the
package. Package publication, Convex or Worker deployment, and consumer adoption
are separate gates.
