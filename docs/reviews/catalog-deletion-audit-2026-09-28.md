# Catalog and content deletion audit — 2026-09-28

Scope: a focused deletion/retirement inventory and implementation review across Angels Rest, the shared Admin package, CMS/gallery Worker, and Queen Worm. This is local engineering evidence, not deployment or live-deletion approval. No customer files were deleted during this work.

Bases: Angels Rest `46944d9`, Admin `356474a`, gallery-worker `630eb2c`, Queen Worm `883379f`. Changes are on local `feat/catalog-cleanup` branches. Reflecting Pool was checked as an unchanged consumer of the additive Admin package.

## Findings and disposition

| Surface | Before this change | Disposition |
| --- | --- | --- |
| Private print masters and paid digital files | Upload, verify and attach existed; no supported removal of their stored bytes | Added reference-checked cleanup with a durable deletion fence, server-only manifest retrieval, storage tombstone and retryable completion |
| Expired private-editor uploads without an asset record | No cleanup entry point after failed/abandoned upload | Added paginated discovery and cleanup after the 24-hour continuation lifetime plus skew, expiry of every capability, and absence of a live inspection/storage lease |
| Abandoned catalog products | Discard removed the draft pointer but left the product and every revision | Added explicit removal of an unpublished product and its graph only when no order or checkout snapshot retains it; uploads remain separate cleanup targets |
| Historical catalog web media | Existing CMS deletion checked active pointers only; a retained historical graph could lose required web media | All catalog revision references now block web-media deletion; removing an unused product releases its references |
| Queen Worm CMS media | Shared deletion handler existed, but the host route and request-deletion capability were absent | Mounted `/api/admin/media/delete` and supplied the existing reference |
| CMS media management UI | Storage handler was available without a shared library cleanup control | Product header now opens an upload cleanup dialog for web media and private files |
| Inquiries | Only new/read/replied status updates existed | Added site-authorized remove mutation and a confirmed UI action; status changes and deletion cannot run concurrently in the same view |
| Portfolio galleries | Remove mutation and bounded revision cleanup exist | Existing supported lifecycle retained |
| Private delivery galleries and images | Scoped single/bulk storage deletion and metadata removal exist | Existing supported lifecycle retained |
| CRM clients, quotes, contracts, templates, tags and board columns | Remove/delete mutations exist | Inventory checked; these existing domains were not comprehensively re-audited |
| Invoices with payment history | Remove deliberately refuses payment/checkout-linked invoices | Retention preserved; cancellation is the supported action |
| Blog documents and fixed site pages | Archive/unpublish or draft discard rather than indiscriminate hard deletion | Existing content lifecycle retained |
| Orders, refunds, email journals, upload receipts and platform accounts | Financial/audit retention or operator-controlled lifecycle | No blanket deletion API added. Account offboarding and bulk historical purges need their own retention requirements |

This does not inventory arbitrary bucket objects or implement general storage garbage collection. In particular, web uploads abandoned before CMS registration have no registry ID for the existing library deletion route; a provider-side orphan reconciliation workflow remains a separate gap. Derived fulfillment artifacts and receipt/audit history are deliberately outside manual file cleanup.

## Safety contract

- Every public mutation derives permission from stored site membership. IDs and file kinds are validated; browsers cannot choose storage keys or tenants for host requests.
- The public private-file deletion mutation returns only status and a deletion ID. Private object keys and hashes are obtained by the host through a tenant-authenticated server endpoint, never projected to the browser.
- A backend deletion fence is committed in the same transaction as reference checks. Asset selection and receipt materialization/replay refuse fenced assets. Both active and historical product references block file removal.
- Product removal checks orders and checkout reservations transactionally. A product tombstone prevents a delayed checkout/order request from recreating a reference after removal. Raw frozen print-production descriptors separately protect their private object keys.
- Cleanup refuses histories exceeding 500 orders or 500 checkout reservations per tenant, or 1,500 graph rows for a product. These are fail-closed bounds, not truncated proofs of safety. Larger histories require an indexed retention workflow before cleanup can proceed.
- The Worker replaces the exact original with a zero-byte tombstone using an ETag conditional write (or `If-None-Match: *` for an absent key). All existing private uploads also use `If-None-Match: *`; a stale upload cannot recreate erased bytes. The tiny marker, registry metadata and audit journals remain intentionally.
- Storage failure or lost responses leave a retryable backend fence. Completion occurs only after the exact storage identity is acknowledged. Repeating cleanup is safe.
- Web cleanup reuses its existing tenant-scoped closed manifest and storage-operation lease protocol. Shared/current media and historical catalog media remain protected.

