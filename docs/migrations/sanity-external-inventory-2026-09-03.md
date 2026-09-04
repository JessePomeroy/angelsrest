# Sanity external inventory — 2026-09-03

Status: AR-06 read-only inventory complete. No source, dataset, asset,
deployment, credential, repository, or archive was changed by this audit.
The actions under **AR-07 proposed allowlist** are proposals, not authority.

## Conclusion

Sanity is no longer application infrastructure for Angels Rest. The application
has no Sanity package, client import, route, preview path, provider switch,
migration entry point, or purchase fallback. What remains is:

1. a public historical Sanity dataset and its assets;
2. a live hosted Studio backed by a separate public source repository;
3. four unused Sanity-named Vercel variables and one local Sanity CLI session;
4. retained lineage labels and bounded provenance-driven compatibility for
   migrated Convex records;
5. empty generated-API compatibility stubs; and
6. an owner-accepted encrypted recovery snapshot in verified local and private
   Cloudflare R2 custody.

The existing snapshot is the recovery replacement. A second snapshot is not
required before deciding AR-07 unless the owner wants a newer recovery point.

## Evidence boundary

Observations were made on 2026-09-03 using value-free configuration listings,
public read-only Sanity queries, HTTP headers, Git/GitHub metadata, read-only R2
configuration and object reads, and local checksums. No credential value or
document body was read or recorded.

The Sanity query used the `raw` perspective and returned 413 records, no draft
or Content Release version IDs, and a latest update of
`2026-08-11T05:09:34Z` on a `product`. Its type counts were:

| Type | Count | Type | Count |
|---|---:|---|---:|
| `sanity.imageAsset` | 357 | `sanity.fileAsset` | 2 |
| `product` | 20 | `gallery` | 12 |
| `lumaProductV2` | 11 | `post` | 4 |
| `lumaPrintSetV2` | 2 | `about` | 1 |
| `author` | 1 | `category` | 1 |
| `contactPage` | 1 | `siteSettings` | 1 |

The public query is a current availability signal, not a completeness proof for
deleted history, comments, or other provider metadata.

## External resource register

Target review dates are decision checkpoints, not automatic deletion dates.

| Resource | Owner and reason | Last-known use and observable signal | Retention and removal condition | Recovery replacement | Target review |
|---|---|---|---|---|---|
| Sanity project `n7rvza4g`, dataset `production` | Jesse Pomeroy / Sanity; frozen former editorial authority | Last content update 2026-08-11; raw production query succeeded on 2026-09-03 with the counts above | Retain until an exact AR-07 decision. Remove only after owner approval, a complete authenticated project inventory, accepted archive recovery evidence, and Studio disposition | Accepted encrypted 2026-08-15 dataset archive plus Convex authoritative content | AR-07 decision |
| 357 image and 2 file assets in `production` | Same owner; historical source media embedded in the dataset | Counted by the 2026-09-03 raw query | Dispose only with the dataset under the same gate; do not delete assets individually | Same accepted archive; current public derivatives and private sources are owned by R2/Convex | AR-07 decision |
| Hosted Studio app `v36dvbb34bxdmx0g3gel8pua` at `angelsrest.sanity.studio` | Jesse Pomeroy / Sanity; former editor and recovery browser | HTTP resolved to the pinned app and returned 200 on 2026-09-03; hosted bundle reported a 2026-09-02 last-modified time | Retain until source is independently archived and dataset disposition is approved; then undeploy through an exact separately approved provider action | All-ref Studio Git bundle proposed below; dataset archive covers content, not source | AR-07 decision |
| GitHub repository `JessePomeroy/angelsrest-studio` | Jesse Pomeroy / GitHub; Studio source and recovery instructions | Public, unarchived, default `main`; main `44bd100` from 2026-08-24; accepted snapshot documentation remains on open draft PR #24 / branch `agent/r5-snapshot-status-sync` | Preserve every ref until an all-ref bundle is verified. Prefer GitHub archive mode over repository deletion | Verified all-ref Git bundle and checksum manifest | AR-07 decision |
| Local Studio checkout | Jesse Pomeroy; working copy of the separate Studio repository | On `agent/r5-snapshot-status-sync` at `d7ff307`; clean during audit | Retain until the all-ref bundle and GitHub archive state are verified; any local move/removal requires a separate exact path approval | GitHub plus proposed all-ref bundle | After archive verification |
| Local Sanity CLI session at `~/.config/sanity/config.json` | Jesse Pomeroy; account-scoped CLI authentication, mode `0600` | File exists; no value was read and no current application consumes it | Retain while provider cleanup may still be needed. Log out/remove only after checking whether the account session serves another Sanity project | Reauthentication through the owner account | After provider disposition |
| Sanity deployment/account credentials | Jesse Pomeroy / Sanity; provider management access | No Studio GitHub Actions secrets or variables are configured; hosted app remains reachable | Do not revoke by inference. Inventory nonsecret token IDs/scopes immediately before any approved provider cleanup, then revoke only credentials proven Angels-specific and unused elsewhere | Owner account recovery and fresh least-privilege credential | During approved cleanup |
| Owner factual-alt review note | Jesse Pomeroy; unfinished review of 21 migrated Blog images | All review tasks remain unchecked; its direct `cdn.sanity.io` source-image links still return 200 and are its current manual inspection path | Keep the Sanity CDN assets available until the review is completed or explicitly closed, or repoint every link to the retained Convex/R2 media identity already recorded beside it | Each entry records a Convex media ID; repoint and verify those assets before provider deletion | Before dataset deletion |
| Encrypted local recovery baseline | Jesse Pomeroy; primary historical recovery custody | Full 2,273,228,482-byte ciphertext rehashed on 2026-09-03 to accepted SHA-256 `62a64b1...21eb`; manifest, receipt, and checksum index also matched their accepted hashes | Retain at least through 2027-10-02, thirteen months after R12 acceptance, and longer unless a newer accepted disposition supersedes it | This is the recovery artifact | 2027-10-03 earliest |
| Private R2 bucket `angelsrest-cms-recovery` and accepted baseline prefix | Jesse Pomeroy / Cloudflare; independent encrypted custody | Bucket exists; the `baseline/` lock remains indefinite; remote manifest read on 2026-09-03 matched accepted SHA-256 `057f5e...66d`; candidate lifecycle remains 31 days | Preserve the accepted baseline and indefinite lock through the same minimum retention. Any weakening or deletion needs a newer exact disposition | Local encrypted baseline plus separately held recovery key | 2027-10-03 earliest |
| Retired reset-script archive `Documents/archives/angelsrest/angelsrest-retired-cms-order-reset-scripts-2026-09-02.tar.gz` | Jesse Pomeroy; historical operator-source evidence | Local 185,583-byte archive found on 2026-09-03 | Retain with migration history until an archive-wide policy exists; it is not a dataset backup | Git history where available | 2027-10-03 |

