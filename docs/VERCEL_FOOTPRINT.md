# Vercel footprint controls

Implemented September 7, 2026. The SvelteKit frontend remains on Vercel; the
existing `media.angelsrest.online` domain serves the existing Cloudflare R2
`cms-media-public` bucket. No hosting cutover, new subscription, or dependency
is part of this change.

## Deployment frequency

`vercel.json` runs `scripts/vercel-ignore-build.mjs`. A nonempty diff from
`VERCEL_GIT_PREVIOUS_SHA` to HEAD skips a deployment only when every changed
file is under `docs/` or `tests/`, is root README.md/AGENTS.md, or is a Markdown
changeset. Runtime changes, unknown paths, missing/shallow history, and empty
diffs build. This compares with the last successful deployment, so a later
docs commit cannot conceal earlier runtime changes. `VERCEL_FORCE_BUILD=1`
forces a build. Tests and CI still run on pull requests.

Vercel's [Ignored Build Step](https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel)
uses exit 0 to skip and exit 1 to continue. This conservative rule does not
eliminate all preview deployments. Retention remains a separate project setting.

## Public HTML caching

`src/lib/server/publicPageCache.ts` permits Vercel CDN caching for 60 seconds on
successful HTML responses from `/`, `/gallery`, `/gallery/[slug]`, `/blog`, and
`/blog/[slug]`. Published content changes may take up to one minute to appear in
cached HTML. Browser caches must revalidate; no stale window is added.

The origin does not mark responses cacheable for cookies, authorization headers,
queries, SvelteKit data requests, non-GET/HEAD methods, errors, Set-Cookie,
restrictive cache headers, or Vary other than Accept-Encoding. An existing public
CDN entry can still serve public content without reaching the origin; these
routes must remain strictly public and unpersonalized. Review their loaders and
layout before adding personalization or expanding the allowlist.

Shop prices, checkout, APIs, admin, customer lookup, and private delivery pages
are excluded. Private media authorization stays intact. CDN hits can reduce
function invocations and origin transfer; visitor-facing transfer still exists.
See [Vercel CDN usage](https://vercel.com/docs/manage-cdn-usage).

## Public images

`src/lib/config/publicAssets.ts` points the homepage GIF and fallback social
image to immutable, content-hashed URLs under
`https://media.angelsrest.online/sites/angelsrest.online/site/`.
Original files remain in `src/lib/assets/` for recovery and future publishing.
The old `/og-image.png` URL redirects with an empty 307 response rather than
proxying the image. Custom content-managed social images remain supported.

| Asset | Bytes | SHA-256 prefix |
| --- | ---: | --- |
| clouds2.gif | 672,091 | 4e50727fe4b79453 |
| og-image.png | 935,956 | 3189eae23f5f64e7 |

Both objects use `public, max-age=31536000, immutable`. Publish a new hashed key
and update the reference when replacing an image; do not overwrite these keys.
The 1,608,047-byte pair moves static asset delivery off Vercel, not private media
or the application. Public downloads matched source hashes and returned HTTP
200 without Referer for browser and social crawler user agents.

## Function artifacts

Vite now minifies SSR output while preserving server function names. Sentry,
authentication, native image processing, function durations, and dependencies
remain intact. An attempted SDK-bundling optimization was discarded after
adapter tracing failed; it is not part of this configuration.

A clean baseline build of `a0a3defd` measured 150,521,298 logical bytes across
four actual function directories. The final build measured 149,102,202 bytes:
1,419,096 bytes (0.94%) less. This sums files within each function, following
its dependency symlinks; shared dependencies count per function. It is neither
unique disk usage nor Vercel's billed Function Storage measurement. The static
asset reduction above is separate. Recheck artifact size after major SDK changes.

## Operating constraint

These controls reduce footprint; they do not guarantee staying under quotas.
Compare equivalent periods in Vercel usage, particularly Function Storage,
origin transfer, and invocations. Retained build counts and cumulative billing
period usage are different measures.

Vercel [Hobby is for personal, non-commercial use](https://vercel.com/docs/plans/hobby).
The shop and paid booking business cannot be made Hobby-eligible merely by
reducing usage. Cloudflare already serves media, but a full frontend migration
still needs separate compatibility work and a hosting decision.
