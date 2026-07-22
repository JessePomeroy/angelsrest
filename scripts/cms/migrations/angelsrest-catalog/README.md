# Angels Rest catalog migration journal

This directory is the versioned journal for the complete Angels Rest Shop migration from the published Sanity catalog to private, unpublished Convex content.

## CMS-5.3b adapter and readiness gate

Run the read-only adapter against the published Sanity perspective:

```sh
pnpm cms:catalog-import-dry-run -- \
  --output /tmp/angelsrest-sanity-catalog-import-report.json
```

The command performs no provider or application writes. It does not upload media, create Convex records, mutate Sanity, change the public Shop provider, publish content, or remove the Sanity fallback. It accepts report paths only as direct children of `/tmp`, replaces only that requested temporary report, and writes the new sanitized report with mode `0600`.

The reviewed live-source contract is one complete catalog:

- 33 products: 11 prints, 2 print sets, 19 tapestries, and 1 digital download;
- 49 explicit Sanity variants plus 20 stable generated `default` variants, for 69 normalized variants;
- 38 ordered media placements using 33 unique image assets;
- 16 print-source placements using 11 unique print masters;
- 5 ordered print-set memberships;
- 1 referenced paid file;
- 14 recorded compatibility defaults;
- 0 postcards, merchandise products, collections, coupons, or unsupported products; and
- 38 legacy image placements awaiting guided alt-text review.

The report separates `draftImport` from `publicationRemediation`. Existing missing alt text remains visible as legacy remediation debt but does not block an unpublished recovery import. New or edited public placements still require factual owner-authored alt text under the normal publication policy.

The report also contains an Angels Rest-specific `baseline` gate. Every count above, both readiness totals, and every zero-row family must match the reviewed 33-product snapshot. Missing, truncated, or unexpectedly expanded source data returns `drifted` and exits nonzero even when the generic adapter itself can parse that data. Exact source identities, revisions, and content mappings will be pinned by the later immutable recovery manifest before any import can execute.

Source document identity comes from immutable Sanity IDs, never mutable slugs. Product revisions and asset revisions remain separate: every image and paid file carries its dereferenced asset `_id` and its own `_rev`, repeated references must agree exactly, and a product `_rev` is never accepted as private-asset provenance. Source timestamps, exact integer-cent prices, ordered Sanity keys, media and print-source roles, set memberships, and private-file metadata remain explicit. The report contains no source URLs, content copy, authentication material, upload capabilities, storage keys, or private-file URL.

CMS-5.3b's engineering can land as small reviewed pull requests, but those reviews do not divide the catalog content into migration batches. The eventual content operation must use one pinned manifest covering all 33 products and the complete graph. It must import that manifest as one all-or-nothing unpublished unit and immediately replay the identical plan, accepting only zero writes with unchanged identities. If the complete graph cannot fit one proven transaction, it may be staged behind one atomic activation marker; a partially staged graph is never considered imported.

Raw Sanity recovery exports, complete source snapshots, direct asset URLs, transfer credentials, local checkpoints, and `/tmp` reports are machine-local migration evidence and must not be committed here. Their later storage and verification boundary must be designed before the import executes.

## Private-asset receipt candidates

`sanityCatalogPrivateAssetReceipts.ts` is a pure, non-authorizing bridge between the ready source manifest and the later transfer boundary. It derives the exact deduplicated private set from the manifest—currently 11 print masters and one paid ZIP—then requires one matching injected byte stream per source. Asset identity and revision always come from the manifest. Canonical image MIME, dimensions, and deterministic filename come from the Sanity image reference; paid-file MIME, filename, byte count, and version come from its manifest record.

Before reading any one-shot stream, the helper validates the complete evidence set, the fixed `angelsrest.online` tenant, operator-supplied audit timestamp and actor label, trusted decoder attestations, canonical image/file references, repeated-reference consistency, and every static target field through the production private-asset validators. It then hashes each non-empty chunk incrementally, counts bytes without buffering the file, checks the paid ZIP count against the manifest, builds the exact tenant-scoped candidate object key, and runs the production validator again over the measured record.

The sorted result and its checksum are candidates only. They are not proof of upload, storage, registration, ownership, authorization, or release. The helper performs no fetch, filesystem, environment, Worker, Convex, Sanity, R2, network, or content write. It serializes no source bytes, URL, capability, grant, secret, or target Convex ID. A later operator-gated transfer must attest the decoder observations, re-hash and upload the same immutable bytes, verify actual private registration, and bind those identities into the release plan before any import can proceed.

