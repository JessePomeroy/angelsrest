# Gallery reliability and editor alignment release

## Deployed versions

- Host [Admin adoption #728](https://github.com/JessePomeroy/angelsrest/pull/728):
  source `077832e15d0294428c4f2313b27898c457589c68`, Admin **6.9.0**,
  production deployment `dpl_9h12rb8LeKThEcnSAaEJcTPZmMmu`.
  The provider reports READY, the `www.angelsrest.online` alias resolves to it,
  and the build log confirms the package upgrade from 6.7.1 to 6.9.0.
- Shared Convex: [gallery contracts #724](https://github.com/JessePomeroy/angelsrest/pull/724)
  deployed by workflow `40998740607`; CRM API **6.10.0** published through #726.
- Gallery Worker: [bounded token validation #127](https://github.com/JessePomeroy/gallery-worker/pull/127)
  deployed as `d3c72a40-2132-48bb-883f-ac8eb50cd991`. Its compatible earlier
  private-cache and range fixes are included.

The host includes the screenshot-reported paired-field and vertical-column
alignment fixes, bounded product media uploaders, delivery upload recovery,
page-owned queues, gallery pagination, responsive public portfolio images, and
blog archive/image improvements. Inquiry read recovery already existed upstream
and was verified rather than duplicated.

## Verification

- Editor geometry: 48 fictional cases across six product kinds and the portfolio,
  post, author, category, About and Contact editors; 390px and 1600px viewports,
  both themes. Paired controls and image metadata/detail columns align, uploaders
  remain bounded, and the checked pages do not overflow.
- Upload regressions cover processing/registration retries, ambiguous responses,
  storage-first deletion, partial batch failure, retained cleanup targets, and
  cancellation without removing completed files. Queue state survives settings
  changes and closing/reopening the modal. Cursor tests cover older galleries,
  server status filters, read errors/retries, stale responses and legacy hosts.
- Package lint/type/test/build checks passed. The updated host passed full PR CI
  and the separate staging CI. The isolated fixture's missing `beforeNavigate`
  hook was repaired in #729; 66 focused Chromium/Firefox cases passed locally,
  and the required CI browser matrix passed after that correction.
- Actual public production reads pass for `/`, `/cart` and `/admin`. The live
  portfolio index reserves dimensions for 12 previews; the sampled detail page
  exposes dimensions, responsive candidates and first-image eager loading for
  24 images. Dedicated browser cases verify source selection and lightbox ratios.

## Controlled staging and recovery

The documented permanent staging host is `https://staging.angelsrest.online`,
using Vercel project `prj_TZXP4xYmWst9RNYhihhgaRoZ52xq` and isolated Convex
`rosy-firefly-366`. The tested candidate
`4473cab8a957d247c23a7ee776fbb1e0a8efe0ac` was deployed there as
`dpl_F6wzot2oF3q2XGd6ix9pCHgtXTWL`, with matching staging CI artifact
`12957775556` from run `41008840135`. The additive backend was updated first.

Both staging public checks pass. Authenticated synthetic-admin sign-in, real
delivery-gallery pagination/query loading, client navigation, and session reload
pass with no browser runtime errors. No private production records or gallery
objects were used. The previous staging deployment
`dpl_7TTkacBfywytgLesMyxLxdaDwCEc` remains retained.

The pre-merge adoption gate returned `evidenceReady: true`, healthy staging,
passing production public checks, and unchanged non-Admin runtime requirements.
Its retained production recovery reference is
`dpl_2izZ39RXaiWyU784VkbHjPGtjcew` at source
`1d7b19044708a61f79af14b634a77504effd7d44`, with matching main-CI artifact
`12955533145`. Complete CLI-generated observation receipts and gate JSON remain
in the operator task workspace `angelsrest-easy-wins-20261029`.

Retain the separate post-merge production observation using main CI
[41012510657](https://github.com/JessePomeroy/angelsrest/actions/runs/41012510657)
and its immutable artifact. The live deployment confirmation above does not
replace that record or equate Vercel's rebuild bytes with the CI fixture build;
provider binding remains source-only.

## Remaining limits

Queue continuity lasts for the page visit; files are not persisted across reloads.
Cleanup during browser shutdown remains best effort. Failure/retry behavior uses
controlled synthetic storage boundaries; this release does not claim a real
private-upload or provider-fulfillment acceptance test.

Direct Paper editing tools are unavailable in this session. Editable handbook
sync and same-state comparison remain pending in the screen inventory; no prior
board IDs, source baselines or verification dates were changed. The user's
requested mobile navigation audit follows release acceptance and is a separate,
read-only review.
