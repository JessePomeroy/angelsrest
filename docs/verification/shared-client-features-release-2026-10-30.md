# Shared client feature rollout — October 30, 2026

This records observed release progress for the Basic/Full client policy and standard
Admin integration. It does not establish final client handoff or commerce activation.

## Published contracts and backend

| Contract | Version / source | Observed evidence |
| --- | --- | --- |
| Admin | 6.13.0 | Publication run 41139592093 succeeded; immutable registry integrity verified |
| CRM API | 6.12.0 | Publication run 41143329828 succeeded; immutable registry integrity verified |
| Gallery delivery | 0.4.0 | Same publication run; immutable registry integrity verified |
| Print catalog | 0.3.1 | Existing shared version retained in both hosts |
| Shared Convex | `7fd1934952c5e393dddfdeb4ab46f92105777748` | Exact merged-source CI run 41140466962 attempt 2 passed; deployment run 41143203883 succeeded before CRM publication |

The live public policy query returned Full features for Queen Worm and Angels Rest.
No stored client tier, provider credential map or checkout activation setting changed.
Existing recipient-link continuity and new-activity tier restrictions passed synthetic
backend and browser regressions.

## Host adoption and staging

Hub PR #741 merged as `cd352b1808f658ae6b094f98f95b952ca93e246b` after required
CI run 41147196748 and staging dispatch 41147214784 passed at reviewed head
`017e051b5b5026f163753d0b8068f8598501c258`. The follow-up fixture correction
answers the new policy query for the known synthetic sites and includes the tenant
field in the buyer-lookup assertion. All 122 affected browser checks passed locally,
including WebKit in the existing supported container; unexpected fixture queries
still fail closed.

Staging artifact `13022571323` is linked to Ready deployment
`dpl_AdPtNCfYzQ3hkkxKzS1EU8raGVfo` at that exact source. The retained observation is
[the staging receipt](../integration-evidence/releases/staging/observation-208016908815ec40e3fd6373bf4b2f4c295c55e22e96bdc0e582375cc2a33018.json).
The Preview is protected by Vercel SSO: anonymous `/` and `/cart` checks are recorded
as **blocked**, not passed. Separate authorized Vercel CLI checks observed actual
HTTP 200 app responses for `/`, `/cart`, and `/orders?site=queenworm.angelsrest.online`,
including the stored tenant name. An unsigned confirmation request returned the app's
expected JSON 401 before payment-provider access. These operator checks do not prove
anonymous Preview reachability, owner login or a valid payment workflow.

The automatic Preview and a normal redeploy skipped the test-only commit. The final
staging build used the existing `VERCEL_FORCE_BUILD=1` escape through per-deployment
build environment only. No project environment or ignore policy was changed.

## Production recovery and rollout status

The prior hub deployment `dpl_3w17P8ZrRr8zCXCCree8BzQH7Qvc`, source
`59a81a9e7e029caa9ef28578d3a5f1603eb61365`, remains retained. Source-bound CI
artifact `13019699652` and public `/` and `/cart` checks established the recovery
reference in [the production observation](../integration-evidence/releases/production/observation-583c241517977f63c5e2228436257d4b01e49e78e93c3e86f6407961ed63a597.json).
This is a source binding to Vercel's independent build, not byte-identical CI output
or a blanket guarantee of backend/Worker compatibility.

Vercel reported new hub production deployment `dpl_23j25vUvKTvpdFEvJa1eQ19oU53b`
Ready at merged source `cd352b1808f658ae6b094f98f95b952ca93e246b`. The canonical
alias and four bounded public route checks passed. Its post-merge CI run 41149645579
and source-bound production observation remain pending in this progress record.

Queen Worm PR #34 merged as `08aae4b6e2ddfdeefb4f9d4459d19936273e731f`. Its tree
matches reviewed head `a440b712ce752b312ed8d65486d203e1d253c83d`, which passed Site
checks run 41143944219, local lint/types/142 unit tests/build, 16 Admin browser checks
and 62 configured-site browser checks. Its monitored cutover remains pending.
The existing live source `7f26358403b75eff89a368b04f242c6b7be9bc97`, deployment
`dpl_GJ5qZoLkdqrk2sV2RJHJb4ywSTVV`, still serves queenworm.com with checkout closed.

All six Queen Worm owner/handoff records remain pending. No live customer record,
email, payment or gallery mutation was created for these checks. No deployment was
deleted; live targets, the prior healthy deployment and current staging proof remain
protected. Canceled Preview attempts are only potential future cleanup candidates.