The registration boundary accepts only complete, canonically ordered receipt sets through two purpose-separated Convex HTTP ingresses. A tenant-scoped storage credential may record the Worker's immutable R2 evidence, while a different tenant-scoped inspection credential may record independently decoded JPEG/PNG or safety-checked ZIP evidence. Either role alone creates only a non-authoritative coordination row. Matching complete sets create all verified private target rows atomically; exact replays return the same target IDs, while role, tenant, key, hash, byte-count, MIME, dimension/version, provenance, or proof drift is rejected without partial target writes. The two Convex registries must be disjoint across roles and tenants, and no public or admin mutation can manufacture either receipt.

### Stable-target V2 forward recovery

A V2 re-attestation can bind a new receipt coordination to immutable targets created by a verified V1 coordination. The reused target's audit timestamps truthfully remain those of its V1 creator, so the pre-stable-target Convex functions cannot validate that V2 coordination. Likewise, the authority table plus pending target plans and verified target bindings are absent from the earlier schema. The last literal schema rollback boundary is therefore **before the first authority row or coordination with `targetResolutionVersion: 1` is written**; the last pre-feature function rollback boundary is before the first such V2 coordination.

After that marker exists, recovery is forward-only:

1. Stop new receipt producers if an incident requires containment; do not delete, patch, or recreate receipt coordinations, authority rows, or private targets.
2. Keep the widened coordination schema, authority table/indexes, and the compatibility readers in `catalogPrivateAssetRegistryTargets.ts` deployed. Do not deploy `@jessepomeroy/crm-api` code from before stable-target V2 to the shared Convex deployment. Frontend or producer callers that do not own this state may be rolled back independently.
3. Ship a corrective Convex deployment based on this compatibility version. It must retain exact pending-plan replay/completion and verified binding/lineage replay for every existing V2 coordination, even if it temporarily rejects creation of new re-attestations.
4. Retire these fields or readers only through a separate reviewed migration that proves there are no affected pending records and defines replacement replay semantics for every verified reused target. Until then they remain permanent read compatibility.

Do not attempt recovery by rewriting target timestamps, cloning or rebinding targets, mutating R2 objects, or changing Sanity/product relations/publication/provider state. Sanity remains the public catalog authority.

This gate is reusable for later bounded Editor transfers, but it does not weaken the migration's complete-content rule: the Angels Rest transfer producer must submit the manifest's exact 11-print-master and one-paid-ZIP set under one content-addressed receipt-set ID. That ID is derived from the schema version, tenant, and every canonical asset fact; Convex independently recomputes it. A missing, extra, reordered, or drifted producer request therefore cannot claim the reviewed full-set identity. Producer adapters, live credentials, source fetching, content inspection, upload execution, and the 12-asset acceptance run remain later iterations.

## Complete private-asset transfer runner

The operator runner re-fetches the complete published Sanity catalog and requires the reviewed 33-product baseline plus the exact 11-print-master/one-paid-ZIP set. Its default mode is a read-only plan: it reads no operator secret file and downloads, uploads, registers, or publishes nothing.

```sh
pnpm cms:catalog-private-assets-transfer
```