The accepted recovery baseline is
`20260815T010542Z-35132abf-61a0-46c4-a43e-2b70138a1bdd`. Exact recovery
instructions and complete hashes remain in the Studio `RECOVERY.md` on draft PR
#24 and in the canonical owner records outside the application repository.

## Credential and configuration register

The Vercel project still contains these Sanity-specific variable names:

- `PUBLIC_SANITY_PROJECT_ID` — Development, Preview, and Production
- `PUBLIC_SANITY_DATASET` — Development, Preview, and Production
- `SANITY_PREVIEW_TOKEN` — Preview and Production
- `SANITY_WRITE_TOKEN` — Development, Preview, and Production

None is referenced by current Angels Rest source, routes, packages, build
configuration, or tests. They are exact AR-07 removal candidates after owner
approval. `SHOP_CATALOG_PROVIDER` also has no current source consumer, but is a
broader retired provider selector and should be decided explicitly rather than
silently grouped with credentials.

`SHOP_CATALOG_PROVIDER` exists only in Production. Both dated
`R5_BACKUP_RECOVERY_KEY_*` values also exist only in Production.

The two dated `R5_BACKUP_RECOVERY_KEY_*` Vercel values are not runtime Sanity
credentials. Preserve them until the archive identifies one accepted recovery
key and a recovery recheck succeeds, as required by the security operations
runbook. They must not be removed as part of a generic Sanity variable sweep.

The Studio repository contains no GitHub Actions secret or repository variable.
Its `.env.example` lists only optional, nonsecret margin-preview overrides.

## Application source classification

### Absent runtime dependencies

- No Sanity package appears in the root or workspace package manifests/lock.
- No current source imports a Sanity client or SDK.
- No route pathname contains Sanity, draft, or preview handling.
- Current Content Security Policy tests explicitly reject Sanity origins.
- Architecture tests explicitly reject Sanity in current Shop and checkout
  authority.

### Retained provenance-driven compatibility, not provider access

The following Convex source files accept historical `sanityImport` or
`provider: "sanity"` values. They do not connect to Sanity. Most preserve and
validate lineage shape; portfolio public reads also use imported/restored
revision provenance to permit the exact legacy missing-alt fallback on marked
placements. These paths must remain while migrated rows retain those values:

- `packages/crm-api/convex/schema.ts`
- `packages/crm-api/convex/helpers/blogContentStore.ts`
- `packages/crm-api/convex/helpers/catalogPrivateAssetReceiptValidation.ts`
- `packages/crm-api/convex/helpers/catalogPrivateAssetRegistryTargets.ts`
- `packages/crm-api/convex/helpers/catalogPrivateAssetValidators.ts`
- `packages/crm-api/convex/helpers/catalogProductData.ts`
- `packages/crm-api/convex/helpers/catalogProductGraphData.ts`
- `packages/crm-api/convex/helpers/catalogProductValidators.ts`
- `packages/crm-api/convex/helpers/contentRevisionProvenance.ts`
- `packages/crm-api/convex/helpers/contentStore.ts`
- `packages/crm-api/convex/helpers/contentValidators.ts`
- `packages/crm-api/convex/helpers/postContentStore.ts`
- `packages/crm-api/convex/helpers/portfolioData.ts`
- `packages/crm-api/convex/helpers/portfolioValidators.ts`

