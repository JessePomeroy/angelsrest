# Package release and adoption

The shared Admin and CRM API packages are independently versioned contracts.
Automation prepares each transition; it never approves publication, host merge,
or deployment.

## Ordered release

1. Merge a reviewed package source PR with its Changeset.
2. Review and merge the Changesets version PR. That merge publishes the package.
3. Verify the immutable version in GitHub Packages.
4. Prepare a host PR that pins the exact published version and updates its lockfile.
   For Admin, dispatch `Prepare Admin package adoption PR` with the exact version
   and reviewed release URL from `main`. The workflow checks strict peer compatibility,
   consumer imports, host types and tests before opening the PR.
5. Verify the exact candidate in staging and retain the production recovery reference
   using the controlled adoption gate below. Review runtime compatibility separately.
6. Review and merge the host PR, then approve that host's deployment separately.
   Observe its actual production deployment after main CI; staging does not satisfy
   production acceptance.

Angels Rest is the required real-host fixture for `@jessepomeroy/admin`; its CI
type-checks representative browser-root and `/server` imports plus every CRM API
subpath. Another host follows the same host-owned adoption pattern without
cross-repository writes from a package release workflow.

## Mixed-version backend rollout

Convex evolves backend-first: deploy additive schema and functions, publish the
matching CRM API contract, and then adopt it in hosts. Remove old fields or
functions only after the consumer inventory proves all hosts have moved. A
missing or breaking public package surface must fail package or host CI before
publication or deployment.

## Independent rollback

- **Admin package:** revert the host's exact dependency and lockfile to the last
  known-good immutable version, then redeploy only that host.
- **CRM API package:** revert the host type/package version independently. Revert
  Convex only when no writes used the new shape; otherwise deploy a forward fix.
- **Shared Convex:** use its manual deployment workflow and treat it as a separate
  approved runtime effect.
- **Gallery Worker:** roll back its Worker deployment independently; it remains a
  separate storage and scaling seam.
- **Vercel host:** roll back or redeploy the host without republishing packages or
  changing the Worker.

Never use a source merge as implicit authority to publish, adopt, merge, deploy,
or combine these runtimes.

## Controlled Admin adoption

The preparation workflow starts from current `main`, pins only the requested
published Admin dependency and its package-manager lockfile, and opens a host PR.
It dispatches full CI on the exact candidate branch with
`release_environment=staging`. Main/pull-request CI retains its production identity;
a staging dispatch has its own concurrency key. Both CI configurations remain
`ci-fixture`: the environment label does not deploy code or establish runtime state.

Once that dispatch passes and the candidate's authorized preview deployment is
READY, observe it using the exact artifact and deployment IDs. The staging origin
must be a provider-observed alias of that preview, distinct from production. A
protected preview returns blocked evidence; do not disable protection or substitute
the production origin to make a check pass.

```zsh
node scripts/observe-release.mjs observe \
  --repository JessePomeroy/angelsrest \
  --site angelsrest.online --environment staging \
  --origin "$STAGING_ORIGIN" \
  --team team_YA4WhxHjBPoepo8e5ijnFxmq \
  --project prj_q6x2BF1DUnXDMYWNh0oWOQltLjxE \
  --target preview \
  --artifact "$STAGING_ARTIFACT_ID" --deployment "$STAGING_DEPLOYMENT_ID" \
  --public-path / --public-path /cart

node scripts/check-release-adoption.mjs \
  --repository JessePomeroy/angelsrest --site angelsrest.online \
  --candidate "$ADOPTION_HEAD" --version "$ADMIN_VERSION" \
  --staging-origin "$STAGING_ORIGIN" \
  --production-origin https://www.angelsrest.online \
  --public-path / --public-path /cart
```

Supply the reviewed candidate SHA, exact Admin version and observed nonsecret IDs.
First refresh production using the production observation command below with the
same public-check policy. The adoption check is offline and requires intact retained
observation receipts in both environments. It refuses a different source/version,
failed or missing staging checks, missing production recovery proof, unresolved
links, or changed non-Admin package/backend/Worker requirements. A newer unbound CI
record cannot replace the candidate deployment's actual linked build.

Exit zero means this bounded evidence gate passed. It does not authorize merge or
prove runtime compatibility. Review the package release's runtime requirements;
apply required additive backend/Worker changes before adoption. A change outside
the Admin-only path requires the ordered mixed-version rollout above, followed by
new staging and production observations. Missing runtime/configuration/capability
evidence remains unknown. The gate does not create an intended release from a
package version or change a client's capability choices.

Retain the command's complete JSON output as the pre-merge adoption receipt through
the site's evidence process. Its production recovery reference contains exact
deployment/source/build IDs, package versions and the lockfile digest. Preserve
that receipt after production advances; a later `lastHealthy` may describe the new
release. Before a separately authorized host rollback, refresh the retained
deployment's provider availability and backend/Worker compatibility. Roll back
only the host or its exact dependency/lockfile pair; do not undo shared writes or
redeploy Convex/Workers as a side effect. A failed upgrade keeps the earlier scoped
healthy deployment in retained history.

