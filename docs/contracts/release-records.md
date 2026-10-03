# Release records

Source, builds, deployments, capability activation and verification are separate
facts. Version 1 release records preserve each fact independently. An absent record
means unknown. The validators and history rules live in
`scripts/release-record/records.mjs`; a valid JSON shape is not proof that its
contents were observed.

## Identity and record kinds

Every record identifies a repository, canonical tenant site, explicit environment,
observation time and optional client-contract fingerprint. A record's `sha256:` ID
hashes its complete canonical payload. This detects changed bytes; it is not a
signature or cryptographic attestation. Records are append-only evidence. Never
replace an older successful observation with a failed upgrade.

| Kind | What it records | What it does not establish |
| --- | --- | --- |
| `intended` | Reviewed source/package requirements, scope and review reference | Installed versions, activation or approval to deploy |
| `build` | Actual checkout, exact packages, lockfile, public configuration, required contracts, check outcomes and public client asset digest | An actual deployment or matching production configuration |
| `deployment` | Authenticated provider identity, source association, state and observed alias assignment | Identical CI/provider build bytes or a healthy application |
| `capabilities` | Explicit enabled/disabled/unknown observations for one deployment | Anything inferred from requested features, tier names or installed modules |
| `verification` | Named scenarios, evidence references and outcomes for one deployment | Unexercised scenarios, another environment or full client handoff |

Client sites reuse `docs/client-integration.json` v2 and its existing fingerprint
functions. There is no second setup contract. The hub currently has no client
integration manifest: its contract and integration-source fingerprints remain
null. The exact Git source revision remains independently recorded. Never copy the
synthetic example into a real site to manufacture readiness.

A reviewed package-only intention may leave its future source revision null until
the adoption commit exists. Build and deployment records always require an actual
source revision.

Linked records must agree on repository, site, environment and contract identity.
Verification also binds its exact deployment and observed configuration. History
can retain older contract versions for rollback, but cannot mix their evidence.
Each record uses a closed schema; arbitrary environment maps, provider responses,
credentials, customer records and raw logs do not belong in it.

## The hub CI build record

After the existing checks pass, `.github/workflows/ci.yml` runs
`node scripts/release-record.mjs build`. It writes only
`.output/release-record/build.json`, exclusively, and uploads that exact file.
The artifact name includes repository ID, actual checkout SHA, run ID and attempt.
Upload overwrite is disabled. The upload receipt separately identifies the
GitHub artifact ID, URL and archive digest in the job summary; an artifact cannot
contain its own final upload digest.

The generator rejects a dirty host or Worker checkout, a different `GITHUB_SHA`,
missing package metadata, installed/lockfile disagreement and a mismatched Worker revision. On a
pull request, the tested merge commit is `sourceRevision`; the branch tip is the
separate `github.headSha`. Main-branch CI records the actual merged revision.
One revision must not be relabeled as the other.

The named checks are dependency installation, Worker checkout/installation, lint,
types, tests, retired checkout-route absence, build/budgets, component browser
tests and public E2E. Their actual step outcomes enter the record. Missing,
skipped, canceled and failed checks cannot establish an eligible build. A workflow
that fails before record generation has no successful build record.

The record contains exact Admin, CRM API, gallery-delivery and print-catalog
versions. Workspace source is distinguished from installed registry packages.
The host's actual installed resolution takes precedence over a same-named workspace.
Workspace links are verified; the hub's CRM source alias is recorded explicitly.
For a client manifest, its declared package set and exact versions are checked.
The existing frozen-lock install remains a required CI step. No registry request
or package installation occurs inside the generator.

Public configuration has a deliberately bounded fingerprint: public site origin,
Convex cloud/site origins, optional CMS media origin, checkout snapshot mode and
HTTP admin mutation transport. Missing optional observations remain null. It is
not a fingerprint of every production setting. Credentials, credential hashes,
admin server configuration and generic `process.env` dumps are excluded.

This CI uses fixture secrets and public read endpoints, so every generated record
is labeled `ci-fixture`, including main-branch builds. That scope cannot certify
production configuration. The output digest covers `.svelte-kit/output/client`
only, with paths and bytes included; it excludes server bundles and rejects
symbolic links. It identifies public client assets, not a complete deployable
server artifact.

Backend requirements identify the actual CRM API version and current commerce
intake/provisioning contract-document digests. They describe required interfaces,
not observed Convex deployment. The CI-pinned gallery-worker checkout tests the
gallery upload and CMS-media print-artwork boundaries. Broader CMS editor/media
deletion and managed Turnstile siteverify requirements remain explicit with
unknown source revisions. The print-artwork check does not verify those entire
Worker runtimes. A client manifest supplies its own required interface IDs.

## Deployment and health observations

