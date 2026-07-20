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

Sanity remains the public Shop, checkout, coupon, and download authority throughout this preparation and unpublished-import sequence. Public cutover, authoritative checkout, transactional coupon migration, publication, provider-lifecycle changes, and Editor visual refinement are explicit non-goals of this gate.