After merge, wait for main CI and the production deployment, then observe/import
their separate production evidence. A squash merge has a new source SHA and needs
its own main artifact; never relabel the staging record as production. Actual
client runtime acceptance and a staging pilot remain separate from fixture checks.

## Release evidence

Keep intended releases, CI builds, provider deployments, enabled capabilities and
verification separate using the [release-record contract](../contracts/release-records.md).
Successful hub CI uploads a small immutable build record with exact source/package
identity, public configuration fingerprint, required interfaces and actual check
results. CI fixture configuration does not establish production configuration.

Retain the build record and upload receipt with authenticated deployment and scoped
verification evidence in the site's integration-evidence history. A matching source
SHA associates Vercel's independent rebuild with the CI source; it does not prove
identical artifact bytes. Preserve the last scoped healthy deployment when a newer
upgrade fails. Missing observations remain unknown, and staging evidence never
completes production handoff.

## Observe a deployed release

After the matching main CI and provider deployment finish, use the immutable
artifact ID and exact deployment ID from that release. This read-only provider
step appends local evidence; it does not deploy or promote anything. Use an
explicit environment and a reviewed public-check policy. For the hub:

```zsh
node scripts/observe-release.mjs observe \
  --repository JessePomeroy/angelsrest \
  --site angelsrest.online --environment production \
  --origin https://www.angelsrest.online \
  --team team_YA4WhxHjBPoepo8e5ijnFxmq \
  --project prj_q6x2BF1DUnXDMYWNh0oWOQltLjxE \
  --target production \
  --artifact "$RELEASE_ARTIFACT_ID" --deployment "$RELEASE_DEPLOYMENT_ID" \
  --public-path / --public-path /cart

node scripts/observe-release.mjs status \
  --repository JessePomeroy/angelsrest \
  --site angelsrest.online --environment production \
  --origin https://www.angelsrest.online \
  --public-path / --public-path /cart
```

Set the two release ID variables to the observed nonsecret IDs before running.
The default workflow is `.github/workflows/ci.yml`; a different client workflow
requires its explicit `--workflow` path. Python 3, Node 24, and authenticated
`gh`/`vercel` CLIs are operator prerequisites. The `status` command is offline.

Review and retain `docs/integration-evidence/releases/production/` through the
site's evidence process. `lastHealthy` is the most recent retained deployment
with all required CI and named public checks passing. A failed upgrade adds its
failure while preserving a prior healthy rollback candidate. Its presence does
not authorize rollback: refresh the candidate's provider availability and current
backend/Worker compatibility before a separately authorized promotion. If the
artifact is unavailable, the observer fails without manufacturing provenance;
retained history is unchanged and does not establish the new release's status.

The [record contract](../contracts/release-records.md) describes alias races,
artifact retention, source-only binding, unresolved observations and scope limits.

## Platform release status

The creator-only Platform page shows the intended release, last observed deployment,
its exact linked package versions, named verification gaps and a next action for
an existing platform client. Selecting another website hides the previous site's
evidence while the new query loads. Unrecorded environments are empty, not healthy.

Deploy the additive Convex schema/functions first, publish the matching CRM API
contract, then adopt it in the host before enabling this view. The browser only
reads the bounded summary. It never receives provider credentials, uploads trusted
proof or changes deployment state.

After observing a deployment with the command above, import its retained receipt
through authenticated Convex operator tooling. Select the deployment explicitly:

```zsh
node scripts/import-release.mjs \
  --repository JessePomeroy/angelsrest \
  --site angelsrest.online --environment production \
  --origin https://www.angelsrest.online \
  --public-path / --public-path /cart \
  --convex-deployment loyal-swan-967 \
  --receipt "$RELEASE_OBSERVATION_RECEIPT"
```

Set `RELEASE_OBSERVATION_RECEIPT` to the exact `observation-<digest>.json` filename
in that environment's retained history. The CLI sends only that receipt and its
linked build, deployment and verification records. Use `--record <digest>.json`
instead of `--receipt` to import a reviewed intended-release record prepared under
the [record contract](../contracts/release-records.md). It must already belong to
the same repository, website and environment. No intended release is inferred from
the newest published package or a successful deployment.

The existing platform client's canonical site URL is the ownership boundary. The
first import fixes that client's repository, environment, origin and required-check
policy. A later change requires an explicit migration review; it cannot silently
reuse earlier health. Importing the same proof again does not create another
version. If the CLI times out, retry the same import to confirm its outcome. A
concurrent update requests a retry; prior evidence survives either way.

History is bounded to 500 records, 500 receipts and 512 KiB per environment, with
at most 16 environments per client. Incoming evidence is limited to 96 KiB (the CLI
also counts serialized argument overhead). Hitting a bound requires a reviewed
retention change; the importer does not prune recovery evidence automatically.

“Required checks passed” means only that the named policy passed at the recorded
time. Package/source/contract comparison is separate from runtime compatibility,
which remains unverified until runtime evidence has a defined producer. The view
keeps configuration and capability observations explicit. Failed upgrades retain
the last deployment that passed the same checks as a recovery reference; using it
still requires a fresh compatibility and provider-availability check.
