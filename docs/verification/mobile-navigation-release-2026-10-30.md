# Mobile navigation release

## Shipped behavior

The public navigation keeps its animation running after the opening motion
settles. The renderer still loads only after interaction, budgets visible idle
work to 30 frames per second, pauses while the document is hidden, and respects
reduced motion. Keyboard focus remains visible and Escape returns it to the
navigation trigger.

Admin **6.9.1** adds modal keyboard and scroll ownership to the mobile navigation
and editor section drawer. Closed drawers are inert. Escape, backdrop dismissal,
route changes and desktop resizing release the drawer and its scroll lock.
Short landscape screens scroll the whole sidebar so footer links remain
reachable; navigation targets are at least 44 pixels tall. The drawer paints
above the host's bottom navigation, and the editor rail stays available between
641 and 768 pixels.

## Source and deployed versions

- Public source [#731](https://github.com/JessePomeroy/angelsrest/pull/731):
  merge `8e1c24981a922c87a4d0ddd9c6e12272e4da31a7`.
- Admin source [#281](https://github.com/JessePomeroy/admin-dashboard/pull/281)
  and version [#282](https://github.com/JessePomeroy/admin-dashboard/pull/282):
  published **6.9.1**, package release source
  `4892089f2942813689c29d53332016484ce93fcf`.
- Host adoption [#732](https://github.com/JessePomeroy/angelsrest/pull/732):
  merge `c4e761c90b3a4d2e24f3e7568feff50f0fbb61fc`.
  Production deployment `dpl_HjUpBvVmkS3J3h319z87E91nG1Za` reports READY
  and serves `www.angelsrest.online` at that source revision.

The editor header and upload-layout redesign being discussed separately is a
local draft and is not part of this release.

## Verification and recovery

The source PR's required CI passed, including the actual idle-animation and
keyboard browser regressions. The idle regression failed before the fix and
passes after it; it checks continued updates beyond the opening motion, the
frame budget, hidden-document pause and resumption. Local Admin checks covered
Chromium and Firefox in both themes; all 1,082 package tests passed in CI.

The exact adoption candidate
`59543992b94b0db13bb770186642c032d8bc7142` passed required PR CI and separate
staging CI [41051824026](https://github.com/JessePomeroy/angelsrest/actions/runs/41051824026),
artifact `12975014543`. Isolated staging deployment
`dpl_33Xrc2igciNhqQmCVfMW275qgaa6` served
`https://staging.angelsrest.online`; observation receipts passed `/` and `/cart`
and the pre-merge adoption gate returned `evidenceReady: true`.

Authenticated synthetic staging checks passed in both themes for closed-drawer
Tab order, focus entry/trapping/return, Escape and backdrop dismissal, resize
cleanup, 740×360 landscape scrolling, target size and layering, destination
dismissal, editor section navigation, 700-pixel rails and session reload.
No uncaught browser errors occurred. Three incidental admin mutation requests
were blocked during these navigation-only checks; provider writes and private
production records were not used.

The final production browser probe at 12:47 UTC verified the exact serving
deployment before and after interaction: icons continued beyond four seconds,
the renderer drew nothing before interaction, visible idle work used eight draws
in 1,097.5 milliseconds, Escape restored focus, and no runtime errors occurred.
This is live behavior and source-binding evidence, not a claim that Vercel
served the CI artifact's bytes.

Final post-merge main CI
[41056374139](https://github.com/JessePomeroy/angelsrest/actions/runs/41056374139)
passed on the exact final host source. Its immutable artifact `12978092272` was
matched to the serving production deployment in the final observation at
12:57 UTC. Both `/` and `/cart` passed, the deployment was healthy, and no
unresolved record IDs remained. The retained receipt is
`observation-6ec0be8e032b536bc215cd87963119bc5130941244a471532cb0929f84c82835.json`.
Provider binding remains source-only.

The verified pre-adoption production recovery remains
`dpl_MHpUtij4hsyxRtwLrD6aa1Nnm5dZ` at source `8e1c2498`, with main-CI artifact
`12976625251` from run `41051515814`. The prior Admin 6.9.0 production and
isolated staging deployments also remain retained. No deployments were deleted.
Sanitized browser proofs, provider metadata and complete CLI observation/gate
receipts remain in the operator workspace `angelsrest-mobile-nav-20261030`.

## Handbook comparison gap

Direct Paper editing tools are unavailable in this session. Existing editable
boards, source baselines and comparison dates remain unchanged. The screen
inventory records this release as `pending-paper-sync`; a matching viewport,
theme, data and state comparison is still required before marking a board
verified. Staging authentication checks establish navigation behavior only, not
acceptance of unrelated admin or provider workflows.
