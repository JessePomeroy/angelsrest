# Sanity external retirement — 2026-09-03

Status: AR-07 complete. Angels Rest has no live Sanity project, dataset, hosted
Studio, application token, Vercel runtime variable, or source-repository
deployment path. Convex remains the sole content and commerce authority.

This record closes the action allowlist established by
[`sanity-external-inventory-2026-09-03.md`](sanity-external-inventory-2026-09-03.md).
It records identifiers and checksums but no credential values or document
bodies.

## Completed disposition

| Surface | Final disposition |
|---|---|
| Studio source | Every remote ref from `JessePomeroy/angelsrest-studio` was captured in a verified all-ref Git bundle. The GitHub repository is archived, not deleted. |
| Local Studio checkout | Moved to `Documents/archives/angelsrest/angelsrest-studio-checkout-2026-09-03`; it remained clean on `agent/r5-snapshot-status-sync` at `d7ff307`. |
| Vercel configuration | Removed `PUBLIC_SANITY_PROJECT_ID`, `PUBLIC_SANITY_DATASET`, `SANITY_PREVIEW_TOKEN`, `SANITY_WRITE_TOKEN`, and the retired `SHOP_CATALOG_PROVIDER` selector from every environment where each existed. |
| Production application | Deployed protected main revision `68958ec` without those variables as deployment `dpl_9qVGNkWFnEQyE2XJWLjSEPWkbVCz`. |
| Factual-alt review | Repointed all 21 direct Sanity CDN review links to identity-matched retained `media.angelsrest.online` WebP derivatives and verified full GET responses. |
| Recovery decision | The owner accepted the existing encrypted baseline and its prior ciphertext/decrypt/plaintext verification instead of requiring another restore drill. |
| Hosted Studio | Undeployed application `v36dvbb34bxdmx0g3gel8pua`; `https://angelsrest.sanity.studio` subsequently returned `404 Studio not found`. |
| Datasets | Deleted `production`, then separately inventoried and owner-approved deletion of restore dataset `r10_restore_20260901`. The latter contained the same 413 historical content and asset records plus 12 provider-created restore-system records, with no drafts or release versions. |
| API credentials | Revoked the two Angels-specific application tokens inventoried immediately before cleanup. |
| Sanity project | Permanently deleted project `n7rvza4g` after it had no datasets, hosted Studio, hooks, GraphQL endpoints, native backups, or application tokens. |
| Account session | Retained the local account-scoped CLI session because the same owner account still administers the separate Reflecting Pool project. |

Reflecting Pool project `syajs0gs`, its data, Studio, configuration, and
credentials were explicitly excluded and were not changed.

## Source archive evidence

The all-ref bundle is:

`/home/strayblackdog/Documents/archives/angelsrest/angelsrest-studio-all-refs-2026-09-03.bundle`

- byte size: `846837`
- SHA-256:
  `6f62bc4868ef9370cd90d1fe8da49a3fef532e19bf62894991bb22908d6ebafa`
- included history: 37 source refs, the bundle `HEAD`, and 129 commits
- manifest:
  `angelsrest-studio-all-refs-2026-09-03.bundle.manifest.txt`
- manifest SHA-256:
  `6ed50167e12d9c59a04b24e4dc5712314e372e94a090ec2c26b502b6654009e6`

`git bundle verify` reported complete history. A second bare repository restored
from the bundle had an exact ref match with the source inventory, and
`git fsck --full --strict --no-dangling` passed.

## Provider inventory before deletion

The authenticated final inventory found:

- datasets `production` and `r10_restore_20260901`;
- one hosted Studio, application `v36dvbb34bxdmx0g3gel8pua`;
- two project application tokens: one editor and one viewer;
- zero webhooks;
- zero GraphQL endpoints;
- zero native dataset backups;
- no deployed Blueprint stack; and
- three historical CORS origins attached only to the retiring project.

The restore dataset was public and held 413 historical application records plus
11 `system.group` and one `system.retention` record. It had no drafts and no
Content Release versions. Its presence was discovered after the original
allowlist decision, so deletion stopped until the owner approved that exact
dataset and the resulting project deletion.

## Production verification

After variable removal, protected main built and reached Vercel `READY` state.
The production aliases included `angelsrest.online`, `www.angelsrest.online`,
and `angelsrest.vercel.app`. The following routes returned HTTP 200 before
provider deletion and again after permanent project deletion:

- `/`
- `/gallery`
- `/blog`
- `/shop`
- `/about`
- `/admin`

An invalid empty request to `/api/checkout` returned the expected configured
503 admission response from `NEW_ORDER_CHECKOUT_CONTROL`; it was not a missing
Sanity dependency or deployment failure. No error-level or HTTP 500 production
logs were observed on the replacement deployment. The active Content Security
Policy contains no Sanity origin.

Final provider verification showed:

- the hosted Studio URL returning HTTP 404;
- the authenticated Sanity project list containing only Reflecting Pool;
- the Angels project absent from the organization dashboard; and
- no Sanity-named variables in the Vercel project.

## Retained recovery and compatibility

Permanent provider deletion does not authorize deletion of historical
evidence. Retain the accepted encrypted dataset baseline locally and in private
Cloudflare R2 custody, including its indefinite baseline lock, through at least
2027-10-02. Retain the dated `R5_BACKUP_RECOVERY_KEY_*` Vercel values until a
separate recovery-key disposition replaces this rule.

The archived Studio repository and verified bundle preserve source history.
Migrated Convex `sanityImport` and `provider: "sanity"` values preserve data
lineage only; they do not provide or require Sanity access. The generated Convex
compatibility stubs likewise remain until sanctioned code generation removes
their generated imports.

Restoration would create an isolated replacement project from the encrypted
archive and archived source. It must not silently reintroduce Sanity as a live
application authority.
