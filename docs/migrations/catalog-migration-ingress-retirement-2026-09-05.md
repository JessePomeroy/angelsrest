# Historical catalog migration ingress retirement

The Sanity migration is complete. Historical batch receipt creation is no longer
an active platform capability. Worker PR #95 removes `/v1/catalog-assets/receipts/storage`
and `/v1/catalog-assets/receipts/inspection`, their old transfer/inspection caller
roles, and the obsolete migration inspector. This hub change removes the matching
`/cms-media/catalog-private-assets/storage-receipt` and `inspection-receipt` HTTP
routes, their internal mutations and now-unused canary admission helpers.
Requests to retired endpoints return 404, even with previously valid credentials.

Current editor inspection is retained: schema-2, exact-one receipts go through
strict editor admission and the durable upload journal. Storage and inspection
roles stay separate, uploaded bytes still require checksum and decoder evidence,
and validation/conflict/retry failures keep their existing classifications.
The shared registry continues validating accepted asset identity and target
integrity; tests exercise those transaction invariants directly rather than
recreating the retired HTTP boundary.

Generic Worker upload capabilities and source PUT remain required by
`src/lib/server/catalogCommerceClients.ts` for rendered fulfillment artifacts.
They use the current CMS tenant credential and `editor_upload` provenance.
Historical `sanityImport` and `provider: "sanity"` fields are accepted-record
lineage, including canonical receipt hashes and stored R2 metadata. Removing or
renaming them would break existing assets; they grant no provider/network access.
The bounded operator snapshot and target-authority repair remain available for
accepted-data custody, independently of the deleted migration ingress.

No credentials, stored records, R2 objects, archive custody, generated files,
production deployment configuration or physical orders are changed by this slice.
The encrypted recovery archive remains retained through at least 2027-10-02.
Package publication and Worker/Convex rollout are separate from source completion.
Deleting the old inspection implementation also eliminates the duplicate hashing
caller identified in architecture audit AR06; no extraction is needed.
