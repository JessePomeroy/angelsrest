# Build budgets and usage review

The size check measures the current Vercel Node.js build. It makes artifact
growth a CI failure; it does not estimate a bill or change a provider plan.

## Measured baseline

The October 2, 2026 baseline is commit
`96090f17a48db7bdeec0927f2c37d6160e92f61a`, the released magnetic-image build.
It was rebuilt in a clean Linux x64 checkout with Node 24.18.0, pnpm 10.34.5,
the frozen lockfile, and the CI job's placeholder environment. No local env
files, provider credentials, or Sentry upload credentials were supplied.

| Metric | Baseline | CI maximum |
| --- | ---: | ---: |
| Actual function bundles | 6 | 6 |
| All function bundles, bytes | 250,174,013 | 275,200,000 |
| Largest function bundle, bytes | 70,120,049 | 77,200,000 |
| Static output, bytes | 2,617,808 | 2,900,000 |

The byte limits allow approximately 10% growth, rounded up to 100,000 bytes.
An additional function or a change from `nodejs24.x` requires deliberate review
even when total bytes remain below the limit. These are project regression
budgets, not provider quotas. They do not constrain the existing route timeouts.

The six bundles measured 31,286,543; 70,120,049; 29,741,931; 29,700,122;
70,106,828; and 19,218,540 bytes (`0.func` through `4.func`, then
`catchall.func`). The older four-bundle measurements in
[Vercel footprint controls](VERCEL_FOOTPRINT.md) and
[dependency footprint](DEPENDENCY_FOOTPRINT.md) describe earlier releases;
they are not the current baseline.

`build-budget.json` holds the measured baseline and enforceable limits.
`scripts/check-build-budget.mjs` reads `.vercel/output/config.json`,
`functions/`, and `static/`. It counts each real function directory once,
deduplicating route aliases. Inside each bundle it follows dependency symlinks
and sums file lengths at their logical paths; shared dependencies count again
in each bundle. Static output includes all emitted static files, including any
source maps still present. Missing output, broken links, cycles, invalid budget
values, or an unsupported output version fail the check.

These are uncompressed logical bytes, not unique disk usage, compressed
downloads, initial-page JavaScript, or Vercel billed storage. The counting model
follows the [Vercel Build Output API structure](https://vercel.com/docs/build-output-api/primitives).
Reestablish the baseline when changing the host, runtime, adapter, native
dependency platform, or output format.

## Run and investigate

```zsh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm check:build-budget
# Machine-readable measurements; budget failures still return exit 1:
node scripts/check-build-budget.mjs --json
```

Always build successfully immediately before measuring. The standalone check
does not prove an existing output directory came from the current source.
For a comparable baseline use a clean checkout without local env files, the
job-level environment in `.github/workflows/ci.yml`, and no `SENTRY_AUTH_TOKEN`,
`SENTRY_ORG`, or `SENTRY_PROJECT`. Do not copy production credentials into a
measurement checkout.

CI runs one production build and appends the size table to the job summary.
The check's nonzero exit fails CI. Existing browser suites use development
servers; they do not supply deployment artifacts. No full bundle upload or
additional artifact-retention policy is needed. This CI check does not stop a
Vercel Git deployment that runs independently of CI.

When the check fails, inspect the per-function table and changed dependencies,
route configurations, and static assets. Compare with a clean build of the
recorded baseline using the same environment. Look for unnecessary dependency
tracing, duplicated bundles, or accidental large static files before changing a
limit. A legitimate increase needs its own measured explanation in the PR,
updated baseline commit/date/environment, and reviewed limits in
`build-budget.json`. Do not automatically ratchet limits upward on every build.
Run the focused checker tests after changing measurement logic:

```zsh
node --test scripts/check-build-budget.test.mjs
```

## Manual operating review

Review weekly during active development and after a material release. Review
actual invoices and account-wide allowances at each billing-cycle close.
This is an operator procedure, not a scheduled job. Start with the October 2
COST-01 operating-usage comparison in the photographer CRM project notes.

1. Record observation time, provider, account/team, project filter, current
   plan, billing cycle, currency, units, and exact UTC start/end timestamps.
   Compare two adjacent completed seven-day windows within the same provider
   and scope. Keep incomplete billing-cycle totals separate. Record missing
   access or retention as a gap rather than substituting another metric.
2. Record the following meters and their current allowances from the provider.
   Retain a sanitized table or screenshot in the dated project evidence note;
   keep credentials, customer records, and private media out of evidence.
3. Explain material changes using deployment/run counts, releases, traffic,
   known tests, and accessible route samples. Label correlation and attribution
   limits. Create a scoped follow-up with an owner and next review date when
   the cause remains unknown.

| Provider and scope | Record | Interpretation |
| --- | --- | --- |
| [Vercel Angels Rest](https://vercel.com/jesse-pomeroys-projects/angelsrest/usage) | Origin and visitor transfer separately; invocations; active CPU and memory; build CPU; Deployment/Functions Storage; deployment count | Preserve dashboard timezone/units. Weekly build CPU also changes with build count. Storage meters are not a retained-file inventory. Check homepage requests and storage growth first, as identified in COST-01. |
| [Convex team](https://dashboard.convex.dev/t/thinkingofview/settings/usage), then `angelsrest-crm` | Calls, action compute, database I/O/storage, file storage/egress, search storage, deployments; team allowances | Team capacity is shared. Project totals include deployments, not just production or one tenant. Compare storage as gauges (final day or mean daily value); never sum daily bytes into consumption. Convert GB-seconds to GB-hours only by dividing by 3,600. |
| Resend account | Billing cycle, monthly and daily sent counts/allowances, domains, failed delivery trend | Daily and monthly allowances are separate; refresh reset dates. |
| Cloudflare account and applicable Workers/R2 resources | Metered usage, cycle projection, subscription fees, latest paid invoice, storage and request meters | Projection is not an invoice. Keep base subscription fees separate from metered usage and avoid duplicating them across projects. |
| [GitHub account billing](https://github.com/settings/billing/usage), then repository workflow records | Actions minutes by runner SKU, Actions storage, Packages transfer/storage, gross/discount/billed amounts; repo run counts and durations | Billing is account-wide; workflow metadata duration is not billed runner time. Do not read an absent/deleted run record as proof of no execution. |

Use the current dashboard allowance rather than hardcoding a plan's quota.
Investigate at **75% of an allowance** or when a provider's cycle projection
approaches that allowance; treat **90%** as urgent planning. Also investigate a
usage or storage rise above **25% across two consecutive completed weekly
comparisons**, or any new billed overage. These are review triggers, not service
guarantees or automatic spending controls. Small absolute usage may explain a
large percentage; record both.

For storage growth, distinguish larger new bundles from more retained builds
and accrued billing-period usage. Inspect inventory and retention settings
read-only before proposing deletion. For homepage volume, use route/time
samples available under the existing plan and distinguish monitors, tests, and
visitor traffic only when evidence supports it. Do not upgrade observability
or reduce monitoring merely to complete a table.

End the note with: period comparison; allowance headroom; actual billed amount
where known; unexplained changes; action/owner/review date; and evidence gaps.
Plan upgrades, paid tooling, retention deletion, customer allowances, and
commercial hosting selection remain separate decisions. See
[Vercel footprint controls](VERCEL_FOOTPRINT.md) for existing controls and
[Vercel storage accounting](https://vercel.com/docs/deployment-storage) for the
distinction between storage observations and billing.