Execution requires the existing Angels Rest CMS Worker tenant credential plus a different inspection-only Convex receipt credential. Supply the Worker value through the `CMS_MEDIA_WORKER_SECRET` process environment (for example, Vercel's environment runner) or an owner-only `0600` file. Supply the inspection value only through an owner-only `0600` file. The Worker alone holds the third, storage-only receipt credential. Never put any of these values in this repository or a shell argument.

```sh
vercel env run --environment production -- pnpm cms:catalog-private-assets-transfer -- \
  --execute \
  --confirm "transfer all 12 private catalog assets for angelsrest.online" \
  --inspection-secret-file /tmp/angelsrest-catalog-inspection-secret.txt
```

If Vercel environment injection is unavailable, add `--worker-secret-file /tmp/angelsrest-cms-worker-secret.txt` instead.

The runner downloads and decodes all 11 source images, inspects the paid ZIP, hashes the exact bytes, and validates the full candidate set before uploading. Immutable Worker keys make a partially completed upload safe to resume by re-running the same command. After all 12 objects finalize, the Worker submits the complete storage receipt and the runner independently submits the matching inspection receipt directly to Convex. Success requires verified target IDs plus exact storage and inspection replay. The sanitized completion report is written with mode `0600` to `/tmp/angelsrest-private-catalog-transfer-report.json`; it contains no source URL, byte payload, credential, capability, or storage proof.

This command creates only verified private asset registry rows. It does not import the 33-product graph, switch the public Shop provider, alter checkout or delivery, publish content, mutate Sanity, or remove the Sanity fallback.

Sanity remains the public Shop, checkout, coupon, and download authority throughout this preparation and unpublished-import sequence. Public cutover, authoritative checkout, transactional coupon migration, publication, provider-lifecycle changes, and Editor visual refinement are explicit non-goals of this gate.

## Catalog display-media transfer runner

The product graph also needs normal web-facing CMS `mediaAssets` for public
display images. These are separate from the private print-source masters and
paid ZIP handled by the private-asset transfer above.

Plan mode re-reads the published Sanity catalog, requires the reviewed
33-product baseline, and verifies the current catalog display-media journals
against production Convex/media storage. It does not upload or register media.

```sh
pnpm cms:catalog-display-media-transfer
```

Execution uses the same authenticated admin HTTP media boundary as the Blog
media transfer. It downloads each current published Sanity image, decodes it,
uploads it through the CMS media Worker, lets the host create responsive WebP
derivatives, and persists two versioned journals:

- `sanity-catalog-image-asset-map.json`
- `sanity-catalog-display-media-transfer-receipts.json`

The exact confirmation phrase is:

```sh
pnpm cms:catalog-display-media-transfer -- \
  --execute \
  --confirm "transfer CMS-5.3c 33 catalog display images to www.angelsrest.online" \
  --cookie-file /tmp/angelsrest-admin-cookie.txt
```

After the display-media journals verify all 33 source images, the following
slice can bind those `mediaAssets` plus the already verified private target IDs
into one coordinated unpublished 33-product import. Sanity remains the public
catalog authority until that later import, preview/parity work, and explicit
provider cutover complete.

## Catalog graph-plan assembly

The graph-plan command is the read-only bridge between the completed asset
transfers and the later unpublished catalog import. It re-reads the published
Sanity catalog, requires the reviewed 33-product baseline, reads the committed
display-media and private-asset target maps, and proves that one deterministic
V2 product graph can be assembled for the full catalog.

```sh
pnpm cms:catalog-graph-plan
```

The command writes the complete local import plan to
`/tmp/angelsrest-sanity-catalog-graph-plan.json` with mode `0600`. It performs
no Convex writes, creates no product drafts, switches no provider, publishes no
content, mutates no Sanity document, and reads no admin browser cookie. The
full plan includes current catalog copy because it is the next import payload;
keep it local and do not commit it.

The committed target maps are not credentials. They are the stable Convex asset
IDs already created and journaled by the transfer slices:

- `sanity-catalog-image-asset-map.json` — 33 web/display `mediaAssets`
- `sanity-catalog-private-asset-map.json` — 11 print-source assets and one
  paid digital file asset

The next execution slice must import the exact checked graph plan as one
unpublished unit, then immediately replay it and accept only zero writes with
unchanged product/revision identities.

## Unpublished catalog import runner

After `pnpm cms:catalog-graph-plan` produces the local graph-plan report, the
import runner can send that exact plan through the existing authenticated admin
mutation proxy:

```sh
pnpm cms:catalog-import
```

Default mode performs no network write. It reads and validates the local graph
plan, then prints the exact execution command. Execution requires a fresh admin
cookie because the Convex mutation remains behind the same site-admin boundary
as the protected Editor, but it is one short request rather than a long
per-asset transfer loop:

```sh
pnpm cms:catalog-import -- \
  --execute \
  --confirm "import CMS-5.3d unpublished catalog drafts to angelsrest.online" \
  --cookie-file /tmp/angelsrest-admin-cookie.txt
```

The mutation rejects partial catalog state instead of topping it up. If none of
the planned V2 products exist, it creates the complete graph as unpublished
drafts in one transaction. If all planned products already exist, it accepts
only an exact `sanityImport` replay with unchanged draft checksums and returns
zero writes. A successful import still does not publish products, switch public
Shop reads, create checkout authority, mutate Sanity, or remove the Sanity
fallback.

## 2026-07-20 completion

The complete private-asset transfer gate is complete. See
`2026-07-20-private-asset-transfer.md` for the versioned journal.

- 12 private catalog assets were verified: 11 print-source masters and one paid
  digital ZIP.
- Receipt set:
  `catalog-private-assets-v1:e8d573e1558301bfb52fc108baf227d6d74e4e7fbbc0228d2829ded3d32ac63b`
- Storage and inspection receipts both replayed stably.
- The temporary Worker-only transfer secret was removed after success.
- Sanity remains the public catalog authority until the later unpublished
  product-graph import and explicit public cutover.
