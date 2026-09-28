# Free basic content export — proposed specification

**Client-facing draft. A local Convex/R2 operator implementation and optional bounded dashboard download now exist; see [the runbook](../runbooks/content-export.md) for its exact scope, limits and rollout status. No live client archive or delivery link has been created.**

## Client-facing description

A free basic content export is one organized copy of your available website content and the media files we hold for it. You or your next developer can download the package without purchasing migration assistance.

The package includes your page text, portfolio collections and captions, product information, blog content where used, and an inventory of included media. It includes published content and current saved drafts, clearly labeled. Images and artwork are supplied in the best versions actually retained for your site. A processed web image is not the original camera file; files never uploaded or no longer held cannot be recreated.

The export is a handoff package, not a replacement website. It does not include installing your site elsewhere, converting it to another platform, rebuilding the design, or replacing Angels Rest's CMS, CRM, checkout and gallery services. Those tasks can be quoted separately. Website source code and custom design deliverables follow your project agreement.

## Recommended contents

| Content | Include in the free basic package | Notes |
| --- | --- | --- |
| Site settings and page copy | Yes | Public branding, links, About/Contact/Modeling content; no credentials or internal platform configuration |
| Portfolio collections | Yes | Titles, slugs, order, captions, alt text, photo credits, visibility and media relationships |
| Products | Yes | Descriptions, prices/currencies, variants/options, publication status and media references; no orders or payment credentials |
| Blog posts, authors and categories | Yes, where used | Structured text, relationships and images |
| Current drafts | Yes, separately labeled | Unsaved browser changes cannot be exported |
| Website images | Yes | One best retained file per asset by default, including images currently referenced by exported drafts/content |
| Client-uploaded product artwork and digital source files | Yes, when owned/authorized and retained | Private originals require authorized storage access; never use public URLs as a substitute for private-file authorization |
| Unused library media | Include available ready assets in the agreed inventory | Avoid leaving a client's uploaded work behind merely because it is not published; deleted/unfinished/unknown objects are reported separately |
| Historic revisions | No, by default | Current content and drafts are the basic scope; discuss a separate history request rather than silently deleting it |
| CRM contacts, inquiries, private customer-delivery galleries, invoices, quotes and contracts | Not in the basic website-content package | Separate confidential business-data handoff, with explicit recipient/scope verification; exclusion is not a claim that the client cannot obtain their data |
| Passwords, tokens, API keys, platform logs and other tenants' data | Never | Not website content |
| Shared Admin/CRM backend, provider accounts and package access | No | A content export does not transfer these services or licensing rights |

## Example download

```text
client-content-export-YYYY-MM-DD.zip
├── README.md
├── manifest.json
├── content/
│   ├── site-settings.json
│   ├── pages.json
│   ├── portfolio.json
│   ├── products.json
│   ├── posts.json
│   ├── authors.json
│   └── categories.json
├── media/
│   ├── web/ASSET_UUID/master.webp
│   ├── print/ASSET_KEY/original.jpg
│   └── digital/ASSET_KEY/original.zip
└── reports/
    ├── media-inventory.csv
    └── exceptions.json
```

Only include content types the site uses. Empty files are unnecessary. JSON is the authoritative structured export; CSV is a convenient inventory, not a lossy replacement for product relationships or structured page text. Keep original names as metadata while using validated, collision-resistant archive paths.

`manifest.json` records the export format version, canonical tenant/site, creation time, included scope, source document/revision IDs, relative file paths, content types, byte counts and SHA-256 checksums. Do not include private bucket names, credentials, signed URLs or the exporter's account details. Content references point to package-relative media paths; any external links that cannot be packaged are explicitly listed.

`README.md` explains the package, publication/draft labels, file formats, media limitations, counts and verification. `exceptions.json` lists missing, unreadable, deleted, unfinished or excluded items with reasons. A required missing file blocks a complete-success result; the owner must resolve it or explicitly approve a clearly labeled partial handoff.

For a large site, use numbered archives plus one manifest rather than buffering the entire export or silently truncating it. Agree the resulting package size before secure delivery. Expiring delivery links are separate from the 90-day retention period.

## Recommended first implementation

Start with an **operator-run export command**, not a public endpoint or a dashboard button. This keeps the first version small while establishing a reusable, tested export boundary.

1. **Plan without writing data.** Accept a tenant identity and explicit scope. Authenticate the platform owner/site administrator and resolve the stored canonical tenant. Enumerate paginated content and ready media through dedicated, allowlisted export projections. Report expected counts, bytes, exclusions and blockers. Never export a whole shared Convex deployment.
2. **Capture current state.** Record exact immutable revision IDs, relations and asset identities. Use a defined source fingerprint and recheck it before declaring success. If content changes or a referenced item is deleted during export, abort/retry or report an explicit partial result. Requesting an export must not offboard the site or change its publishing state.
3. **Fetch files safely.** Use tenant-scoped storage authorization, exact validated keys, streaming copies, bounded concurrency and resumable checkpoints. Do not scrape public image URLs or copy another tenant's prefix. Verify actual bytes against declared size/checksum when available, and calculate an export checksum for every file.
4. **Build and verify locally.** Create the normalized JSON and manifest, reconcile all expected items, check every internal reference, validate archive paths against traversal/collisions, reopen the archive and verify checksums. Keep temporary output private and outside Git; clean up interrupted runs deliberately.
5. **Deliver separately.** The owner approves the recipient and package before sharing through an authenticated or expiring private link. Do not automatically email the archive or create a public bucket URL. Record a sanitized completion receipt, not the customer's files or credentials, in operational evidence.

The export projections should preserve portable content fields rather than exposing raw tables wholesale. Queen Worm's content source is Convex plus managed media; Reflecting Pool still uses Sanity for public content, so it needs its own source adapter. Both can produce the same package format without pretending their source schemas are identical.

The implemented dashboard path reuses the operator command's portable inventory/package core. It prepares small exports on demand with cancellation, integrity checks and an explicit download link (16 MiB, 100 media files, 250 inventory records, 1 MiB metadata). Larger exports remain operator-assisted. Persistent asynchronous jobs and expiring delivery links remain a future option; they are not required to offer the free export.

## Acceptance checks before offering it to a client

- Two synthetic tenants prove isolation for every exported content/file category.
- Pagination proves completeness beyond a single page and reports source caps as blockers.
- Published content, current drafts, hidden items, unused assets, structured products and media credits survive the handoff.
- Original/private files, normalized web images and absent originals are distinguished accurately.
- A missing object, wrong tenant, checksum mismatch, expired authorization, interrupted transfer or concurrent edit cannot produce a falsely complete export.
- Exports containing large files stay within bounded memory; reruns do not duplicate or overwrite unrelated output.
- Unzip/reopen verification succeeds, every packaged media reference resolves, and the manifest matches the final bytes.
- The package contains no auth credentials, unrelated customer records or other tenants' data.
- A sample package is understandable without Angels Rest, and the client-facing description matches what the tool actually delivers.

## Service terms still to approve

Recommended defaults: published content plus current drafts; all ready website-library media and retained client-owned product source files; no historical revisions or confidential CRM/delivery records in the basic package; one standard package per departure with correction of export defects included. A client may request a smaller scope.

The free export covers the standard handoff. Destination imports, transformations, setup, coordination and verification on the new host belong to the proposed $300 migration-assistance allowance or a separate approved quote. Do not charge a rebuild fee merely to provide an already-supported standard export.
