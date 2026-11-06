# Explicit client field clearing

Status: local source preparation. Deployment, package publication, host adoption,
and the hub's Vercel Preview/Production effects require separate approval.

`crm.updateClient` adds an optional `clearFields` array containing only `email`,
`phone`, `type`, `source`, `notes`, and `siteUrl_client`. It accepts at most six
entries. Missing fields and explicit `undefined` keep existing values, matching
the established update contract. An explicit clear removes the stored optional
field; it does not store an empty string or change the schema.

For example, an update may set `name` and remove `type` and `notes`:

```json
{
  "clientId": "existing-client-id",
  "siteUrl": "owned.example",
  "name": "Avery Stone",
  "clearFields": ["type", "notes"]
}
```

The same shape survives the Admin HTTP adapter's JSON encoding and Convex value
encoding. The HTTP proxy still authenticates the request and forwards it through
a fresh authenticated client. The existing mutation still verifies site membership,
CRM access, and that the stored client belongs to the requested site. A client ID
or supplied site name alone cannot establish authority.

Setting a field and clearing that same field in one call is rejected. Both updates
and removals run in the same Convex transaction; failures leave all fields and
status activity unchanged. The allowlist excludes identity, name, category,
status, and board fields. Status changes retain their
existing activity records.

The Admin editor emits clears only for existing optional values that the user
empties in visible fields. A hidden client website is preserved. Switching
category resets and explicitly clears the former type when no replacement is
selected. Pending/failed saves retain the draft through AF-02's acknowledgement
flow; cleared values are removed from the selected-client view after success.

## Ordered rollout and compatibility

1. Review and verify the backend and consumer source candidates. This changes an
   existing module, so generated API bindings remain untouched; the package's
   types derive the additive argument from the module.
2. Approve the exact hosting effects before pushing the hub source branch or
   opening its PR. Obtain remote independent review and current-head CI afterward.
3. Separately approve main/production effects, CRM API publication and deployment
   of the compatible backend receiver. Existing callers remain valid without
   `clearFields`.
4. Publish and adopt the Admin consumer only after the receiver is available.
   An older receiver rejects the new argument; the editor keeps the failed draft,
   but field-clearing acceptance requires the updated receiver.

Do not publish through the separate Changesets version PR or deploy by implication.
No migration, new module, generated-file edit, credentials, providers, or live data
mutation is needed for local verification. Local contract/component tests and
synthetic rendered checks do not establish deployed acceptance.
