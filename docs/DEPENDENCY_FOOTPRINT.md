# Server dependency footprint

The Svelte host sends HTML/text email payloads. It has no authored React UI or React email templates. React stays as a direct dependency because the installed `@convex-dev/better-auth` declares a required React peer; removing it would leave an unsupported dependency graph.

`@react-email/render` and `react-dom` are removed from direct dependencies. Resend 6.12.2 declares the renderer as an optional peer and loads it only for a `react` payload; Better Auth 1.6.23 declares React DOM as an optional peer for its React integration. Version-scoped pnpm overrides remove those unused peer edges because removing direct entries alone left the old optional peer graph installed. Reevaluate the overrides when upgrading either package. Do not introduce React email payloads without deliberately restoring and testing that integration.

The real Resend SDK transport test intercepts fetch and verifies HTML/text payload delivery and the idempotency header without sending email. Existing webhook-email tests verify the application templates and failure handling. The retained Admin package uses the host's Resend peer and has no React renderer import.

## Measurement

Compared production builds with identical placeholder environment values and Sentry uploads disabled, before and after pruning, based on S08 commit `ae9bedc`:

| Unique function directory | Before bytes | After bytes |
| --- | ---: | ---: |
| `0.func` | 37,496,591 | 31,616,462 |
| `1.func` | 75,443,369 | 69,563,240 |
| `2.func` | 35,804,527 | 29,924,398 |
| `catchall.func` | 19,413,223 | 19,413,223 |
| Total | 168,157,710 | 150,517,323 |

This is a 17,640,387-byte (10.49%) reduction in logical file bytes, following symlinks within each of the four unique `.vercel/output/functions/![-]/*.func` directories. Do not count route symlinks as additional function bundles. Shared files within different bundles are counted separately. These are uncompressed local artifacts, not Vercel billed storage or client transfer measurements. Historical deployments retain their previous output until deleted.

The package manager resolved 15 fewer packages. No browser-size saving is claimed: this change removes an optional server email rendering path, not a React frontend.
