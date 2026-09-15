# Editor document-pane layout experiment

Source branch: `test/editor-document-pane` in the shared admin and host repositories. No release, deployment, backend, authentication, provider, or production dependency changes. Historical observations below describe successive prototype passes; the [full-admin inventory](full-admin-workbench-experiment.json) records the final rollout and phone refinements.

The five editor areas—portfolio, products, blog, pages, and site settings—share a document-side layout. About and Contact use the same rules. Navigation and collection panes retain their existing layout and palette.

The live Punchlist review informed bounded text measures, clearer document identities, contextual variant headings, associated URL-path instructions, visible light-theme action labels, and long-filename handling. The redesign uses section headings alongside fields on wide panes, stacked groups on narrower panes, full-width media rows, and horizontal separators. Hard corners, no card-shaped groups, and inherited host fonts and time-dependent colors are explicit constraints.

## Research translated into the implementation

The terminal interfaces in [Reddix on r/unixporn](https://www.reddit.com/r/unixporn/comments/1nyr8fi/oc_reddix_the_fully_featured_terminal_reddit/) and [spotify-tui on r/unixporn](https://www.reddit.com/r/unixporn/comments/dekj2i/oc_a_spotify_terminal_user_interface_written_in/) informed the clear pane boundaries, nearby section labels, compact metadata, and horizontal rules. Their authors' UI images were inspected through the linked public repositories when Reddit preview images were unavailable. No wallpaper, icons, fonts, palette, or other third-party assets were copied.

## Implementation and verification

The shared package owns `src/lib/styles/editor-document.css`, imported by `AdminLayout.svelte` and scoped to `.editor-workspace .editor-document`. Page edits add opt-in layout classes and update visible labels/headings. The product component tests now assert readable H3 variant labels and still verify nonempty variant identities during reordering.

Use the [isolated preview instructions](../../tests/browser/editor-document-pane/README.md). It renders actual components with fictional data and blocks provider writes. All 936 admin tests, the package build, both Svelte checks, host lint and the new stylesheet's Biome check passed. Browser inspection covered desktop, tablet, mobile, both themes and all six product kinds. Changing the host body-font token in the browser reached every document pane without changing its display-font token.

The [synthetic re-sweep](editor-document-pane-resweep.json) has a closed 50-entry ledger and independently rated baseline findings. No new layout regression remained. Successful provider mutations are deliberately unverified. Existing draft-loss, focus, query-error, About group-label and price-rounding issues were reported separately and were not used to expand this layout change.

## Paper status: blocked, not verified

[The separate test page](https://app.paper.design/file/01M25K34Z4EFZ5BEPJ49JBF0X1/8-0) contains incomplete document scaffolds and headers, explicitly named as incomplete. Full-board capture, a small-header retry and a PNG export fallback timed out. The mandatory visual checkpoint could not complete, so further Paper composition stopped. Existing reference boards and unrelated studies remain untouched.

The [experiment inventory](editor-document-pane-experiment.json) records browser conditions, document crops, source and Paper IDs, gaps and verification status. Do not promote these Paper drafts to canonical references. Once Paper rendering is available, finish the remaining editable groups in place, compare against the same fictional data/viewport/theme/period, and update the inventory.

## Follow-up: tactile gallery and product controls

The user approved a two-editor aesthetic prototype after the first layout pass felt too similar. `editor-workbench.css` is imported by, and scoped to, the portfolio-gallery and product detail panes. It derives its colors from the existing host tokens; Synonym, Chillax and hard corners remain unchanged. Fields use 16px text and a 48px inset surface; actions have a restrained raised edge and pressed feedback; radio selections combine a check mark with a tinted fill. Remove actions are quieter without losing their touch target. Gallery previews are larger and uncropped, product image rows give the artwork more space, and material/size share a mobile row. Draft status is visible next to the existing actions. No saving, publishing, transport or backend contract changed.

The [square Everforest reference](https://www.reddit.com/r/unixporn/comments/1krj6aj/hyprland_cozy_everforest_for_daily_use/) informed tonal separation and clear pane edges, not a palette replacement. Visible labels and distinguishable controls follow [GOV.UK input guidance](https://design-system.service.gov.uk/components/text-input/) and [NN/g guidance on subtle depth and interaction cues](https://www.nngroup.com/articles/flat-design-best-practices/). Reddit discussions were aesthetic/practitioner references, not usability-study evidence.

The separately approved listbox repair uses the focus event's destination rather than checking `activeElement` during a focus transfer. The old handler removed the option before its click fired. The actual-component browser regression failed before the correction and passes afterward, covering phone touch and desktop pointer selection, keyboard selection, Escape, Tab and outside clicks. See the [scoped fix report](editor-workbench-fix-report.json) and the [FocusEvent contract](https://developer.mozilla.org/en-US/docs/Web/API/FocusEvent/relatedTarget).

Current verification: 936 package tests, shared-package and host Svelte checks, the package build, host lint, and focused stylesheet lint pass. The local browser suite passes 17 rendered cases and four editing flows; both themes and 390/834/1440px widths are covered, with extra 320px overflow checks. Save failures retain typed values, image removal works, and media-picker cancellation returns focus. Desktop pointer image reordering was observed; keyboard reordering through existing gallery drag handles still fails with and without the new styling and remains outside the approved fix. WebKit cannot launch because `libicudata.so.74` is missing; no Safari or physical-phone verification is claimed.

Paper follow-up: updated the existing gallery test scaffold and added one native editable input group. Both a header capture and the new field's required screenshot checkpoint timed out. Composition stopped at that checkpoint; the test board was marked incomplete and the working indicators released. The other test boards and canonical references were preserved. No Paper comparison is claimed for this follow-up.

Phone screenshot follow-up: corrected a selector-specificity collision that gave the currency input its own border and inset shadow inside the money-field wrapper. The prefix and value now share one 48px control, with only the wrapper drawing the border and keyboard-focus outline. The browser suite now checks that compound fields have no inner border, shadow or focus ring.

The user subsequently requested removal of both the choice checkmark and excess borders. All segmented choices in the product prototype now use centered labels with symmetric padding, a single outer boundary and a tinted, medium-weight selected state. The nested selected border, checkmark, reserved icon space and inset track gap are removed. Keyboard-focus outlines remain. Touch and arrow-key selection were checked in both themes, and the 17-case/four-flow browser suite still passes. Paper comparison remains blocked as documented above.
