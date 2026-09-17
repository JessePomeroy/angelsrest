# Owner delivery-gallery file uploads

Angels Rest's stored creator membership can upload arbitrary file types to its
private delivery galleries. Other website clients retain the existing photo,
RAW, TIFF and video extension set. MKV remains a downloadable video format;
this change adds no transcoding. Unknown types such as ZIP, PDF, project files,
HTML, SVG and extensionless originals are uploaded as binary attachments.
Empty files and unsafe filenames remain rejected. Multipart upload, selection,
favorites and existing downloads are reused; this is file delivery, not folder
synchronization or a malware-scanning service.

## Authority

- Convex `galleries.getUploadPolicy` checks authenticated stored membership and
  both the Angels Rest site and `creator` role. No browser-provided role, site
  label, billing tier, or email string grants expanded access.
- The host independently calls that query before issuing an upload session.
  The existing four-hour signed session includes the resolved policy. Old
  sessions and hosts without the optional resolver stay on `media`.
- Presign forwards only the signed/server-resolved policy. The Worker signs
  it into an expiring, exact-key/size/MIME capability and independently rejects
  expanded privileges outside Angels Rest on PUT and multipart redemption.
  Owner file tokens allow up to 24 hours for large uploads, as video tokens do.
- Arbitrary files have no inline image endpoint. Attachment downloads keep the
  existing gallery token, password grant and download-enabled checks and add
  `nosniff`. No storage bucket is made public.

## Release order

Source changes alone do not activate the feature. This local implementation
does not publish packages, deploy either service, update roles, or change
Reflecting Pool's installed Admin version.

1. Deploy the additive Convex query and the matching gallery Worker. Confirm
   the owner account has its existing stored Angels Rest creator membership;
   a legacy/unmarked row intentionally returns `media`.
2. Publish the Admin minor release containing `getUploadPolicy` and
   `resolveGalleryUploadPolicy`. The package defaults remain media-only for
   hosts that omit those optional contracts.
3. Adopt that published Admin version in Angels Rest and deploy the host.
   The host configuration is additive and type-checks before adoption, but
   Admin 6.1.2 does not consume the policy and cannot activate the feature.
4. Start a fresh upload batch/session and verify a fictional ZIP upload,
   download, and client-media rejection. Existing media sessions retain their
   original permission until replaced or expired.

No new secrets, bindings, R2 resources, production dependencies, metadata table
renames, or customer permission UI are required. Future client exceptions need
an explicit change to both policy authorities.

## Local verification

Build/pack the changed Admin checkout and test that artifact in the host without
publishing it or updating consumer version ranges. Point the contract suite at
the matching Worker checkout:

```fish
env GALLERY_WORKER_CONTRACT_ROOT=/absolute/path/to/gallery-worker pnpm test:gallery-upload-contract
```

`GALLERY_ADMIN_CONTRACT_SERVER` optionally selects another installed Admin
`dist/server.js`. Running only the `zippymiggy` test against Reflecting Pool's
current installation verifies that the unchanged spoke still issues media
uploads accepted by the new Worker. All identity/provider/R2 data in this suite
is fictional and in memory; no provider requests or writes are performed.

The normal suites also cover stored identity/role isolation, owner and client
picker behavior, MIME spoofing, signed-policy tampering, cross-tenant rejection,
attachment/download permissions, and desktop/mobile ZIP/MKV file cards.

Verified locally on September 16, 2026: 2,065 host unit tests, 27 host protocol
tests, 82 gallery-delivery package tests, 947 Admin tests, and 1,066 Worker tests
passed. The two cross-repository contract cases passed, as did the unchanged
Reflecting Pool Admin 3.41.6 media case against the changed Worker. All 32
targeted desktop/mobile download and lightbox cases passed; ZIP and MKV captures
were inspected. Host lint, host/package/Worker/CRM API type checks and the Admin
and production host builds passed. The host also type-checks with its original
Admin 6.1.2 dependency restored. The production build retained the existing
optional React Email/platform-specific Sharp tracing warnings.

## Design reference gap

The safe handbook fixture supports `uploadPolicy=media` for the client view and
defaults to the owner view. Open a fictional delivery gallery to inspect it.
The existing list boards and new owner/client uploader states require a Paper
update and comparison. No Paper tool was available during implementation;
the inventory records this gap without marking the boards verified.