The storage conditional behavior follows [Cloudflare's R2 Workers API contract](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#conditional-operations). The tests exercise races/replays with local storage fixtures; no live object deletion was performed.

## Verification

- Shared Admin: `pnpm check`, `pnpm build`, and all 959 tests passed, including cleanup selection, cancellation, failure/retry, busy controls and host authorization/manifest/completion checks.
- CMS/gallery Worker: all 1,086 tests and the complete typecheck pipeline passed. New cases cover both asset kinds, incorrect identities, missing objects, failed writes, lost responses and rejection of an old upload capability after cleanup.
- Angels Rest: type check, all 2,858 default Vitest tests, 27 protocol tests and the canonical script tests, and production build passed against locally packed Admin/CRM candidates. Targeted backend tests cover retained orders/checkouts, shared assets, stale product revisions, tenant isolation, expiry/leases, completion authority, safe bounds and delayed checkout rejection.
- Queen Worm: type check, 55 unit tests and production build passed against the same local candidates.
- Reflecting Pool: type check passed against the candidate Admin with its existing CRM/package versions. No Reflecting Pool feature activation or dependency change is included.
- Real Chromium fixture at 1440px and 390px: open cleanup, select type, select expired uploads, cancel without a request, confirm and remove the row; no page errors or horizontal overflow. Provider operations were replaced with exact synthetic responses. This is UI proof, not a live deletion smoke test.
- Initial verification exposed expected API/retention assertions and fixture setup problems. Direct source linking mixed Vite versions; packed artifacts with each consumer's normal dependency context fixed that. The handbook intentionally disables fetch, so the UI check uses an explicit synthetic cleanup responder. Mobile originally hid cleanup in the overview pane; the header dialog fixes that reachable defect.

Generated Convex bindings were refreshed with the package-scoped code generator. No Convex deployment, Worker deployment, package publication, live cleanup or payment activation has been performed. Consumer manifests still pin released versions; the prepared host changes require the candidate releases before normal CI/delivery.

## Rollout and design records

See [the rollout runbook](../runbooks/catalog-cleanup.md). The new shared cleanup dialog needs a Paper handbook entry and comparison; local captures are recorded separately. Paper boards have not been updated in this session because no Paper editing tool is available. Do not mark their sync complete.

## Follow-up: remaining deletion gaps

The owner requested follow-up implementation and selected 90-day default retention with explicit immediate erasure. The local change now also includes:

- `quotes.remove` refuses accepted/converted history, even after a status change; `contracts.remove` refuses signed status or any retained signature evidence. Invoice deletion additionally respects paid status/timestamps.
- `contentCleanup.list`, `listRevisions`, `pruneRevision` and `purgeArchived`, with shared Blog history controls, tenant checks, exact revision ownership, optimistic concurrency and restore/reference protection. A purged header remains a permanent identity/URL reservation.
- `mediaAssets.requestOrphanDeletion`, a transactional registration fence, Worker `/v1/assets/orphan-inventory`, a 24-hour storage-age/lease gate, and the operator `scripts/cms-orphan-cleanup.mjs` workflow. Generic unknown bucket objects remain outside its scope.
- `platformOffboarding.getState`, `disable`, `restoreAccess`, `requestErasure`, `eraseRecords`, and `isActive`. The platform client dialog exposes exact-site confirmation, the 90-day policy, an explicit immediate-erasure choice, and paginated eligible CRM-record deletion. Existing client access and invitation reclaim are refused while offboarded; creator cleanup remains authorized. New intake and checkout reservations stop; historical payment processing remains intact.

**Scope boundary:** automatic provider credential/billing/hosting revocation and complete tenant/Better Auth account erasure remain unimplemented. Offboarding UI and the [runbook](../runbooks/client-offboarding.md) explicitly identify them as separate required operations. Eligible CRM cleanup is not presented as complete account erasure. The new shared controls also need Paper sync; the current session has no Paper editing tool.

Follow-up verification: shared Admin 961 tests; CMS/gallery Worker 1,091 tests plus full typecheck and dry-run bundle; Angels Rest 2,865 default tests plus 27 protocol tests and script checks; Queen Worm 55 tests; consumer checks/builds and Reflecting Pool compatibility passed with locally packed candidates. Final invoice-link protection passed the 21-test retention/invoice subset; final creator cleanup-access correction passed the 15-test offboarding/tenant-isolation subset and CRM TypeScript. The orphan operator tool's three offline tests passed. New controls were inspected at desktop/mobile sizes using synthetic data. No live deletion, account suspension, provider change, publication or deployment occurred.

The owner subsequently chose immediate public-site shutdown. Shared public-content read guards and a reusable host availability gate are now prepared, including Queen Worm and Reflecting Pool host wiring. This does not revoke previously downloaded copies, public CDN object URLs or provider credentials.

The immediate-offline implementation gates the shared published settings/pages, portfolio, blog/slug resolution and product catalog reads, and refuses new catalog checkout resolution. Host hooks are prepared for Queen Worm and the Sanity-backed Reflecting Pool. The platform owner/hub cannot be offboarded. Existing private recipient/delivery routes are explicitly preserved rather than blocking historical obligations. Positive availability and public responses are not cached; unknown configured availability fails closed. Storage/CDN URLs and already-delivered copies remain separate from website shutdown.

Immediate-offline follow-up verification: shared Admin 978 tests; Angels Rest 2,867 default tests plus 27 protocol tests; Queen Worm 55 tests; checks/builds passed with packed candidates. Reflecting Pool checks/build passed and 248/249 tests passed; its sole failure hard-codes the currently pinned Admin 3.41.6 version while the temporary candidate is labeled 6.4.0. Update that assertion together with the approved released package pin; it is not a runtime regression and was not weakened for this check. Queen Worm's actual server returned 503/no-store for a public route and checkout, while `/admin` returned 200, against a local synthetic inactive-tenant backend at desktop/mobile sizes. Test processes were stopped and package links restored. Nothing was deployed or offboarded live.

Client communication drafts now live in `docs/client-guides/`: hosting/migration policy, a pricing decision note ($300/up to three hours, proposed only), and the free basic-export specification. The Convex/R2 operator exporter and optional bounded dashboard download are implemented locally; see `docs/runbooks/content-export.md` for limits, verification and rollout status. No live client archive or delivery has been created yet.

## Release verification checkpoint

Current release checks: Admin 989 tests and zero-error/warning Svelte check plus package build; CMS Worker 1,112 tests, full typechecks and CMS dry-run; Angels Rest lint, Svelte/CRM checks, 2,872 default tests, 27 protocol tests, operator script tests and production build. The operator archive suite has 12 cases; the Worker archive suite includes a 15 MiB archive plus active-read/stalled-open cancellation and concurrent buffer guards. Independent cleanup and exporter reviewers found no remaining confirmed defects.

Admin feature PR #246 and Worker PR #116 are merged. Worker version `96da5935-554f-489b-856f-68451e7e36b9` is deployed; health and unauthenticated export refusal were verified over IPv4. Package publication and backend/host rollout are still tracked separately. No live deletion, offboarding or client archive has been performed. Reflecting Pool remains outside this release/adoption work.
