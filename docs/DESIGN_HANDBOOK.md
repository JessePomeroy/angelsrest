# Living design handbooks

These references document the current implementation, not a redesign or a
replacement for source code. Review date: **2026-09-16**.

- [Angel's Rest — public handbook](https://app.paper.design/file/01M25K34J49JSK8D34H0HGQCW1/2-0)
- [Angel's Rest Admin Dashboard — handbook](https://app.paper.design/file/01M25K34Z4EFZ5BEPJ49JBF0X1/2-0)
- [Machine-readable screen inventory](design/screen-inventory.json)

## Reference pass and coverage

The handbooks contain **134 editable screen/state boards: 62 public and 72
admin**. The public boards retain their 2026-09-10 browser comparison. All 72
admin boards were regenerated in place from `@jessepomeroy/admin` 6.1.1 on
2026-09-16, and their editable top-level layer structure was audited against the
fresh captures. Paper's renderer timed out on both full-board and small-node
screenshot checkpoints, so the admin visual comparison remains pending. Seven
additional Start Here, Foundations, component and behavior guides were reviewed
for readability and source accuracy. Guide boards are not application replicas.

Public screen references remain `compared-with-limitations`; admin references are
`paper-updated-comparison-blocked`. Neither status is a pixel-perfect or
end-to-end claim. Text, frames, SVGs and original image assets remain editable.
Screenshots are comparison evidence, not flattened finished UI. This is a
representative template/state pass, not every route × state × theme combination.
Remaining candidates and specific mismatches stay in the inventory.

| Handbook | Compared coverage |
| --- | --- |
| Public | Home, navigation, portfolio index/detail/lightbox, shop, print/print-set templates, selected print options, physical/digital/unavailable products, drawer/full cart, blog index and all five article presentations, About and complete contact form |
| Admin | Browser-observed and regenerated in Paper: dashboard, orders, inquiries, CRM, board, invoices, quotes, contracts, email templates, messages, platform, delivery gallery management, settings/page/portfolio/product/blog editors, product/post/author/category details, login and host session presentations. Paper visual checkpoint pending. |
| States/layouts | Light/dark examples, tablet gallery/About, short landscape, expanded menus, selected/disabled controls, cart limits/busy/error/expiry, contact readiness/sending/success/failures, complete client/invoice/contact-editor forms, admin empty/read-error/loading/save-error examples |

The source baseline is merge commit `eeb01b9cf88de5d0edb931a55cf09e1517ee7f68`.
The installed shared admin package is `@jessepomeroy/admin` **6.2.0** as of the
September 17 package adoption. The boards were captured with 6.1.1; the 6.1.2
invoice-identity correction did not change their visual structure. Version 6.2.0
adds owner-only file uploads and file labels/cards in delivery-gallery management;
those affected states still require a Paper update and comparison. Capture
provenance is unchanged. This is not a claim about the deployed site's version.

Each Paper file has Start Here & Foundations, Components & States, Desktop,
Mobile, and Interaction & Additional Layouts pages. Use the inventory for exact
board links; shared patterns do not require one board per content record.

## Scope and source authority

Contact lives on About; there is no separate public `/contact` page.
Private `/delivery/[token]`, document client portals and provider-hosted checkout
screens are excluded. The new authenticated Stripe setup portal is tracked as a
pending admin-handbook reference using fictional data only. Admin delivery gallery management uses fictional records and no
private assets. Keep **portfolio galleries** and **delivery galleries** distinct.

The Admin 6.2.0 owner file-upload change adds an any-file picker for verified Angels
Rest creator membership and file labels in delivery-gallery management. The
handbook fixture defaults to the owner policy; add `uploadPolicy=media` for a
website client. Open a fictional gallery to inspect its uploader. These source
changes are newer than the current delivery-gallery boards. Paper tools were
unavailable for this pass, so the inventory marks their update/comparison
pending and records the local browser evidence and screenshot limitations.

| Source | Authority |
| --- | --- |
| `src/lib/styles/{theme,global,time-theme,article}.css` | Public palette, typography, reset, time periods and article rules |
| `src/routes/+layout.svelte`, `src/lib/components/` | Public shell, navigation, overlays and shared controls |
| `src/routes/{gallery,shop,cart,blog,about}/` | Public templates and composition |
| `src/lib/config/admin.ts`, `src/routes/admin/` | Host-enabled capabilities and mounted route wrappers |
| Installed `node_modules/@jessepomeroy/admin/` | Shared admin component/theme implementation; never edit installed files |
| `docs/CSS_MIGRATION.md` | Cascade and scoped-style constraints |
| `tests/browser/handbook/` | Safe data and provider/auth simulation, not production behavior |

Fixtures do not create application routes, change production aliases, bypass
real authorization or restore another content provider. No production dependency
was added.

## Foundations to preserve

- Body text uses Synonym; display headings use Chillax. The site loads Chillax
  400/600 and Synonym 400/500 from Fontshare. Some headings request weight 500
  while the browser selects Chillax 400. Verify the actual rendered face.
- Original static TrueType faces are available in Paper after the authorized
  installation/restart. Initially installed wider OpenType copies were moved to
  a recoverable private backup, not modified. Paper metrics still differ
  slightly, and browser-synthesized bold/italic is not reproduced exactly.
  Never outline text or flatten UI to conceal a mismatch.
- Paper includes source-bound tokens and editable original-font specimens.
  Readable handbook annotations are separate from application-size typography.
- Public page bases are `#f1f5f9` and `#1e293b`; surfaces retain source OKLCH
  values. Six local-time periods affect accent, tint and glow independently of
  light/dark preference. Foundations show all six accent pairs; screen
  comparisons mostly use afternoon, not all twelve combinations.
- Public content is capped at 1400px with 16px mobile and 40px desktop gutters.
  Desktop navigation begins at 768px except coarse-pointer landscape no more
  than 500px tall. Intermediate portfolio/About layouts have separate references.
- Admin operations use a 220px sidebar and 1120px content maximum. At widths up
  to 768px they use a 56px header and off-canvas menu. The 64px sidebar brand
  seam is not a universal page-title height. Editor rails are 52px + 168px
  (section panel 160px at 641–1179px); its mobile-menu change is at 640px.
- The 6.1.x admin workbench uses 16px text, 48px-minimum square fields, inset
  control wells and restrained raised actions. Selected segmented choices use
  centered labels and tint without ornamental checks or nested borders.
  Preserve actual labels, icon lanes, native controls, table overflow and
  intentional screen clipping.
- Dashboard metrics have stronger scale and chart/activity lanes. Document
  editors use bounded section-and-field rows on wide panes and stacked groups
  on narrow panes; gallery/product workbenches retain larger uncropped media and
  visible draft status.
- At no more than 768px, dialogs become sheets with persistent handle/header,
  content-only scrolling, 240ms open/close motion and handle-only downward drag;
  reduced motion remains immediate. Quote and contract tabs wrap instead of
  creating a nested scroll strip.
- Use original public imagery, framing and SVGs. Grain may be a static
  source-canvas texture, but UI remains native. GIFs, GPU effects, loading
  pulses and pointer response are not made deterministic by a screenshot.

## Safe previews

For normal public inspection, start from the repository root:

```bash
pnpm dev --host 127.0.0.1 --port 5197 --strictPort
```

Use Vite's reported URL. Inspect configuration without printing secrets, record
the exact PID, and stop only that process afterwards. Public reads may use
published Convex content. Do not exercise checkout, inquiry or provider writes.
This pass used isolated public configuration without loading the repository's
private environment file.

No authorized local admin account/backend was available. The dedicated harness
renders **actual installed components**, host capabilities and fictional data
without visiting authenticated production pages:

```bash
pnpm exec vite --config tests/browser/handbook/vite.config.ts
```

It binds to `127.0.0.1:5199`. Examples:

```text
/?route=/admin&theme=dark
/?route=/admin&theme=light
/?route=/admin/crm&state=empty
/?route=/admin/crm&state=error
/?route=/admin/invoicing&state=loading
/?route=/admin/editor/products/demo-product-1
/?route=/admin/editor/blog/posts/demo-post-1
/?route=/admin/editor/blog/authors/demo-author-1
/?route=/admin/editor/blog/categories/demo-category-1
/?screen=login
/?screen=session&session=expired
/?screen=session&session=denied
/?screen=session&session=unverified
/?screen=session&session=loading
/public.html?presentation=caseStudy
/public.html?screen=product&kind=digital
/public.html?screen=product&state=sold_out
/public.html?screen=contact&state=ready
/public.html?screen=contact&state=success
```

Other article values are `standard`, `behindTheScenes`, `technical` and
`clientStory`. Contact supports `unverified`, `sending`, `error`,
`verification_error`, `verification_expired` and `verification_unavailable`;
the last has no dedicated board.

Admin queries are explicit fixtures. Mutations/actions reject; auth does not
contact a provider; notification auto-acknowledgment is disabled; application
fetch is rejected. Public contact alone handles a known POST entirely in memory
to simulate pending/200/503 responses. Fonts, modules and original public
images still require GETs. The verification rectangle is labeled as a fixture,
not a Turnstile replica.

URLs are starting points. Contact sending/success/error requires filling fields
with fictional `example.invalid` data and submitting **inside this fixture**.
Open client/invoice dialogs with their Add/New button. The inventory records
`setupUrl`, `setupSteps`, theme, motion and exact viewport per reference.
A query fixture is not proof that every loader on a page has the same state.

## Capture and compare

The one-shot helper uses existing Playwright tooling:

```bash
node scripts/capture-design-handbook.mjs \
  --url 'http://127.0.0.1:5199/?route=/admin&theme=dark' \
  --out /absolute/private/capture-directory \
  --key admin-dashboard-desktop --width 1440 --height 1000 --theme dark
```

Choose a private directory outside the repository. The helper writes a browser
PNG, a JSON draft of editable HTML groups and any decorative grain texture.
Capture basenames are in the inventory; evidence is not committed. This is
not synchronization or proof of fidelity.

The CLI starts without saved authentication, limits entry URLs to localhost,
rejects delivery/portal/API paths and blocks non-GET/HEAD browser requests.
It is not a general privacy sanitizer and does not prevent server-side effects
of unsafe GET routes. The exported `captureHandbookPage(page, directory, key)`
assumes the caller already established a safe page and request policy.

The clock is pinned to 2026-09-10 14:00 America/Detroit. Reduced motion is the
default; use `--motion no-preference` for matching references. For touch/coarse
pointer or interactive states, prepare a fresh Playwright context, apply the
inventory setup, then call the exported helper.

The export preserves observed wrapping, SVG paint, selected markers and some
native-control cues, but needs manual Paper comparison and correction. Native
date/select/checkbox chrome, textarea resize handles, blur composition,
gradients and synthetic fonts retain limitations. Hidden automation scrollbars
are not an application change.

Match viewport, data, scroll, theme, period, pointer and motion conditions.
Inspect type, wrapping, spacing, lanes, contrast, image framing, icons,
selected/disabled/focus state and clipping. Screen boards keep their viewport
crop; complete components use taller viewports; documentation grows to fit.
Update existing editable boards in place. A successful editable-node import is
not a visual comparison; keep `lastVerified` empty when Paper cannot render a
checkpoint image.

## Behavior evidence and remaining gaps

Observed locally:

- Lightbox arrows, 24-image wrap, Tab/Shift+Tab trapping, Escape and opener
  restoration at desktop, mobile and short landscape.
- Cart drawer/full-page flow, decrement-at-one removal, mobile cap 20, expired
  local-cart notice and simulated busy/error checkout. Requests were intercepted
  in the browser; **none reached the checkout server**.
- Selected print options survive URL reload at desktop/mobile.
- Expanded mobile/landscape navigation, keyboard reposition, saved position,
  Escape/backdrop focus return and renderer context-loss handling.
- Contact missing-name/email validity, readiness/pending disabled states,
  success reset, error retention and verification-failure UI with local stubs.
- Add Client/New Invoice modal containment, Escape/opener restoration, disabled
  actions and simulated client save failure retaining the dialog and toast.

Important gaps:

- Real authentication, membership enforcement, recovery, persistence, uploads,
  publishing, email, billing, fulfillment and private assets were not tested.
  Session boards render real host markup with synthetic auth results.
- Pending AuthGuard painted no visible loader in this fixture: its five lines
  had zero width. The invoice loading fixture did show a skeleton. This is
  documented, not fixed or claimed as a production authentication diagnosis.
- The liquid-navigation water renderer never reported healthy rendering in
  the capture browser. Expanded boards show CSS fallback; Paper omits
  problematic backdrop blur. Healthy GPU refraction remains unverified.
- Swipe, drag/fling, browser-history edge cases, general transient toast/
  navigation-progress states and route-specific forms/filters/confirmations are
  not exhaustively covered. See each screen's remaining state survey.
- Font, gradient, native-control and static-effect differences are recorded.
  These references are not accessibility certification or end-to-end tests.
- Paper accepted the complete 6.1.1 admin imports and all 72 canonical artboards
  passed a top-level editable-structure audit. Its screenshot endpoint still
  timed out after normal and software-rendered desktop restarts, including for a
  small header node, so those boards are not marked visually re-verified.

## Maintenance contract

**Implement → inspect in browser → update Paper → compare → update inventory.**

1. Read instructions and Git state. Identify affected template/state keys and
   package versions. Preserve unrelated studies and local changes.
2. Establish safe data and actual behavior. Add missing states to the inventory;
   a successful render does not prove a flow.
3. Update native editable boards in place, reusing source tokens and examples.
   Do not redesign the application while documenting it.
4. Compare screenshots and correct discrepancies. Record unavailable states,
   simulated data and unresolved rendering differences.
5. Update source/setup, Paper identifiers, evidence and dates. `lastVerified`
   is non-null only after that exact browser/Paper comparison;
   `browserObservedAt` alone means a render observation. Documentation has a
   separate review date and no application verification claim.
6. Run checks, report gaps, stop owned previews and release Paper indicators.
   Do not commit, push, publish or deploy without separate approval.

`AGENTS.md` requires this for new screens and material UI changes. Shared guides
use `documentationReferences` and `coveredByReferenceKeys` instead of pretending
an artificial component sheet is an implemented route.

## Verification recorded on 2026-09-16

- All 72 admin screen/state references rendered from the 6.1.1 package with the
  inventory's fictional data, viewport, theme, motion and interaction setup.
- The subsequently merged 6.1.2 package was diffed against 6.1.1. Its only
  runtime change is behavior-only invoice identity capture during a pending
  overdue-reminder action; no represented board structure changed.
- All 72 existing canonical Paper artboards were replaced in place with native
  editable frames, text and SVGs. Their expected top-level layer sets matched the
  fresh capture drafts with zero structural mismatches; old modal/marker roots
  and the temporary validation board were removed.
- Start Here, Foundations, and Components guidance now documents the 6.1.x
  workbench, document-pane, segmented-control, mobile-sheet and tab behavior.
- Representative browser captures were visually inspected. Paper screenshot
  checkpoints timed out for both large and small nodes, so all admin
  `lastVerified` values are intentionally null pending visual comparison.
- `pnpm lint` passed. `pnpm check` passed with zero errors/warnings when
  `PUBLIC_CONVEX_URL` and `PUBLIC_CONVEX_SITE_URL` were supplied; no environment
  file was changed. Both were rerun after the documentation update.
- Both capture-helper regression tests passed: visible/hidden content, wrapping,
  password masking, disclosures, SVG paint, modal-layer escape and control cues.
- Inventory key/source/setup/viewport consistency and the 72-board Paper
  structure audit passed. The 62 public references retain their 2026-09-10
  visual comparison status and were not changed in this update.
- The application unit, protocol and package suites passed: 2,062 Vitest tests,
  27 protocol tests, 6 Vercel-adapter tests and 14 print-catalog tests. The CRM
  API TypeScript check also passed.
- The production build passed. Its output retained the known optional-dependency
  trace warnings for React Email rendering and platform-specific Sharp packages.
- The browser suite passed 312 Chromium cases with 10 expected skips. WebKit
  could not start on this workstation because its MiniBrowser requires
  `libicudata.so.74`, which is unavailable; a focused rerun reproduced the same
  launch-time dependency error before page creation.
- Task-owned preview and Paper processes were stopped after releasing Paper's
  working indicators.
- No real authentication, backend/provider workflow or deployment was claimed.

## Stripe setup source update — September 21, 2026

The host platform panel now shares a stable client setup page and says “setup
started” for account existence. The new `/portal/stripe/[siteUrl]` page reuses
admin tokens and LoginPage, separates charges from payouts, and renders sign-in,
setup disabled, setup required, pending verification, restricted, ready,
unauthorized, unavailable, and session-expired states. These source changes are
newer than the platform Paper boards. Existing board IDs are preserved.

Local Chromium checks passed 20 desktop/mobile cases: login-error recovery,
POST to the tenant setup action intercepted locally, separate payout status,
ready dashboard access, sign-out failure recovery, disabled/error/expired states,
and viewport containment. Browser captures at 1440×1000 and 390×1000 used the
actual page component and actual host platform wrapper with fictional records.
The operator client selector and clipboard action were exercised at both sizes;
no page/console errors or horizontal page overflow were observed. Representative
screenshots were inspected visually. The fixture does not authenticate against
Better Auth or create/retrieve accounts with Stripe.

Safe starting URLs on the existing handbook server:

- `/?screen=stripe-setup&phase=signed_out`
- `/?screen=stripe-setup&phase=pending_verification&returned=1`
- `/?screen=stripe-setup&phase=ready`
- `/?route=/admin/platform&onboarding=true&theme=dark`

Other `phase` values: `new`, `setup_required`, `restricted`, `disabled`,
`unauthorized`, `unavailable`, and `expired`. The platform fixture now renders
the host wrapper instead of only the installed PlatformPage. All provider/auth
calls remain refused; use the browser tests for the locally intercepted form.
Temporary capture evidence: `/tmp/angelsrest-c2a-evidence/` (not committed).
A focused local WebKit rerun could not launch because `libicudata.so.74` is
unavailable. CI installs its own WebKit system dependencies; local WebKit
coverage is not claimed.

Paper and 21st tools were unavailable for this pass. The inventory explicitly
marks the new portal and changed platform references as needing a Paper update
and comparison, with `lastVerified: null`. This is browser/source verification,
not a completed Paper comparison or real-provider acceptance.

## Client supplier setup source update — September 21, 2026

The platform client selector now links to the creator-only
`/admin/platform/lumaprints/[siteUrl]` setup page. Its native store selector and
ownership/billing confirmations reuse admin tokens. It separates saved identity
from shop activation and renders disabled, unauthorized, unavailable,
unconfigured, available, connected, historical-review and verification-error
states. Source setup is disabled by default.

All 18 focused desktop/mobile Chromium cases passed, covering required fields,
the exact native POST, confirmation reset after changing stores and state
containment. Manual browser inspection used the actual page and platform wrapper
inside AdminLayout with fictional records at 1440×1000 and 390×1000. Store
selection, both confirmations, reset behavior and the selected client's link
were exercised; representative mobile form/saved and desktop error/disabled
screens were visually inspected. No console errors/warnings or horizontal page
overflow were observed. Images were inspected in the browser session; no durable
capture-file artifact is claimed. No real auth/provider operation was performed.

Safe handbook entry:
`/?route=/admin/platform/lumaprints/studio.example.invalid&phase=available&theme=dark`.
Use the state names above for `phase`, with `error` for the verification-error
fixture. The normal browser test harness also exposes `?fixture=lumaprints-setup`.

Paper WebMCP can read the existing reference, but the browser is signed out and
font/edit operations require edit access. No Paper board was changed or marked
verified. The inventory preserves existing platform IDs and records the new
setup reference and same-state comparison as pending owner access under C6.
21st tooling was unavailable; existing admin patterns supplied the design.
