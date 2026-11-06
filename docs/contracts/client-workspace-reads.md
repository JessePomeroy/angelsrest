# Client workspace reads

`api.clientWorkspace` adds four independent summary queries:
`listInvoices`, `listQuotes`, `listContracts` and `listDeliveryGalleries`.
They compose existing photography-client relationships for a connected workspace.
They do not create a job/session model or change existing list/editor APIs.

## Authority and scope

Each query accepts a typed `clientId` and Convex `paginationOpts`. It accepts no
tenant, website, user identity or provider authority. The existing
`requireDocumentSiteAdminWithClient` derives the site's ownership from the stored
photography client and verifies current stored membership plus CRM permission.
The same stored platform-client policy must also permit the requested area:
invoicing, quotes, contracts or gallery delivery.

Every read uses the collection's existing `by_client` index. Returned rows must
still match both the selected client and its stored site; an inconsistent
cross-site association rejects the page before any summary is returned. Store
order email matches establish no relationship and are not queried here.

The selected client is required to exist and remain authorized on every page.
Removing membership, downgrading the tier, or deleting the client can invalidate
a previously usable cursor. A page from a prior client/session is not fallback
data for a failed read.

## Bounds and projections

Page sizes must be integers from 1 through 50. Each database pagination call
also fixes a 50-row scan bound and a 1,000,000-byte read bound; callers cannot
raise these limits through pagination options. Results retain Convex pagination
fields, including any split status, and add the server-derived `clientId` and
`siteUrl`. Each collection has its own cursor and must be loaded independently.

| Query | Summary fields, in addition to record ID and creation time |
| --- | --- |
| Invoices | Number, type, status, due date and invoice payment balance |
| Quotes | Number, status and validity date |
| Contracts | Title, status, event date and signed timestamp |
| Delivery galleries | Name, status, image count, expiry and proof-submission timestamp |

Invoice balance reuses `invoicePaymentBalance`, including legacy paid settlement
and partial-payment semantics. An invalid or incomplete historical amount returns
`balance: null`, meaning unavailable, rather than a zero balance or a failed
collection. The balance describes that invoice only; partial pages do not provide
a complete client balance or total count.

No document body, line-item/package description, signature, contact email,
portal token, gallery slug/storage key, provider response or claim is projected.
Opening the existing document/gallery surface must authorize an exact-record read
again. These summaries grant no send, payment, refund, fulfillment, publishing or
gallery access capability.

## Consumer and rollout obligations

Loading, error, unavailable capability, an authorized empty page and an incomplete
or split page remain distinct states. Preserve pagination metadata, and do not
interpret an incomplete empty page as a complete zero. Retry split pages through
the existing list-controller policy. Reset cursors when changing clients or
collections; discard late responses from a prior client or identity.

These are additive backend reads. Existing consumers continue using their
existing APIs until an authorized shared Admin/host adoption binds the new
contract. Deploy the compatible backend separately before enabling a consumer;
publish the reviewed minor CRM API release separately before exact package
adoption. Source integration does not authorize any of those effects.

LW-01 includes no Admin UI, HTTP mutation/config changes, Gmail operations,
Worker protocol work, schema changes, record migration or provider calls.
Client-page navigation and rendered acceptance belong to LW-02 after ownership
release and reconciliation of the original thread's CRM save/clear work.

## Generated contract and delivery gates

The owner approved official component generation and explicitly selected the
existing staging deployment `rosy-firefly-366`. Its current dashboard settings
classify it as Production-type with the custom label `staging`; its CLI selector
is therefore `prod:rosy-firefly-366`. This selects the staging backend, not the
live production deployment `loyal-swan-967`.

The installed official CLI succeeded from `packages/crm-api` on November 6:

```zsh
CONVEX_DEPLOYMENT=prod:rosy-firefly-366 CI=1 pnpm exec convex codegen --typecheck disable
```

Only `_generated/api.d.ts` changed: one typed module import and one `fullApi`
binding for `clientWorkspace`. The existing Better Auth `components` binding and
all other API members remain intact; the other six generated files are unchanged.
No declaration was hand edited. The earlier unconfigured attempt stopped with
`No CONVEX_DEPLOYMENT set`; the successful run used the owner's explicit selector
and existing CLI login without creating or copying credentials or persisting an
environment file.

The [official codegen reference](https://docs.convex.dev/cli/reference/codegen)
states that this command generates local code without changing running deployed
code. This is a provider-backed operation: the installed component CLI obtains
deployment metadata and uploads source for component analysis before generating
bindings. Its codegen path returns without the deployment `finishPush` step.
No `convex dev` or `convex deploy` ran. A legacy/offline template, system-UDF
generation, synthesized component analysis, stub or hand merge is not an
alternative to this official generation path.

Generated API/package/consumer checks and required tests must use the actual
generated head. Local fixture success alone is insufficient. Remote PR review
and exact-head CI remain required before slice completion. Hosting-triggering
push/PR and main merge need their applicable effect authorization. Publication,
backend deployment and consumer adoption remain separate approvals.
