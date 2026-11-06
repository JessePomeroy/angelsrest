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

## Pending generated-contract gate

The existing `_generated/api.d.ts` remains unchanged until separately approved
official component generation is available. Runtime fixture tests discover the
new source module, but they do not establish generated API/type acceptance.
Package and consumer types and exact-head green CI remain required before this
slice can be treated as complete.

The proposed generation action, **not executed**, is the installed official CLI
from `packages/crm-api` at the reviewed source head:

```zsh
pnpm exec convex codegen --typecheck disable
```

The owner must first approve provider access and identify the existing permitted
deployment/authentication context. No credential creation, broader access, or
credential value in chat is part of this action. Do not substitute `convex dev`,
`convex deploy`, a legacy/offline template, system-UDF generation, synthesized
component analysis, a stub or a hand-merged declaration.

The [official codegen reference](https://docs.convex.dev/cli/reference/codegen)
states that this command generates local code without changing running deployed
code. That does not establish an offline operation: the installed component CLI
selects deployment credentials and obtains component analysis. Provider contact
is therefore still a separate gate.

Expected source diff: the generated typed module import and `fullApi` binding for
`clientWorkspace`, preserving the existing Better Auth `components` binding and
all existing API members. Only `_generated/api.d.ts` is released for generated
changes. Review the actual complete generator diff; unexpected files or contract
changes require coordination rather than hand editing output into the expected
shape. After generation, rerun package/host types and the required tests/review/CI
at the exact head. Publication, backend deployment and consumer adoption remain
separate approvals.
