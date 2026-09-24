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

### PERF-03 font delivery and measurement limits

The existing Chillax 400/600 and Synonym 400/500 declarations now ship with site
CSS. Their original Fontshare CDN files, format fallbacks and `font-display: swap`
remain unchanged. A CORS preconnect warms that existing font origin. The external
API stylesheet request is gone; no extra font preload was justified. No font
binaries were redistributed/subsetted, and no CSP, dependency or infrastructure
change was needed. The CDN remains an external dependency; fallback text still
works when it is unavailable.

Three alternating original/candidate runs per profile used the same production
build baseline `a2e4d3bd`, normal motion, dark/night and hardware renderer.
The default simulated mobile result was **worse**, so it was retained and
investigated rather than reported as a speedup:

| Comparison | Score median, before → after | FCP median | LCP median | TBT median |
| --- | --- | --- | --- | --- |
| Default simulated mobile | 48 → 44 | 2.00 → 2.40 s | 6.30 → 7.36 s | 2,185 → 2,588 ms |
| Default simulated desktop | 96 → 96 | 0.54 → 0.61 s | 1.27 → 1.26 s | 71 → 105 ms |
| Applied DevTools throttling, mobile control | 56 → 57 | 1.43 → 1.44 s | 6.10 → 6.12 s | 918 → 880 ms |

The applied-throttling control used three new alternating pairs, not substituted
results or the same scale as simulated scores. These three pairs did not reproduce
a meaningful paint regression; their ranges overlap, but do not establish
equivalence. Median final font download completion improved
from 2.393 to 2.298 s; CLS remained approximately 0.00007. In the unthrottled
traces underlying simulation, mobile FCP improved from 333 to 258 ms and final
font completion from 372 to 275 ms. These are different conditions, not physical
phone measurements or proof of a large page-speed gain.

The simulator's FCP graph includes VeryHigh-priority resources that finished
before the observed paint. In the first two candidate traces, fonts finished
before paint; in all baseline traces and the third candidate they finished
afterward. That matches the slower simulated FCP in those two samples. This is
evidence consistent with a simulation artifact, **not proof that every score
difference is artificial**. [Lighthouse's throttling documentation](https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md)
describes the limits of both simulation and request-level throttling. Retain both
methods when assessing later changes; do not optimize the site to manipulate the
model. Fonts are a modest delivery improvement; effects and hero transfer remain.

Evidence is in `perf03-alternating/`, `perf03-applied-throttling/` and
`perf03-visual/`, with `compare-pages.mjs` preserving the alternating procedure.
Mobile-dark and desktop-light snapshots cover home, gallery, shop and the observed
`/shop/time-aware-theming-kit` product. Sampled typography and text geometry matched
exactly before/after. Browser tests load all four faces while blocking the old API
stylesheet, and verify visible text/navigation when the font CDN fails. The former
test was observed failing against the baseline before passing against the candidate.

### PERF-04 effect attribution — September 24, 2026

An isolated production build of `2e6701eb` was profiled with Chrome 154,
verified RTX 3070 rendering, 412×823 / 1.75× mobile emulation, dark/night,
normal motion (except its named control) and America/Detroit. Applied CDP throttling used 4× CPU slowdown,
562.5 ms request latency and 1474.56/675 Kbps download/upload. Three
counterbalanced fresh-browser samples per variant retained raw traces, CPU
samples, long tasks, WebGL-call timings and navigation results.

The diagnostic measures startup through 12 seconds, then four seconds idle,
then opening navigation and following Gallery. Its **startup blocking** is the
sum of each long task's excess over 50 ms in that startup window: it is **not
Lighthouse TBT or real-user INP**. Trace/probe overhead is present in every run;
these results do not emulate a phone GPU. Effect switches exist only in the
diagnostic browser, not application code.

| Diagnostic variant | Startup blocking median (range) |
| --- | --- |
| Ordinary baseline | 778 ms (734–815) |
| Liquid-navigation import blocked; existing bottom navigation retained | 250 ms (234–444) |
| Grain WebGL context disabled | 554 ms (531–599) |
| Gradient held at its existing static positions | 700 ms (699–894) |
| Full reduced-motion preference | 280 ms (251–383) |

Liquid navigation has the largest attributable startup cost in this environment;
grain is a secondary contributor. The gradient's ranges overlap the baseline,
so these samples do not justify changing its appearance or motion. Deltas are
not additive: interventions also change resource/initialization timing.

A further three alternating pairs retained the navigation and renderer downloads
but refused only the water canvas context. Startup blocking fell from
**815 ms (812–962) to 378 ms (279–436)**. Gallery navigation passed in both cases.
This isolates graphics initialization, not merely loading the navigation module.
In one representative 498 ms startup task, CPU samples attribute approximately
262 ms to graphics-extension queries, 85 ms to canvas sizing and 85 ms to context
creation. Module evaluation inside that task took approximately 17 ms. Other
ordinary traces also show extension/context/sizing costs; grain shader-status
queries contribute to a separate initialization stall. Sampled wall time can
include native waits and CPU throttling, not just JavaScript execution.

No variant produced a long task in the four-second idle window, but recurring
work remains: median renderer-main task time was 753 ms normally versus 428 ms
without liquid navigation, and 186 ms under reduced motion. These totals are
instrumented task time, not GPU utilization or battery measurements. All 21
matrix/control navigations passed without page errors or 5xx. The interaction
uses a touch tap to open the sphere, then a browser mouse click on Gallery; it
is not physical-phone or touch-only coverage, and fallback paths need fewer
actions. Do not compare those interaction durations as equivalent speed tests.
The local-only Vercel analytics-script 404 remains a known preview limitation.

Evidence: `perf04-effects-matrix/` and `perf04-surface-control/`, generated by
`profile-effects.mjs` and its supervised runner in the Obsidian evidence folder.
`analyze-effects-trace.mjs` emits `trace-analysis-v2.json`; its recursive-frame
deduplication and interval clipping supersede the first analysis artifact.
An initial probe failed on a zero-size wrapper visibility assertion; the next
successful probe used an eight-second startup window that included settling in
its following idle phase. Neither is mixed into the final twelve-second matrix.

**Bounded PERF-05 proposal:** preserve the shader, animation cadence, resolution,
navigation behavior and accessible fallback. First remove redundant initial
canvas sizing in the existing renderer and evaluate grain shader-status checks
after linking rather than serially blocking on each shader. Re-measure startup
and interactions, including failure/context-loss/reduced-motion behavior.
[Three.js documents combined drawing-buffer sizing](https://threejs.org/docs/pages/WebGLRenderer.html#setDrawingBufferSize),
and [MDN explains blocking shader queries and link-first validation](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#avoid_blocking_api_calls_in_production).
These are candidate optimizations, not demonstrated gains. General-purpose
renderer capability probing may remain dominant; replacing the renderer or
simplifying the visual effect is a larger decision, not authorized by this
diagnostic. Do not remove the bubble, grain or gradient merely to improve a score.

After the measured effects work, reassess remaining startup JavaScript. Preserve
navigation and cart functionality when optional rendering fails or reduced motion
is requested. The asset/font changes and this diagnostic do not meet the broader
mobile targets yet.

Proposed goals are mobile median 90+, LCP ≤2.5 seconds, TBT ≤200 ms and CLS ≤0.1,
while preserving desktop performance and visual fidelity. They are goals, not
promised outcomes. The homepage results do not diagnose gallery/shop routes,
backend capacity, or Vercel storage. Those require their own relevant evidence.