These values and their bounded compatibility policy are not Sanity runtime
authority, but neither are they uniformly passive. They are not on the AR-07
deletion allowlist. Replacing them would require a separately reviewed data
migration and public-read compatibility decision.

### Empty generated-API compatibility stubs

Fifteen `packages/crm-api/convex/helpers/sanity*.ts` files contain only an empty
module and a comment. They exist because checked-in generated Convex API types
still import the old filenames. They have no function, provider call, or data
authority. Remove them only through sanctioned Convex code generation that
also removes the generated imports; never hand-edit generated files.

### Separate Studio source

The Studio remains a complete executable Sanity application with Sanity 5,
schemas, media/orderable/presentation plugins, and project/deployment IDs in
`client.config.ts`. Its README ownership claims are historical and no longer
describe Angels Rest production. The Studio is outside the Angels Rest runtime,
but remains a live hosted/provider surface until AR-07 decides it.

## AR-07 proposed allowlist — not authorized

The following is the exact maximum action set proposed for separate review.
Approval may select a subset. Anything absent from this list remains forbidden.

### Phase A — preserve source before provider cleanup

1. Fetch every remote ref from `JessePomeroy/angelsrest-studio` into an isolated
   temporary clone.
2. Create
   `/home/strayblackdog/Documents/archives/angelsrest/angelsrest-studio-all-refs-2026-09-03.bundle`.
3. Write a sibling value-free checksum/manifest naming the repository URL,
   every included ref and commit, bundle byte size, and SHA-256.
4. Clone the bundle into a second temporary directory and verify all recorded
   refs and objects.
5. Mark the GitHub repository archived; do not delete it.
6. Only after the verified bundle and GitHub archive state, move or remove the
   exact local `Documents/work/angelsrest-studio` checkout under a separately
   named local-path approval.

### Phase B — remove unused host configuration

7. Remove only `PUBLIC_SANITY_PROJECT_ID`, `PUBLIC_SANITY_DATASET`,
   `SANITY_PREVIEW_TOKEN`, and `SANITY_WRITE_TOKEN` from every Vercel
   environment where they exist.
8. Remove `SHOP_CATALOG_PROVIDER` only if the owner includes it explicitly.
9. Redeploy current protected Angels Rest main without those variables and
   verify public content, Shop, checkout admission, Admin, and error telemetry.

### Phase C — dispose provider surfaces

10. Produce an authenticated value-free inventory of every dataset, Studio
    app, token ID/scope, webhook, CORS origin, and integration inside project
    `n7rvza4g`; stop if anything is not Angels-specific.
11. Either complete an isolated restore from the accepted archive, or record an
    explicit owner decision accepting the existing ciphertext/decrypt/plaintext
    verification instead of a new restore drill.
12. Undeploy only Studio app `v36dvbb34bxdmx0g3gel8pua` and verify
    `angelsrest.sanity.studio` no longer serves the app.
13. Before dataset deletion, complete or explicitly close the unfinished
    `angels-rest-blog-factual-alt-review.md`, or replace all 21 direct Sanity CDN
    links with verified retained Convex/R2 media URLs using its recorded media
    IDs.
14. Delete only dataset `production` after that owner-review dependency is
    closed and the Phase C inventory confirms no other required dataset or
    release state.
15. Delete project `n7rvza4g` only if it is empty after the approved dataset,
    app, and integration cleanup and the owner separately names project
    deletion.
16. Revoke only Angels-specific Sanity credentials proven unused elsewhere;
    then remove the local CLI session only if it serves no other project.

### Explicitly retained / excluded

- Keep all migrated Convex provenance, imported identifiers, and their bounded
  legacy read compatibility unless a separate data migration replaces them.
- Keep the 21 referenced Sanity CDN assets until the factual-alt review is
  completed, closed, or repointed and verified against retained media.
- Keep the accepted local and R2 encrypted baseline and its lock through at
  least 2027-10-02.
- Keep the recovery key until the recovery decision above is accepted.
- Do not touch `sanity-studio-template`, Reflecting Pool, its Studio, or its
  Sanity project.
- Do not delete the Studio GitHub repository.
- Do not remove unrelated Vercel, GitHub, Convex, Cloudflare, Stripe, Resend,
  LumaPrints, gallery, or package credentials.
- Do not hand-edit generated Convex files.

## AR-06 verification result

- Runtime/provider absence: pass.
- Hosted data and asset inventory: pass for public raw content; authenticated
  provider-control inventory deferred to the destructive AR-07 preflight.
- Studio source/deployment inventory: pass.
- Credential-name inventory: pass; values were not accessed.
- Provenance/runtime distinction: pass.
- Recovery custody: pass; local ciphertext and remote manifest were freshly
  verified without decrypting content.
- Exact proposed allowlist: pass and remains unauthorized.
- Audit-only/no external mutation: pass.
