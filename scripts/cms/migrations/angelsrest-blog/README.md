# Angels Rest Blog media mapping

This directory is the versioned migration journal for the published Sanity Blog image set.

- Keys are immutable Sanity image asset references from the published `n7rvza4g/production` dataset.
- Values must be the matching tenant-owned Convex `mediaAssets._id`, never the media Worker UUID.
- Blank values have not been transferred or verified.
- Factual alt text remains a separate guided review requirement; a media mapping does not satisfy it.
- `sanity-blog-media-transfer-receipts.json` uses schema v2 to record the source facts, runner-observed source SHA-256, and both identities observed during each completed transfer. It contains no upload capability, storage key, session cookie, or secret.

## Bounded CMS-4.4m transfer

Preview the fixed ten-asset batch without reading an admin Cookie or changing files or provider state:

```sh
pnpm cms:blog-media-transfer
```

Production execution is deliberately restricted to the ten still-unmapped, reviewed body images from the published `tarkovsky-s-polaroids` post, in document order. Its earlier `image-0195cc0d…-495x600-jpg` body image is already mapped and is not part of this batch:

```sh
pnpm cms:blog-media-transfer -- \
  --execute \
  --source-ref image-5f1512614d2c4c605f19729a67b7ed8c583bc615-970x982-jpg \
  --source-ref image-dcdf529f090e6c38354c9f10584cd1ea897c3927-961x982-jpg \
  --source-ref image-d74c6ebb3e7cc5b295e63d2677a5b705dd6c279e-1265x982-jpg \
  --source-ref image-e2cffdeac93f452e8a6e60b6fe1d7e55255ef1eb-772x1024-jpg \
  --source-ref image-fac235d6f5243c7889bbb8523956829c86a36d0e-992x1024-jpg \
  --source-ref image-4e8305a2f2b2f0eee7a2ddd04beeb2a37b5a633f-550x553-png \
  --source-ref image-2a260c1e56c70829d3ef9312fd4852786db586b9-964x982-jpg \
  --source-ref image-fbfb0b1031d0c9976c2fcb17212ca2dd5cd7adbc-947x982-jpg \
  --source-ref image-21cb525348f10f8a627a4b347ef4ba9a2a9b668b-964x982-jpg \
  --source-ref image-5e63b0248178528caaa470ff31d3aec5a21d7f5e-640x640-jpg \
  --cookie-file /absolute/path/to/owner-only-cookie.txt \
  --confirm "transfer CMS-4.4m 10-asset batch to www.angelsrest.online"
```

The Cookie file must be a regular, owner-owned mode-`0600` file containing one raw Cookie header value with no `Cookie:` prefix. The Cookie is sent only to the fixed Angels Rest admin host. The short-lived upload token is sent only to the validated media Worker PUT URL; neither credential is logged or persisted.

The runner:

- validates the exact Sanity origin, project, dataset, published reference, canonical CDN bytes, reviewed SHA-256, MIME, size, decoded format, and dimensions before upload; Sanity's embedded asset ID continues to identify its uploaded original and is not incorrectly treated as a digest of the public CDN byte representation;
- processes the ten assets strictly serially and stops at the first failure;
- checkpoints the source digest and one Worker identity before PUT, then reconciles every ambiguous PUT or process result against that same private key without requesting a replacement capability;
- uses one exclusive local lock and compare-and-swap journal digests to prevent concurrent or out-of-band commits;
- verifies the candidate mapping through the production registry gate before committing the receipt first and mapping second;
- recovers forward from a crash after either journal rename and re-runs the full verifier before marking an asset complete; and
- removes its machine-local checkpoint only after all ten assets pass final verification.

An expired admin session leaves the checkpoint in place: replace the contents of the same secure Cookie file and rerun the exact command. The checkpoint and lock paths are intentionally shared between bounded batches, while their contents bind to the active batch ID and ordered source references. A checkpoint from another released batch fails closed; resume it only with that batch's exact released runner and command. A missing same-key upload or an unfamiliar partial journal state stops for operator review. Do not delete or edit the checkpoint or lock to force progress.

This command uploads only the reviewed copies and updates these versioned migration journals. It does not mutate Sanity, import Blog documents, change the public content provider, delete source data, or remove the Sanity fallback.

Validate the current journal without importing content or changing providers:

```sh
pnpm cms:blog-import-dry-run -- \
  --image-asset-map scripts/cms/migrations/angelsrest-blog/sanity-blog-image-asset-map.json
```

Verify every populated mapping against the current published source set, production Convex, and the public derivative origin:

```sh
pnpm cms:blog-media-verify
```

The verifier:

- re-fetches the published `n7rvza4g/production` Blog documents and rejects missing or extra journal keys;
- joins each populated mapping to exactly one versioned transfer receipt;
- calls the operator-only production Convex projection and verifies the exact `angelsrest.online` tenant, `web` intent, `ready` status, Convex/Worker identities, source MIME/bytes/dimensions, private-master identity, and all five derivative identities without returning storage keys;
- probes the expected `thumb`, `card`, `display-1280`, `display-2048`, and `display-2560` public URLs;
- allows blank mappings as `registry-verified-partial`, reports `registry-verified-complete` only when every current source is mapped, and fails closed as `blocked` for any populated mismatch; and
- writes only a sanitized report to `/tmp/angelsrest-sanity-blog-media-verification.json`.

The command is read-only: it does not upload or delete media, write Convex or Sanity data, import content, change a public provider, or edit either versioned journal. It requires the existing Sanity environment values and authenticated Convex CLI production access. Its production call accepts only canonical assignments in the repository's `.env.local`, rejects deploy-key, deployment-token, and self-hosted selectors there, and strips every inherited `CONVEX_*` variable before starting the CLI; any Convex CLI warning blocks the report.

This gate verifies registry identity, tenant ownership, recorded source metadata, storage-key shape, and public derivative availability. Receipt schema v2 preserves the SHA-256 that the transfer runner computed from the exact downloaded Sanity bytes immediately before upload. It does **not** claim target-side cryptographic byte equivalence because the current media registry does not independently persist or attest that digest after transformation. Adding target-side digest attestation is a separate cross-boundary media change. Reports deliberately use `registry-verified-*` status names until that stronger provenance exists. Keep Sanity authoritative until the later preview, parity, provider-drill, and rollback iterations are complete.
