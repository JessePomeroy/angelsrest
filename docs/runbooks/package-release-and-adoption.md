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
   and reviewed release URL.
5. Review and merge the host PR, then approve that host's deployment separately.

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
