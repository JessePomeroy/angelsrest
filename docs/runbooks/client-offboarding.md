# Client offboarding and deletion

Implemented locally; no client has been offboarded and no production record has been deleted by this work.

## Owner policy

The owner chose a default retention period of **90 days**, with an explicit option to begin deletion immediately. Expiry makes deletion eligible; it never starts an automatic purge. Payment history, accepted/converted quotes, signed contracts, and audit/protocol records remain protected. This is an application policy, not a claim about statutory retention requirements.

## Dashboard workflow

Open **platform → client details → offboarding**. Type the exact site before acting.

1. **Take site offline and disable access** immediately blocks the public website and records the actor and a 90-day retention deadline. Existing tenant identities and invitation reclaim can no longer authorize tenant administration. New contact intake and new checkout snapshot reservations are refused. The creator retains access to administer cleanup. The underlying Better Auth account is not deleted: identities can belong to multiple sites.
2. Complete provider shutdown before declaring offboarding complete: cancel the platform billing subscription at its provider; revoke the site's CMS/gallery/upload credentials and host integration credentials while preserving other tenants; account for outstanding capabilities and operations; disconnect hosting/domain/service integrations as appropriate. These provider actions are **not automated** by the dashboard button. Historical payment and supplier ownership bindings must remain available for paid work/refunds.
3. Keep records until the displayed date, or check **erase eligible records before the 90-day period ends**. Confirm **erase eligible CRM records** to record the erasure decision and remove inquiries, email templates, quote presets, contract templates, disposable quotes/contracts and invoices in pages of 50. Accepted/converted quotes, signed evidence and payment-linked invoices are retained. The result reports deleted/retained counts. A failure can leave completed pages deleted; retry safely resumes by scanning remaining records.
4. Separately clean editorial content, products and media using their reference-checked workflows. Offboarding's CRM cleanup does not claim to erase all tenant data. Keep photography-client identities still needed by retained documents, site/tenant routing identities, order/fulfillment history, audit logs, storage tombstones and upload/deletion journals.
5. Once erasure is requested, the automatic restore-access button is refused. Before erasure, **restore site and client access** restores platform permission only; it does not restore provider settings changed outside the platform.

## Content history

Open **blog → manage content history → refresh / first page**. All three document types (posts, authors, categories) are available. Review revisions to delete an inactive revision. Active draft/published revisions and revisions used as restore provenance are protected.

Archive before **permanently delete**. Purge removes the complete document payload graph, subject to a 1,500-row transaction bound and incoming reference checks. Delete referring posts/history before removing their authors or categories. Files require separate library cleanup. A minimal archived header and slug history remain to reserve the identity/URLs; restoration and reuse of the old document key are refused. Fixed site pages cannot be purged through this action. An individual inactive fixed-page revision may be pruned through the authenticated backend API; no generic history viewer for fixed pages is added here.

## Unregistered web media

The operator tool `scripts/cms-orphan-cleanup.mjs` inventories both storage buckets through `/v1/assets/orphan-inventory`, following every cursor. It returns candidates, not a proof that files are unreferenced. Only exact known web-media object paths at least 24 hours old are candidates; private catalog originals and unknown storage keys are excluded.

Prepare a protected JSON configuration file (mode 0600) containing `siteUrl`, `convexUrl`, `workerUrl`, an authenticated site-admin/creator `token`, and that site's `workerSecret`. Source these from the authorized credential store; do not put values in command arguments, chat or the repository.

```zsh
node scripts/cms-orphan-cleanup.mjs /secure/path/cleanup.json inventory
node scripts/cms-orphan-cleanup.mjs /secure/path/cleanup.json delete ASSET_UUID --confirm EXACT_SITE
```

Inventory does not mutate anything. Explicit deletion first commits a Convex orphan fence only if no registered media row exists. Registration checks the same fence, preventing a delayed response from recreating the media record. The Worker rechecks every known object's age and active processing leases before using the existing bounded storage-deletion protocol. A storage failure leaves the fence for a safe retry on the same UUID. Do not clear the fence to force registration; re-upload under a fresh UUID instead.

The tool uses credentials already available to an operator; no new production secret or automatic bucket sweeper is introduced. It does not revoke provider credentials or remove unknown object layouts.

## Remaining boundary

This release does **not** implement a single-button complete tenant/account erasure or automatic provider deprovisioning. It provides explicit access suspension, a recorded retention/early-erasure policy, guarded CRM deletion, content-history cleanup and orphan media cleanup. Full offboarding still requires the provider shutdown and per-domain cleanup above. Never call a client fully erased merely because the CRM cleanup finished.

The owner chose immediate public-site shutdown. The shared public-content queries return no published content for offboarded tenants, including retained aliases. Queen Worm and Reflecting Pool mount the shared host gate, which checks availability on every public request and returns a no-store 503 when disabled or unavailable. Admin/auth and explicitly preserved customer-service routes remain available. Restoring access before erasure also restores the public site. The creator may sign into an offboarded client dashboard for per-domain cleanup; this does not reclaim an invitation or restore the client's permission.


Deployment order matters: publish the shared Admin/CRM packages and deploy the backend contract before adopting the host hooks. Configured hosts fail closed if the availability API is missing. Do not cache successful availability reads or public HTML/data responses; clear preexisting CDN caches when enabling the gate. Static assets and already-downloaded pages/files cannot be retracted by a SvelteKit hook. Direct public media/CDN URLs and provider credentials require their own shutdown controls; this feature takes the website and public data APIs offline, not a storage bucket private.

Reflecting Pool's public content is still Sanity-backed, so its host gate is required in addition to the Convex read guards. Other future clients must mount the same gate; installing the package alone does not enforce shutdown on their host.
