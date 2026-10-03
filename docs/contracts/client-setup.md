# Client setup contract

`docs/client-integration.json` is the site's desired integration contract and
six-stage evidence inventory. Version 2 extends the existing client integration
gate. It does not grant membership, provision services, enable commerce, or prove
that a deployed site matches its source. Convex remains authoritative for tenants,
membership, tiers and permissions; credentials remain in protected configuration.

The portable implementation lives in `scripts/client-integration/`, with
`scripts/client-integration.mjs` as its command-line entry point. It runs with
Node 24 and Git. Only the explicit Convex registry check loads the consuming
site's installed CRM package and Vite. There is no new production dependency.

## Desired setup

Every field is explicit. Unknown fields and unsupported schema versions fail
validation. The synthetic example in the hub's
`docs/examples/client-integration.json` demonstrates portfolio-only scope; its
identities, paths, versions and contract names are examples, not client defaults.

| Field | Meaning |
| --- | --- |
| `version` | `2` |
| `repository` | Reviewed `owner/name` repository identity |
| `tenant.siteUrl` | Canonical tenant hostname, independent of a staging hostname |
| `tenant.expectedTenantId` | Expected immutable identity, or `null` where unobserved/legacy; never an authorization claim |
| `environments` | Named targets with exact public, Convex and media origins and a public probe path |
| `packages` | Required exact installed package versions, not semver ranges |
| `contracts.backend`, `contracts.workers` | Required backend and Worker contracts; names alone do not prove deployment |
| `environmentRequirements` | Variable name, purpose, service, phase, sensitivity and applicable capabilities; no values |
| `capabilities` | All eight explicit scope decisions, required host files and verification checks |
| `stages` | Exactly `backend`, `tenant`, `content`, `workflows`, `commerce`, `handoff` |

Each environment has `id`, `publicOrigin`, `convexUrl`, `convexSiteUrl`,
`cmsMediaOrigin` and `publicPath`. Origins must be HTTPS origins without
credentials, query strings or fragments. The Convex public query and HTTP
origins must identify the intended backend. Media origin is required for included
CMS content. An environment is selected by name; commands never infer production
from a Git branch or the current process configuration.

Capabilities are `portfolio`, `sitePages`, `blog`, `catalog`,
`privateCatalogAssets`, `crm`, `delivery` and `commerce`. Each records
`status` (`included` or `excluded`), a reason, `requiredFiles`, and named checks
with descriptions. Catalog publication and paid checkout are separate decisions;
private delivery galleries and public portfolio galleries are separate domains.
Included capabilities require real host composition and meaningful checks.
Excluded capabilities require a reason and proof their controls and effects are
unavailable. Keeping a stage with exclusions is valid; pretending it was
implemented is not. File presence cannot determine whether a tier gate works.

Use the installed shared Admin's real optional editors, product permissions and
tier gates. There is no generic `enabledPages` configuration. Host paths and
checks must describe the actual implementation. The tools do not generate dummy
routes, copy another client's design, or introduce a second commerce webhook.

## Evidence and freshness

Each stage has `verification` keyed by every environment ID. All entries start
`null`. After the scoped verification actually runs, its entry contains:

```json
{
  "verifiedAt": "<actual ISO timestamp>",
  "environmentId": "staging",
  "siteUrl": "portfolio.example.test",
  "tenantId": "<observed immutable tenant identity>",
  "sourceFingerprint": "<current SHA-256>",
  "contractFingerprint": "<current SHA-256>",
  "evidenceFile": "docs/integration-evidence/staging-content.md",
  "checks": { "portfolio.publish-readback": "passed" },
  "releaseRecord": null,
  "deploymentObservation": null
}
```

Included checks require `passed`; excluded checks require `unavailable`. The
evidence document records reviewer, tested environment/deployment, scenario,
observed outcomes, limitations and remaining work. Release/deployment references
are separate optional observations, never generated from package installation.
Staging records cannot satisfy production, and a different tenant cannot satisfy
the expected binding. A null expected identity permits planning, but readiness
requires an observed nonnull identity consistent across all stages. Never record
passwords, customer data or private tokens.

