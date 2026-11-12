---
"@jessepomeroy/crm-api": major
---

Remove Convex functions that no current host, shared admin release, client site or Worker calls. Each was checked against the hub, Admin 7, Queen Worm, Reflecting Pool and the gallery Worker before removal.

Deploying this backend requires only that no deployed consumer calls a removed function, which held on 2026-11-11. Installed admin builds 6.16.2 (Queen Worm) and 3.41.6 (archived Reflecting Pool) call none of them. 6.16.2 only binds the `emailLog.create` reference without calling it, so it keeps working at runtime. A host must be on `@jessepomeroy/admin` 7.0.0 or later before it adopts these crm-api 7 types, because admin 6.x's standard API type still names `emailLog.create`.

Removed functions:

- `orders.claimPrintFulfillment`, `claimPrintFulfillmentV2`, `claimPrintFulfillmentV3`, `claimPrintFulfillmentV4`: replaced by `claimPrintFulfillmentV5`. V5 still resumes rows admitted under version 4.
- `orders.completePrintFulfillmentSubmission`: the result path for unversioned claims. Versioned work completes through `reconcilePrintFulfillmentSubmission`.
- `orders.claimAutomatedFulfillmentRefund`: replaced by `claimAutomatedFulfillmentRefundV2`.
- `orders.completeAutomatedFulfillmentRefund`: always threw. Use `recordAutomatedFulfillmentRefund`.
- `orders.claimFulfillmentFailureNotification`: always returned `false`. Replaced by the V2/V3 leased claims.
- `orders.claimShipmentEmailNotification`, `orders.recordShipmentEmailDelivery`, `orders.getByLumaprintsOrderNumber`: deprecated site-admin shipment exports. Shipment intake uses the connection-scoped V2 lease.
- `orders.classifyRefundTarget`: never had a caller after the read-only slice that introduced it.
- `orders.catalogCommerce` (internal): replaced by `catalogCommerceHttp`, which the HTTP route uses.
- `orders.getNextOrderNumber`: order numbers are assigned inside `orders.create`.
- `platform.updateStripeConnectedAccount`, `platform.setStripeConnectedAccount` (internal): always threw. Accounts are bound only through verified onboarding.
- `catalogPrivateAssets.resolveEditorUpload`: no caller. The editor reads verified uploads through the journal status route.
- `catalogProductGraphs.getRetirementEligibility`: no caller. Product deletion uses `remove` and the cleanup listings.
- `commerceClosure.getProtocolCutoffForInventory`: its only callers, the inventory route and script, were retired in #436.
- `crm.listClientsPaginated`: replaced by `listClientsWithTags` and `scanClientsWithTags`.
- `galleries.getBySlug`, `galleries.listByClient`: no caller. Delivery galleries are read by ID, through the site list, or by portal token.
- `galleries.logDownload`, `galleries.getDownloadStats`: no caller, and the `galleryDownloads` table was empty.
- `kanban.getBoardConfig`, `kanban.reorderColumns`: no caller. The board uses `listBoardConfigs` and the other column mutations.
- `mediaAssets.get`, `mediaAssets.listBySite`: replaced by `getManyForEditor` and `listForEditor`.
- `mediaAssets.verifyImportTargets` (internal): a gate for the retired media import. No runner remains.
- `portal.listTokens`: no caller.
- `blogContent.getPublishedBySlug`, `blogContent.resolvePublishedSlug`, `blogContent.listPublished`: no host has author or category pages. Published posts still embed author data.
- `postContent.listPublished`: replaced by `listPublishedPage`.
- `portfolioGalleries.listPublished`: replaced by `listPublishedSummaries`, `listPublishedNavigation` and `listPublishedWithPlacements`.
- `emailLog.list`, `emailLog.create`: Admin 7 no longer binds them. `documentEmailAttempts` still writes the `emailLog` table.

Schema changes:

- Removed the empty `galleryDownloads` table and its two indexes. The `galleryImages.downloadCount` field remains.
- Removed the `orders.by_lumaprintsOrderNumber` index, which only the deprecated shipment exports used.
