# Catalog cleanup rollout and recovery

Coordinated rollout is in progress. Shared Admin PR #246 and CMS Worker PR #116 are merged; the CMS Worker is deployed as version `96da5935-554f-489b-856f-68451e7e36b9` with existing variables, credentials and container deployment preserved. Admin 6.5.0 is published (release PR #247, workflow 36431928302). Shared Convex deployment, CRM API 6.3.0 publication and host adoption remain pending. Confirm published versions before adoption.

## Deploy in dependency order

1. Review the coordinated Admin, Angels Rest/CRM API, CMS Worker and Queen Worm changes. Preserve the shared Convex schema and tenant registries; do not provision a spoke backend or rotate credentials.
2. Publish the reviewed shared Admin release. The host imports its new `createCatalogPrivateDeleteHandler` only after publication; pin it with the host's package manager. Publish/adopt the CRM API release before updating Queen Worm's generated API dependency.
3. Deploy the reviewed shared Convex schema/functions and CMS Worker before enabling host cleanup controls. Backend code introduces deletion fences, product tombstones, manifest/complete HTTP actions and expiry/reference checks. Worker code adds `/v1/catalog-assets/delete`; the regular gallery Worker is unchanged.
4. Update Angels Rest and Queen Worm to the released packages and deploy their prepared route/configuration changes. Preserve Queen Worm's staging target and closed checkout. Reflecting Pool has compatibility evidence only; its capabilities are not changed here.
5. Use one designated synthetic unused file and product for a separately approved live smoke check: save → unpublish if necessary → delete unused product → clean up file → retry → verify no bytes or public product remain. Also prove a referenced file and another tenant's identity are refused. Never use a customer order or real artwork as the deletion fixture.

## Host wiring

- Configure `api.catalogPrivateAssets.listForCleanup`, `listExpiredUploadsForCleanup`, and `requestDeletion`.
- Configure optional `catalogProducts.remove`, `catalogProductGraphs.remove` and `inquiries.remove` references as supported by the host.
- Mount `createCatalogPrivateDeleteHandler()` at `/api/admin/catalog-private-assets/delete`, using the existing site-admin verifier and fresh authenticated Convex transport. Queen Worm additionally wraps it with `withSiteAdmin`.
- Set `editor.products.privateAssetDeleteEndpoint` and `mediaDeleteEndpoint`. Supply `portfolioEditor.requestDeletion` and mount the existing `createCmsMediaDeleteHandler()` at `/api/admin/media/delete`.
- Reuse the host's own `cmsMediaWorkerUrl`, `cmsMediaTenantSecret`, `cmsMediaConvexSiteUrl`, and `cmsMediaDeletionCompletionSecret`. Keep these server-only. Existing tenant credential separation remains mandatory.
- Mount the new route on Node with at least a 60-second maximum. The adapter bounds JSON bodies and uses a 45-second upstream budget with individual request timeouts.

## Operator behavior

Open **products → manage uploads**. Web media, private print masters and paid files are distinct file types. The expired-upload checkbox shows eligible unfinished private-editor uploads, including files that never received an asset record. Save edits before cleanup; unsaved selections do not reserve files.

Deleting an unused product removes its product/variant/media-relation graph, not its files. An unpublished product retained by an order or checkout is refused. Cleanup of a file still referenced by any product revision is refused. Upload and deletion journals remain after file bytes are erased.

A failed storage/completion request is retryable on the same target. A `deleting` record prevents new references. Do not bypass it, clear it manually, delete an R2 tombstone, or force completion without storage proof. Investigate the relevant host/Worker response and retry the same manifest.

A rollback must preserve backend deletion checks and Worker tombstones after any cleanup has executed. Rolling back only the UI is safe; rolling back backend reference fencing or allowing overwrite of private keys is not. Retained markers are required replay protection, not orphaned objects.

## Known bounds and exclusions

Cleanup stops rather than truncates if the tenant has over 500 orders/reservations or the product has over 1,500 graph rows. This needs a separately reviewed indexed retention implementation for larger tenants. The feature does not purge paid-order assets, journals, account history, derived fulfillment objects, or arbitrary unregistered web-upload objects from storage.

No live deletion is authorized merely by enabling this feature. The owner still confirms each destructive UI action. See [the audit and verification record](../reviews/catalog-deletion-audit-2026-09-28.md).
