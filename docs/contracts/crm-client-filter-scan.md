# CRM client filter scan

`crm.scanClientsWithTags` is an additive, authenticated read for progressively
finding clients beyond the installed Admin's first 50-row snapshot.
`crm.listClientsWithTags` and its callers keep their existing contract.

## Selection and authorization

Arguments select a site, optional category/status, optional `search` and optional
`tagId`, plus native `paginationOpts`. Site selection is not authority: the query
requires stored site-admin membership and the CRM feature before reading client
or tag records. The selected tag must exist in that site; missing and foreign
tags both fail with `Not found`.

Name and email use the existing JavaScript case-insensitive literal substring
matching. Search is not trimmed, tokenized or reordered by relevance. It accepts
at most 200 UTF-16 code units. An omitted or empty search matches every candidate.
Category and status select the existing site-scoped compound indexes before
pagination. Clients keep their descending index order.

Tag membership uses the existing client/tag compound point index and checks the
assignment's stored site. A foreign client or malformed cross-site assignment
cannot supply a match. Membership does not depend on the first 50 displayed tags.
The returned tag projection still uses the existing bounded, site-filtered helper;
it is not a complete tag catalog or proof of selected-tag membership.

## Batches and continuation

The requested candidate batch size must be an integer from 1 through 50. Each
call performs one native indexed pagination operation with fixed candidate limits
of 50 rows and 1,000,000 bytes; callers cannot expand those limits. Selected-tag
point checks and bounded tag enrichment are additional reads, not part of that
candidate byte count. Only surviving candidates receive tag enrichment.

The response preserves native `isDone`, `continueCursor`, `splitCursor` and
`pageStatus` metadata. `page` contains matching clients with bounded tags;
`scannedCount` reports the candidate documents evaluated in that batch, rather
than total database reads or a global result count.

**A short or empty `page` can have `isDone: false`.** This is a candidate scan,
not dense pagination over 50 matching clients. Continue with the returned cursor
and unchanged filters until a match is found or the scan is exhausted. Native
row/byte split metadata must not be converted into a global empty result. The
cursor belongs to its current site/category/status/search/tag selection; changing
any filter starts a fresh scan.

## Consumer and rollout requirements

The subsequent Admin capability must opt in through an optional function
reference. Existing hosts retain their current page-local behavior and notice
until deliberately configured. A generated reference alone does not establish
that the backend function is deployed.

The consumer must:

- Reset its cursor and result ownership when any filter changes.
- Continue empty intermediate batches with visible progress, cancellation and a
  bounded continuation action for long scans; avoid an unbounded reactive journal.
- Show global no-match wording only after exhaustion. Preserve native split
  metadata and distinguish incomplete/failed scans from an empty result.
- Ignore stale completions after filter changes or unmounting; retry the failed
  continuation without silently restarting or losing its ownership.
- Preserve authorized `?client=<id>` opening, detail queries and save recovery
  independently of the list's current filters.

Deploy the additive backend before wiring this capability and adopting the
published Admin consumer. Package publication, backend deployment and host
adoption are separate gates; a frontend deployment does not activate this read.

This slice adds no schema, index, mutation, derived search field or backfill. A
native full-text index would change current substring matching and requires a
different budget/tag-intersection design. The existing 200-tag picker cap is a
separate lookup limit, not arbitrary tag-catalog completeness.

## Verification

Registered Convex tests cover older literal name/email/tag matches through empty
batches, punctuation and significant whitespace, combined indexed filters,
projection-independent tag membership, foreign/malformed relationship denial,
stored identity and CRM authorization, bounds, order/continuation and native
row/byte split metadata. Existing reader tests remain unchanged.

The generated API already imports the complete `crm` module. Verify API/consumer
types and generated-file hashes; do not hand-edit declarations or infer authority
for codegen/provider calls. Local tests establish this source contract, not live
backend availability or a completed Admin integration.
