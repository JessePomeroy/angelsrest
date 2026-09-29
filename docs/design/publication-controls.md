# Consistent publishing controls

Implemented on September 28–29, 2026. Shared admin source and the portfolio
backend change ship in order; see the release record below for verified delivery.

## Interaction

| Saved publication state | Main action | Additional publication action |
| --- | --- | --- |
| Unpublished (including a previously hidden portfolio gallery) | Publish | None |
| Published, current revision | Unpublish | None |
| Published, draft changes | Publish changes | Unpublish in the adjacent disclosure |
| Archived blog content | None; restore remains in recovery | None |
| Published singleton page/settings with no unpublish capability | Publish changes, disabled until edits exist | None |

Unpublish asks for confirmation, keeps saved content, and removes public access.
Cancel does nothing. Saving a draft remains separate from publishing; the visible
publication status never uses “draft saved” to mean “not public.” Save draft is
shown when work needs saving. Product publication retains its existing save and
server-readback locks. Request errors preserve the observed publication state;
uncertain product results still require reconciliation instead of a duplicate write.

The primary action is an ordinary button with a changing label, not an ARIA
pressed-state toggle. The disclosure uses native details/summary, supports
Enter/Space, Tab to Unpublish, outside-click dismissal, and Escape with focus
returned to the main button. Publish never doubles as an immediate unpublish of
pending draft changes.

## Coverage and deliberate distinctions

| Surface | Result |
| --- | --- |
| Products, all six kinds | Header publication status/control replaces bottom “remove from Shop”; permanent deletion remains separate |
| Portfolio gallery detail/list | Hidden is presented as Unpublished; Show/Hide removed; published filter includes live galleries with draft changes |
| Blog posts | Header control replaces the bottom unpublish button; archive/restore remains separate |
| Blog authors/categories | Same control and list status language; backend reference checks still reject unsafe unpublication |
| About, Contact, homepage quote, Modeling, site settings | Shared status/Publish changes presentation where configured; no invented unpublish endpoint |
| Modeling category checkbox | “Include when publishing” makes clear that it edits the page draft rather than immediately changing the live site |
| Product sale availability | “Not for sale” remains distinct: it controls purchasing rather than publication |
| Private delivery galleries | Inspected, unchanged: publish/archive/restore controls client delivery access, not public portfolio visibility |

Angels Rest currently omits the Contact publish capability and deliberately hides
the About Publish button in its host wrapper. Those restrictions remain intact.
The shared homepage quote and Modeling editors are checked as package components;
they are not exposed as standalone routes in the Angels Rest browser fixture.
Singleton pages/settings have no backend unpublish action. Removing a page route,
its navigation entry, and its content are not interchangeable operations.

## Implementation and release order

- Shared source: `../admin-dashboard/src/lib/pages/editor/PublicationControl.svelte`,
  the document editors and their collection status presentations.
- Backend: `packages/crm-api/convex/portfolioGalleries.ts`. Publishing sets
  `isVisible: true` atomically, including republishing the same revision. Unpublish
  uses the existing authorized visibility mutation; no schema migration or new
  public endpoint is introduced.
- Publish the backend change before adopting the shared admin release. Otherwise
  a previously hidden gallery could still remain hidden on an old backend.
- Initial implementation used `fix/editor-publication-controls` in both repositories.
  Delivery is recorded below. No production content records or environment settings
  were changed; unrelated local work was preserved.

## Research basis

