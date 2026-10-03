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
If interrupted, retain the partial files for reconciliation instead of overwriting
them or inventing completed evidence.

Existing v1 clients retain their own working gate until an explicit reviewed
adoption: preserve their evidence history, map their actual requirements into
v2, initialize new environment records as pending, run the new tests and verify
the selected release. Updating the hub does not silently alter Queen Worm or
the personal skill's legacy bootstrap assets. Never relabel old evidence as v2
verification solely by copying the new fingerprint.

Rollback is local tooling/contract rollback to the prior reviewed version. Keep
the evidence history. This slice changes no tenant, credential, service, live
alias, provider account or activation state.
