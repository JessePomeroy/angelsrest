# Angels Rest Blog media mapping

This directory is the versioned migration journal for the published Sanity Blog image set.

- Keys are immutable Sanity image asset references from the published `n7rvza4g/production` dataset.
- Values must be the matching tenant-owned Convex `mediaAssets._id`, never the media Worker UUID.
- Blank values have not been transferred or verified.
- Factual alt text remains a separate guided review requirement; a media mapping does not satisfy it.

Validate the current journal without importing content or changing providers:

```sh
pnpm cms:blog-import-dry-run -- \
  --image-asset-map scripts/cms/migrations/angelsrest-blog/sanity-blog-image-asset-map.json
```

Every populated value must also be checked read-only against production Convex for the exact tenant, ready status, and Worker asset identity. Keep Sanity authoritative until the later preview, parity, provider-drill, and rollback iterations are complete.
