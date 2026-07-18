# Angels Rest Blog media mapping

This directory is the versioned migration journal for the published Sanity Blog image set.

- Keys are immutable Sanity image asset references from the published `n7rvza4g/production` dataset.
- Values must be the matching tenant-owned Convex `mediaAssets._id`, never the media Worker UUID.
- Blank values have not been transferred or verified.
- Factual alt text remains a separate guided review requirement; a media mapping does not satisfy it.
- `sanity-blog-media-transfer-receipts.json` records the source facts and both identities observed during each completed transfer. It contains no upload capability, storage key, session cookie, or secret.

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

This gate verifies registry identity, tenant ownership, recorded source metadata, storage-key shape, and public derivative availability. It does **not** claim cryptographic byte equivalence between a Sanity source and its transformed CMS asset because the current media registry does not persist a target-side source digest. The next transfer runner must compute and checkpoint a source SHA-256 before upload; adding target-side digest attestation is a separate cross-boundary media change. Reports deliberately use `registry-verified-*` status names until that stronger provenance exists. Keep Sanity authoritative until the later preview, parity, provider-drill, and rollback iterations are complete.
