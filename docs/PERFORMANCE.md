# Homepage performance measurement

Optimize the public homepage without changing its photography, typography,
navigation, commerce behavior, or normal-motion identity. A Lighthouse score is
a lab measurement, not a whole-site audit or real-user Core Web Vitals result.

## PERF-01 baseline — September 23, 2026

The initial audit was repeated after the unrelated login PR #650 merged.
The implementation baseline is production source
`9d3a112e3a6362b51d35528fa1a16e6359a9ccce`, served by READY deployment
`dpl_7Vefwak1X8u6jh2vCPJzrm3mHP2F` at `https://www.angelsrest.online/`.
The deployment identity was checked before and after measurement in read-only
Vercel CLI results. Those checks were observed in the task transcript, not saved
as separate raw provider-response artifacts.

Three sequential fresh-browser runs per profile used Lighthouse 13.5.0,
Chromium 154, and hardware rendering on an NVIDIA RTX 3070. All six completed
without warnings. Each run explicitly selected dark mode, America/Detroit,
and ordinary motion; the observed time-theme period was `evening` throughout.
Mobile used the default simulated mobile network and 4× CPU slowdown; desktop
used the desktop preset. A desktop GPU does not emulate a physical phone GPU.

| Metric | Mobile median | Desktop median |
| --- | ---: | ---: |
| Performance | 49/100 (48–50) | 96/100 (96–96) |
| First contentful paint | 1.79 s | 0.52 s |
| Largest contentful paint | 6.25 s | 1.30 s |
| Total blocking time | 1,798 ms | 88 ms |
| Cumulative layout shift | 0.073 | 0.013 |

The dated Obsidian roadmap owns task status. Its sibling evidence directory
`performance-evidence-2026-09-23/perf01-baseline-9d3a112e/` retains each HTML/JSON
report, per-run context, and embedded report screenshots. The parent evidence
directory's `capture.mjs` records the measurement procedure. Raw traces were not saved for this baseline;
capture them when isolating effects. Do not commit customer data, browser
profiles, credentials, or large measurement artifacts to this repository.

The earlier 48/95 audit and its single reduced-motion control remain historical
evidence. Initial software-rendered mobile runs timed out; they are excluded.
Reduced motion changes multiple effects at once and does not isolate a cause.

## Reproduce a comparison

1. Record exact source and deployment revisions before and after measurement.
   Use a production build, not the development server. Do not compare different
   revisions accidentally through a moving alias.
2. Pin Lighthouse/Chrome versions. Start isolated profiles, clear browser cache
   between samples, and run sequentially without competing builds or audits.
3. Verify the actual GPU renderer. On this Linux host, ordinary headless launch
   selected SwiftShader; `--enable-gpu` selected hardware rendering. A flag alone
   does not prove acceleration. Keep software and hardware results separate.
4. Match theme, time period, timezone, motion preference, viewport, device scale,
   and throttling for baseline and candidate. Record the observed DOM attributes
   as well as requested settings. Re-measure the baseline if these differ.
5. Run three samples per profile, retain warnings/errors, and report medians and
   ranges. Preserve a fresh output directory for each comparison. Do not silently
   discard slow valid runs or mix reduced-motion controls into ordinary results.
6. Keep optional effects enabled for the main comparison. Measure deferred work
   during real interactions too, rather than moving it outside the score window.

For a default-preference CLI diagnostic, use an explicit Chrome path and a fresh
output directory with this command; append `--preset=desktop` for desktop:

```zsh
CHROME_PATH=/absolute/path/to/chrome \
  pnpm dlx lighthouse@13.5.0 https://www.angelsrest.online/ \
  --only-categories=performance \
  --chrome-flags='--headless --enable-gpu' \
  --output=json --output=html \
  --output-path=/absolute/path/to/new-evidence/mobile-1
```

This CLI command alone does not reproduce the controlled theme/timezone setup.
Use browser media/timezone emulation and record page context for a comparable
controlled run. The evidence capture used a fresh Puppeteer page passed to
Lighthouse; it selected dark media emulation and set the isolated browser's saved
`theme` preference to `dark` before page scripts, without changing application code.
Use the installed project tools for subsequent checks; no Lighthouse dependency
or automatic production audit has been added to the application.

## Interpretation and scope

### PERF-02 local hero comparison

The responsive 400px GIF is 258,328 bytes versus 672,091 bytes for the original
(61.6% smaller). This saving applies to low-density small viewports, not to the
default 1.75× Lighthouse mobile profile, which retains the original 800px GIF.
Intrinsic dimensions reserve the existing aspect ratio before either image loads.

An alternating original/candidate comparison used three fresh runs per version
at each density, otherwise matching the mobile settings above, with dark `night`
theme and normal motion. Both were local production builds: baseline `7002863e`
(runtime unchanged from `9d3a112e`) and the PERF-02 working tree based on it.
The evidence folder's `compare-hero.mjs` and `perf02-alternating-v3/` retain the
procedure, reports, audit-time viewport, and selected network request.

| Profile | Score median (range), before → after | LCP median, before → after |
| --- | --- | --- |
| Mobile, 1× density | 47 (44–53) → 57 (56–65) | 7.48 s → 5.23 s |
| Mobile, 1.75× density | 46 (45–51) → 47 (47–48) | 7.31 s → 7.19 s |
| Desktop, separate sequential batches | 96 (96–96) → 96 (95–97) | 1.29 s → 1.32 s |

The 1× LCP ranges were 5.80–7.56 s before and 3.82–5.33 s after. The 1.75×
ranges overlapped (5.94–7.39 s before, 7.18–7.28 s after); do not claim a
reliable high-density speed improvement. Initial non-alternating mobile batches
were slower after the change (5.96 → 7.39 s median), prompting this investigation;
those reports remain preserved, not discarded. None of these local results is a
post-deployment measurement or comparable directly with the evening production
baseline. The first two alternating attempts stopped on a harness validation
error: a post-audit device-pixel ratio was not the audit-time ratio. They are
excluded; the corrected runner captures the viewport during document loading.

All completed comparison runs were warning-free. Candidate CLS was approximately
0.00007 mobile / 0.00008 desktop; original runs intermittently shifted by 0.073
mobile / 0.020 desktop. Chromium and WebKit tests hold the actual image request,
verify reserved geometry, release it, and confirm no image-induced size change.
WebKit coverage is engine-level emulation, not a physical iPhone test. Both
densities request only the intended variant during loading. Fonts/effects remain
unchanged; the broader mobile performance targets are not yet met.

First address the hero's transfer size/loading priority/intrinsic dimensions
and the external font waterfall. Profile effects one at a time before changing
them, then reassess remaining startup JavaScript. Preserve navigation and cart
functionality when optional rendering fails or reduced motion is requested.

Proposed goals are mobile median 90+, LCP ≤2.5 seconds, TBT ≤200 ms and CLS ≤0.1,
while preserving desktop performance and visual fidelity. They are goals, not
promised outcomes. The homepage results do not diagnose gallery/shop routes,
backend capacity, or Vercel storage. Those require their own relevant evidence.