Vercel's Git integration rebuilds independently. Matching authenticated provider
source metadata with a build record establishes `source-only` association.
Deployed artifact bytes and configuration stay unknown unless separately
observed. Public HTTP 200 alone cannot authenticate project, account or source.

The latest deployment observation and last observed production alias assignment
are different fields. Re-observing an old preview does not make it production.
Missing or unresolved alias evidence leaves the current deployment unknown.

History derives `lastHealthy` only for a READY deployment whose linked build has
all required checks passing and whose exact deployment has every required named,
scoped scenario passing. The caller must provide a nonempty health policy. A
failed new deployment preserves the older healthy deployment and its evidence.
An uninformative poll preserves prior known health without copying old verification
onto the new observation. A newly observed failure of the same deployment, or a
known configuration change, invalidates its earlier health evidence.
The result describes that policy's scope, such as public reachability; it is not
the six-stage integration handoff, client UI acceptance or commerce activation.

CI artifact retention is 30 days, subject to repository policy. Preserve small,
validated build/provider/verification records in the site's existing
`docs/integration-evidence/` history before artifact expiry. Keep provider/run
identifiers and upload receipts. An expired or missing artifact is unresolved
provenance, not proof of a healthy build. Authenticated provider association is a
separate delivery step; this generator does not deploy, promote or delete.

## Authenticated deployment observation

Run `scripts/observe-release.mjs` from the repository root with authenticated
GitHub (`gh`) and Vercel CLIs, Node 24 and Python 3. Python's standard-library ZIP
reader reads one bounded `build.json` in memory; it never extracts archive paths.
No new application dependency or provider credential is required by the host.

The observer downloads the exact GitHub artifact by ID, verifies its archive
digest and size against authenticated metadata, and validates the content against
the successful workflow attempt, repository and expected workflow path. Expired,
missing, foreign-repository or mismatched records fail without changing history.
The observer accepts successful push or manually dispatched workflow runs only,
with build source equal to the authenticated run's head SHA. GitHub's run metadata
does not independently identify a pull request's synthetic merge checkout, so its
artifact is not accepted for deployment binding. Select the main CI artifact for
the actual deployed revision. A logical `production` environment requires the
provider's production target; other explicit environments remain separate.

An authenticated Vercel read must agree on the explicit team, project, deployment
ID, environment target, GitHub repository ID/name and source SHA. Only the bounded
identity fields enter the record. Raw provider responses, environment values and
provider CLI diagnostics are never saved or printed. Deployment configuration
remains unknown; association is always `source-only` for this delivery path.

The optional `--public-path` checks make credential-free GET requests to explicit
paths on the authenticated alias. They record HTTP status and HTML content type,
cancel the body, and never follow redirects. The alias must point to the selected
READY deployment both before and after the requests. A changed or unresolved
alias, authentication challenge, redirect or unavailable request blocks that
proof. These checks establish public reachability only. They do not exercise
cart behavior, authenticated admin, checkout, provider effects or client handoff.
No `--public-path` arguments means no verification record; it cannot establish
health. For offline status without a specified policy, `/` is the minimum required
public check, so missing observations remain unknown.

Validated build, deployment and optional verification records are retained under
`docs/integration-evidence/releases/<environment>/`, named by their content IDs.
A separate immutable observation receipt retains artifact provenance and the
bounded public-check results. Existing records are reused only when their bytes
are identical; conflicting files and linked paths are refused. Each file is
fully written and synced before exclusive atomic publication. An interruption
may leave an ignored `.pending-<random-id>.json` temporary or an orphan receipt;
neither prevents reading earlier healthy evidence. Published records must have
receipts with valid content IDs and matching artifact, deployment and probe
references. A missing or corrupt published receipt stops status evaluation
without making a health claim or overwriting the earlier files. Re-running
observation adds timestamped evidence; `status` reads it without provider access.

The operator must preserve this small evidence directory through repository
review or the site's existing evidence-retention process before the CI artifact
expires. Local hash IDs detect changed bytes, not hostile rewrites or forged
provenance. Do not accept client-supplied files as authenticated observations.
No deployment promotion, rollback, deletion or capability activation occurs.

Provider contracts: [GitHub artifacts API](https://docs.github.com/en/rest/actions/artifacts),
[Vercel deployment lookup](https://vercel.com/docs/rest-api/deployments/get-a-deployment-by-id-or-url)
and [Vercel alias lookup](https://vercel.com/docs/rest-api/aliases/get-an-alias).

Rollback of these tools consists of reverting the focused scripts/workflow change.
Existing application behavior, provider resources and retained observations do not
change. Host, package, Convex and Worker rollbacks retain their separate gates in
the [release runbook](../runbooks/package-release-and-adoption.md).
