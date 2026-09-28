# Convex/R2 website content export

Queen Worm implementation with a resumable operator command and an optional bounded dashboard download. The Convex query, shared Admin package and CMS media Worker routes must be reviewed and deployed before a live run. The CMS Worker routes are deployed as version `96da5935-554f-489b-856f-68451e7e36b9` (Worker PR #116). Health returned 200 and unauthenticated export returned 401. Backend/package/host rollout remains pending. No live export or client delivery has been performed yet. Keep the dashboard option disabled until its staging verification passes.

## Included scope

The operator command exports current saved drafts and published revisions of page/site content, portfolio galleries, products, posts, authors and categories. Archived/hidden content retains its labels. Revision IDs, ordered relationships, captions/credits, alt text, product options and integer-cent prices remain in JSON. Option codes retain their source meanings; destination-specific conversion is migration work.

All ready registered web assets are included, including unused assets. Their files are normalized WebP masters, not camera originals. Retained verified private print originals and paid digital ZIP files are included. Deleted/deleting files and unfinished private uploads appear as exclusions; a current content reference to an unavailable file blocks completion. Unregistered/orphan storage, deleted content, historical revisions, CRM/customer delivery records, financial documents, credentials and shared application code are outside this package. External links remain in authored content and are listed by location as not downloaded.

## Authority and rollout

- `contentExport:page` resolves stored canonical tenant identity and requires site-admin or platform-creator membership on every query. It uses allowlisted projections, tenant indexes and immutable current revision IDs.
- `POST /v1/content-export/asset` is an operator transport using the existing tenant CMS media bearer. This adds private-file read capability to that server-only credential. Browser-origin requests are rejected. The route accepts only a validated site/kind/asset identity and constructs the exact private storage key; it accepts no bucket/key/URL arguments.
- Publish/deploy the coordinated backend and Worker changes before live use. Package generation alone does not deploy them. The operator command uses the published Admin content-export core. The optional Queen Worm dashboard mounts its shared authenticated POST handler only after verification.
- Nothing in this tool publishes, offboards, deletes or emails content. Archive delivery requires a separate verified recipient and owner instruction.

## Dashboard download

The host opts in with `api.contentExport.page`, `contentExportEndpoint`, the shared `createContentExportHandler()` POST route, and its existing site-admin/token/CMS Worker configuration. A request accepts no content, tenant, file or URL selections. It reads inventory, asks the Worker to inspect retained files, creates the portable metadata using the same pure core as the operator command, and asks the Worker to build/reopen/hash a ZIP. The host verifies the archive checksum and unchanged inventory before returning a download. The browser supports cancellation and an explicit download link; nothing is emailed or persisted server-side.

The immediate path is limited to 16 MiB per finished ZIP, 100 media files, 250 inventory records and 1 MiB metadata. Preparation stops after 180 seconds at the host or 150 seconds at the Worker. Worker archive buffers are serialized per isolate through response completion/cancellation; overlapping requests receive a retryable response. Larger sites use the operator command below, without changing the free basic-export scope. These limits are errors, never truncation.

## Run

Requires Node 24, the existing Angels Rest dependencies, and Python 3. The ZIP64 writer uses Python's standard library and streams bytes; no new production dependency is required.

Store the following configuration in an owner-only file **outside Git**. Fill it locally; never paste credentials into chat or shell arguments. Use the canonical stored site hostname and a current Better Auth Convex JWT for the authorized owner/site administrator, plus that site's CMS media Worker credential. Endpoint values must be HTTPS origins.

```json
{
  "siteUrl": "",
  "convexUrl": "",
  "workerUrl": "",
  "token": "",
  "workerSecret": ""
}
```

From the Angels Rest repository:

```zsh
chmod 600 /private/path/export-config.json
node scripts/content-export.mjs /private/path/export-config.json plan
node scripts/content-export.mjs /private/path/export-config.json export /private/path/new-queenworm-export
node scripts/content-export.mjs /private/path/export-config.json resume /private/path/new-queenworm-export
```

`plan` performs read-only metadata inventory and estimates file bytes. It does not prove object availability. `export` requires a new output directory; it refuses an existing directory. The root directory is private (0700), metadata/media files are private, and symlink paths or output inside a Git checkout are refused. Do not run concurrent commands against one output directory. A hard-killed process can leave `.export-lock`; verify that process has stopped before removing that empty lock directory manually.

A run streams one file at a time, verifies byte counts and source checksums where available, and checkpoints completed file hashes. Resume rechecks completed files, rejects a changed source fingerprint, and never replaces different existing content. Renew expired credentials in the protected config; credentials are not checkpointed. A changed source requires a new export directory. Incomplete directories are private working data, not handoffs.

The exporter rereads the full inventory after media copies and again after archive verification. A source change blocks final completion. It creates a ZIP64 archive, reopens every entry, verifies sizes and SHA-256 hashes, and only then renames it to `content-export.zip` and writes `receipt.json`. `content-export.partial.zip` is never a completed handoff. An interrupted run after the final rename may have a verified archive but no receipt: inspect privately and start a fresh run rather than assuming success.

## Package layout

```text
content-export.zip
  README.md
  manifest.json
  content/content.json       # typed site/page/post/author/category documents
  content/portfolio.json
  content/products.json
  media/web/<asset>/master.webp
  media/print/<asset>/original.jpg|png
  media/digital/<asset>/original.zip
  reports/media-inventory.csv
  reports/exceptions.json
```

Empty content families are omitted. `mediaPath` and `seoOgImagePath` are relative to the package root; source asset IDs remain available. The manifest includes tenant identity, source fingerprint, creation time, counts and per-file checksums. It excludes bucket names, storage keys, signed URLs and actor account details. `receipt.json`, outside the ZIP, records the final archive checksum. Checkpoints are outside the ZIP as well.

Version 1 has explicit fail-closed limits: 20,000 metadata records, 64 MiB projected metadata, 1,000 rows per revision relation, and 100 GiB of media. Parent inventories are fully paginated. A source/transport limit is an error, never truncation. Oversized sites need a deliberately split scope/multipart follow-up; that is not silently supported. Partial handoff approval/delivery is also not implemented: any required missing file blocks completion.

## Local verification

```zsh
node --test scripts/content-export.test.mjs
pnpm exec vitest run packages/crm-api/convex/contentExport.test.ts
```

Worker tests: `npm test` in `gallery-worker`. Synthetic checks cover tenant separation, published/draft selection, pagination, relationships and credits, private-file authorization, streamed archive creation/reopen, interruption/resume, wrong tenant, missing files, corruption, changed source and path safety. A synthetic 32 MiB stream exercises the bounded media path. Live credentials, deployed behavior, and a sample Queen Worm archive still require an authorized staging run before enabling a dashboard button or offering the tool as a completed client service.
