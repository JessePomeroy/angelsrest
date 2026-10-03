# Connecting this client website

This workflow begins incomplete. Review `client-integration.json` against the
agreed site scope and actual installed packages. It records desired configuration
and evidence; it does not certify implementation, deployment or activation.
See [the setup contract](contracts/client-setup.md) for the complete schema.

## Use the local tools

Run from this site's repository root with Node 24 and Git:

```sh
node scripts/client-integration.mjs plan staging
node scripts/client-integration.mjs preflight staging
node scripts/client-integration.mjs check staging
```

Replace `staging` with an explicit environment ID in the contract. `plan` is
read-only and lists existing, missing, proposed and unknown requirements. It
does not fetch provider state. `preflight` checks only explicitly supplied host
process environment variables, without loading dotenv files. Convex, Worker and
hub settings remain unknown. A secret's presence does not establish validity.
The plan shows intended public targets; neither command prints environment values.

`check` requires all six stages' current evidence for the selected environment.
It should fail for a new site. Package-manager shorthand is
`pnpm check:integration staging` when using pnpm. Local development does not
require a handoff-ready result.

After the target and read-only network check are authorized:

```sh
node scripts/client-integration.mjs candidate staging
```

This probes the exact environment origin's configured public path and anonymous
`/api/auth/get-session`. It follows no redirects, changes no alias and does not
establish authenticated UI, tenant permissions or provider readiness. Keep the
known healthy alias if either probe fails.

The separate `convex-registry staging` mode accepts bounded JSON on protected
stdin and uses the installed CRM release's validator. Never place credentials in
arguments, command history or evidence. This validates one registry schema and
tenant presence; it does not prove preservation of unrelated tenants or rotation
slots. Other services require their own validators. It never writes a registry.

## Complete the six stages

1. **Backend:** verify exact published/installed packages and the required
   deployed backend/Worker contracts. Installation alone proves no runtime state.
2. **Tenant:** provision through the creator-authorized platform boundary,
   preserving existing accounts and credentials. Verify membership, login,
   navigation, refresh, expiry and cross-tenant denial in the real client UI.
3. **Content:** connect the custom public design to tenant-scoped published
   content. Verify sample upload, draft, publish/read-back and unpublish, including
   failure and empty states, without exposing drafts or private assets.
4. **Workflows:** mount shared handlers with request-owned authentication and
   correct site authorization. Verify the agreed document, portal and private
   delivery journeys, including recovery and expired/revoked capabilities.
5. **Commerce:** verify the agreed products, prices, checkout and recovery only
   in an authorized environment. Hub-owned payment/shipment intake stays central.
   A portfolio-only site records commerce exclusions and proves purchase controls
   and checkout effects unavailable.
6. **Handoff:** run relevant checks and the production build on the final source,
   inspect the deployed client UI, and record the actual environment/release,
   remaining service decisions, recovery scope and responsible owner.

Keep all eight capability decisions and all six stage headings, even when a
feature is excluded. Required source paths describe real host bindings. Never
create a stub or omit a requirement merely to pass the gate. Use the shared
package's actual capabilities rather than an invented page toggle.

## Record observed outcomes

Keep this as the one current capability-status table. Replace its placeholder
with agreed scope; link dated evidence without creating a competing readiness
matrix. Operator/API proof does not establish client-UI access.

| Capability | Environment | Implemented | Deployed | Enabled for client | Client-UI evidence / limits | Next action and owner |
| --- | --- | --- | --- | --- | --- | --- |
| Populate from the agreed scope | Unknown | Unverified | Unverified | Unverified | No observed run | Review scope and assign owner |

After verification, write sanitized evidence under `docs/integration-evidence/`
and fill only the matching stage/environment record. The checker prints the
current source fingerprint; use the plan's contract fingerprint as well.
Record each named check as `passed` or, for an excluded capability, `unavailable`.
Do not copy fingerprints onto old reports or invent release/deployment IDs.
Required membership and permissions remain authoritative in Convex.

The gate detects missing files/records, tenant/environment mismatch and stale
source/requirements. It cannot prove a report's truth, current remote state or
client acceptance. Add it to a site's authorized deployment gates separately.
Link this runbook from the site README and project instructions during adoption.
Update design handbooks only after changed UI is shipped and confirmed live.

## Recovery boundaries

For an interrupted installation, use the complete original tool bundle's
`resume <repository> <contract.json>` command. It fills missing outputs only when
all existing outputs match exactly. Changed runbooks, evidence, commands or tools
are conflicts; preserve them and review adoption. A completed identical install
is a no-op. This is not a command for replacing an existing client's workflow.

Review `plan` output saved under `docs/integration-evidence/`, then run
`prepare <environment> <reviewed-plan.json>` to produce a public attachment for
the hub's client-creation modal. Preparation fails if the current plan differs.
Enter owner details and tier in the modal and review them there; they do not
belong in the attachment. The server checks its own fixed backend and the exact
tenant binding, not an uploaded claim of source authenticity.

An uncertain creation result is reread before retry. Existing matching tenants
resume without changes. Only the original successful response can hand over a
new password; a lost response leaves credential handoff unconfirmed. Confirm
access before handoff, without resetting credentials or creating another tenant.
Service provisioning, registry changes, paid plans, publishing, deployment,
client handoff and sales activation retain their authorization and evidence.
