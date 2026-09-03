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