The contract fingerprint covers all desired requirements, excluding observations.
The source fingerprint covers current tracked and untracked source, selected
configuration, package/lock files and declared source requirements, including
deletions independently of staging. Evidence records do not invalidate themselves.
Required files and evidence must resolve to nonempty files inside the repository;
symlinks cannot satisfy requirements by pointing outside it.

A matching fingerprint proves freshness of recorded inputs, not truth of an
operator's report or remote configuration. Refresh evidence only after reviewing
and re-verifying the changed behavior. The checker is a local handoff gate until
a site's authorized CI/deployment workflow explicitly requires it.

## Adoption and rollback

Initialize a new gate using a reviewed contract and the hub's `init` command.
Run from the hub checkout, supplying the new site's Git repository root:

```sh
node scripts/client-integration.mjs init /absolute/path/to/client /absolute/path/to/reviewed-contract.json
```

This installs the portable tool bundle, a pending inventory, a runbook and the
`check:integration` package script. It reports required host work; it neither
mounts routes nor installs packages. Existing targets are refused before writing.
If interrupted, run `resume` from the same complete, reviewed tool bundle with
the same target and desired contract:

```sh
node scripts/client-integration.mjs resume /absolute/path/to/client /absolute/path/to/reviewed-contract.json
```

Resume validates every existing output as a regular file with exactly the
expected bytes before filling missing files. The package script must be absent
or the canonical command; unrelated package changes remain intact. Repeating a
completed installation writes nothing. A changed tool, runbook, manifest or
evidence record is a conflict requiring explicit adoption, never overwrite
permission. New outputs publish complete bytes without replacing a racing file.
An abrupt process termination can leave an unreferenced temporary file; resume
does not delete historical temporary files. Inspect those exact files separately.
Use normal verification commands for an already developed site.

## Review and resume tenant provisioning

From the client repository, write the read-only plan into its evidence directory,
review its concrete targets and gaps, then prepare the operator attachment:

```sh
mkdir -p docs/integration-evidence
node scripts/client-integration.mjs plan staging > docs/integration-evidence/setup-plan.json
node scripts/client-integration.mjs prepare staging docs/integration-evidence/setup-plan.json > docs/integration-evidence/setup-attachment.json
```

Preparation recomputes the complete plan. Source, desired contract, environment,
installed packages or supplied configuration observations changing since review
require a new review. The attachment contains only its version, `client-setup`
kind, public plan identity and expected public/backend origins. It contains no
owner details, credential values or claim of readiness.

Load the attachment in the hub's existing client-creation modal, enter the
private owner details and selected tier, and review the captured request before
creating or resuming. Changing the form or attachment invalidates that review.
The server checks the declared tenant and backend pair against its fixed runtime
target; attachment values never select a backend. The attachment records
operator intent and is not a signed proof of local source freshness.

Exact creator-authorized status reads use the same tenant resolver as creation
and verify the intended owner's actual stored identity. An existing matching
tenant resumes without changing its account, tier, credentials or other tenants.
An expected immutable tenant that is missing, or conflicting existing details,
blocks creation. The existing atomic create transaction remains the final guard
against concurrent requests; no new creation mutation or attempt table is needed.

An uncertain creation result triggers one status read. Only an authoritative
absent result permits an explicit retry, which still uses the atomic duplicate
guard. A successful original creation response is the only source of a new
password, kept in the existing modal's memory. A resumed or observed-existing
result cannot prove credential delivery: its handoff remains unconfirmed. Never
reset or regenerate a password to resolve uncertainty. Query failure remains
unknown, and the workflow does not activate commerce or configure services.

Existing v1 clients retain their own working gate until an explicit reviewed
adoption: preserve their evidence history, map their actual requirements into
v2, initialize new environment records as pending, run the new tests and verify
the selected release. Updating the hub does not silently alter Queen Worm or
the personal skill's legacy bootstrap assets. Never relabel old evidence as v2
verification solely by copying the new fingerprint.

Rollback the host and local tools independently of the additive backend status
query. Keep existing tenant identities, credentials and evidence history. The
status query performs no writes; operator-confirmed creation still uses the
existing transaction. No service, live alias, provider account or activation
state is changed by a status read, plan or local installation.