[Webflow's CMS workflow](https://webflow.com/updates/cms-draft-publishing-improvements)
keeps edits to published items in a separate draft-changes state until publication.
[WordPress visibility guidance](https://wordpress.com/support/post-and-page-visibility/)
distinguishes unpublishing from other visibility settings. These support keeping
draft saving, publishing changes and taking content offline as distinct operations.

[W3C's button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/)
permits changing action labels without `aria-pressed`; a true toggle retains its
label. The particular primary-button/disclosure arrangement here is our design
choice, grounded in the existing admin layout and the owner's request for fewer
controls. Research accessed September 28, 2026.

## Verification and design-reference gap

- Shared admin: Svelte check 0 errors/0 warnings; full suite 1,001 tests passed;
  final save-button adjustment: 27 focused tests passed; final collection-filter
  adjustment: 21 focused tests passed; package build passed.
- Portfolio backend: 10 tests passed, including same-revision and new-revision
  hidden-gallery republication. Backend TypeScript check passed.
- Angels Rest: lint passed (365 files); Svelte check passed with a fictional
  `PUBLIC_CONVEX_URL` supplied for local type generation (no network operation).
- Reflecting Pool: application-source Svelte/TypeScript check against the modified
  shared admin source passed (0 errors/0 warnings) using a temporary TypeScript
  path override and fictional PUBLIC_CONVEX_URL/PUBLIC_SITE_URL values. The first
  broader check hit differing Rollup types in build configuration; the final check
  covers app source, not its Vite configuration or a new deployment. No tracked
  Reflecting Pool files or installed package versions were changed.
- Browser: 36 rendered states and 20 interactions at 390 and 1440 pixels, dark and
  light themes, no page errors or horizontal overflow. Covers products, portfolio,
  posts, authors/categories, hidden galleries and the current settings/About gates.
  Component tests cover successful mutations; browser provider writes are refused.
- Mobile screenshots for changed products, portfolio and blog, and the clean live
  portfolio header were visually inspected. Final desktop inspection confirmed
  collection/detail status agreement and wrapping blog filters. No production content was used.
- Repeat: start the existing editor preview with `ADMIN_EDITOR_SOURCE` pointing to
  the shared source on port 5218; run
  `node tests/browser/editor-document-pane/verify-publication.mjs`.
- Temporary evidence: `/tmp/angelsrest-publication-20260928/`.
- Impeccable detector: no findings on changed document surfaces. 21st CLI/context
  tooling and Paper editing tools were unavailable; existing project styles supplied
  the design. Paper boards were preserved. The screen inventory records a pending
  update/comparison, not a verified design-board match.


## Mobile alignment correction — September 29, 2026

Owner feedback identified the staggered 390-pixel layout as unacceptable. The
shared control now puts its publication status above one full-width action row
on screens up to 640 pixels. The dropdown aligns with both edges of that row.
The mobile saved-status line is omitted; unsaved, saving, conflict and error
feedback remains available. Desktop save indicators keep their existing styling.
The change applies to the shared control across document editors and does not
change any mutation, publication capability or backend state transition.

The browser regression now asserts full header width, status above actions,
hidden redundant saved labels, and matching dropdown/action edges. Follow-up
evidence and reviewed screenshots are in
`/tmp/angelsrest-publication-mobile-20260929/`. This supersedes the September 28
mobile screenshot referenced in the conversation. Paper update/comparison remains
pending because editing tools are unavailable.

Follow-up verification: 119 focused component tests passed; shared Svelte check
reported 0 errors/0 warnings; package build passed. All 36 browser states and
20 interactions passed with the new alignment assertions. Additional checks at
320, 390 and 1440 pixels confirmed Escape focus recovery and visible unsaved
feedback. Updated open/closed blog captures and product/portfolio mobile captures
were inspected. The focused Impeccable detector reported no findings.


## Release record — September 29, 2026

- Shared admin source merged in [admin-dashboard #257](https://github.com/JessePomeroy/admin-dashboard/pull/257).
  [Version PR #258](https://github.com/JessePomeroy/admin-dashboard/pull/258) published
  `@jessepomeroy/admin@6.5.5`; the immutable GitHub Packages version was verified.
- Portfolio backend merged in [Angels Rest #671](https://github.com/JessePomeroy/angelsrest/pull/671).
  [Production deployment](https://github.com/JessePomeroy/angelsrest/actions/runs/36558541763)
  succeeded against `loyal-swan-967` at CI-verified source revision
  `1e2b1059bd242a559d53ef4a4ab9a1be3b01f821`, whose tree matches the source merge.
- Host adoption pins the published admin package to `6.5.5` and updates the
  existing portfolio protocol assertion to the approved Publish/Unpublish labels.
  The automatic adoption preparation exposed that stale assertion; manual
  preparation keeps the same checks and package-manager lockfile update.
- Installed-package verification: host lint, Svelte check (0 errors/0 warnings),
  package-contract check, full test command including 28 auth/editor protocol
  tests, and the 10 portfolio backend tests passed. No source alias or provider
  writes were used for these host checks.
- The installed package also passed all 36 browser states and 20 interactions at
  390 and 1440 pixels without page errors or horizontal overflow. The mobile blog
  dropdown screenshot was inspected; evidence is in
  `/tmp/publication-ship-20260929/installed-browser/`.
- Admin source/version and backend source PR checks passed before merge. Host adoption CI and Vercel
  production status must be checked on the adoption PR before reporting it live.
  Paper update/comparison remains pending; no design board is marked verified.
