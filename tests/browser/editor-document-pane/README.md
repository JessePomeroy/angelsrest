# Admin workbench preview

Local test only: actual shared Svelte admin components, host capabilities, inherited fonts and palette, and fictional records. No production dependency versions change.

From this host worktree, start the source preview with fish-compatible commands:

```fish
env ADMIN_EDITOR_SOURCE=/absolute/path/to/admin-dashboard pnpm exec vite --config tests/browser/editor-document-pane/vite.config.ts
```

For an explicitly requested phone preview, allow only the machine's exact tailnet hostname through `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`. Tailscale Serve can proxy an unused HTTPS port to this localhost server. Inspect existing Serve configuration first and preserve existing ports. Keep this private to the tailnet, not a public Funnel.

```fish
tailscale serve --bg --https=8446 http://127.0.0.1:5208
```

Open the machine's private HTTPS URL on the selected port with Tailscale enabled on the phone. Ordinary editor links preserve the selected fictional state and theme. Direct `/admin/editor/...` paths also work. If port 8446 was allocated for this preview, remove only that proxy later with `tailscale serve --https=8446 off`; do not reset all Serve configuration. Record the exact server PID locally rather than committing machine-specific process details.

It binds only to `127.0.0.1:5208`. The default URL shows site settings. The full dashboard starts at `/?route=/admin&theme=dark&period=morning&state=populated`; all operational navigation links work with fictional records:

- `/admin`, `/admin/orders`, `/admin/inquiries`, `/admin/galleries`
- `/admin/crm`, `/admin/board`, `/admin/invoicing`, `/admin/quotes`, `/admin/contracts`
- `/admin/emails`, `/admin/messages`, `/admin/platform`

Select an editor document with `route`:

- `/admin/editor`
- `/admin/editor/pages`, `/admin/editor/pages/about`, `/admin/editor/pages/contact`
- `/admin/editor/portfolio`, `/admin/editor/portfolio/demo-portfolio-1`
- `/admin/editor/products`, `/admin/editor/products/demo-product-1`
- `/admin/editor/blog`, `/admin/editor/blog/posts/demo-post-1`

For example: `/?route=/admin/editor/portfolio/demo-portfolio-1&theme=dark&period=morning&state=populated`.

Optional parameters: `theme=light|dark`; `period=morning|afternoon|evening|night`; `state=populated|empty|loading|error`; and product `kind=print|print_set|postcard|merchandise|tapestry|digital_download`. `screen=login` shows the safe sign-in form; `tier=basic` changes only the fictional tier presentation. Author/category examples use `/admin/editor/blog/authors/demo-author-1` and `/admin/editor/blog/categories/demo-category-1`.

Queries return explicit fixtures. All mutation/action calls and application fetches reject. Authentication is fictional and notification auto-acknowledgment is disabled. Module, font and synthetic SVG asset GETs remain available. Local typing and media selection are disposable; a failed save is deliberate, not a server failure. Do not use these fixtures to infer successful publication, provider behavior or production latency.

The preview alias is optional and confined to this Vite configuration. Set it to the modified shared admin checkout to see the experiment; omitting it renders the installed package instead. Do not edit `node_modules` or change production package versions to preview the design.

Verification: shared admin Svelte check, 936 tests and package build passed; host Svelte check and lint passed. Independent rendered re-sweeps covered all six product kinds, desktop/tablet/mobile, both themes, counts, keyboard controls, picker focus return and simulated save failures. See the design inventory and synthetic audit under `docs/design/` for exact scope and remaining baseline issues.

## Initial gallery/product prototype

The initial gallery/product treatment established inset 16px fields, raised-edge actions, larger image previews, quieter removal actions and visible draft status. Selection controls use one outer boundary and a tinted selected state, with no ornamental checkmarks or nested selection borders. The material/size listbox also has an explicitly approved focus-transfer fix. The following rollout extends that treatment beyond the original two pages.

With the isolated source preview running, repeat the focused browser checks:

```fish
node tests/browser/editor-document-pane/verify-workbench.mjs
node tests/browser/editor-document-pane/verify-listbox.mjs
```

The first script checks 17 rendered cases and four editing flows, including failed-save retention, image removal and media-picker focus return. The second tests touch/click selection, keyboard selection, Escape, Tab and outside-click dismissal at phone and desktop widths. Desktop pointer image reordering was also observed manually.

Known limits: `repro-gallery-keyboard.mjs` reproduces the existing keyboard drag-handle failure. It was reproduced with and without styling during the initial opt-in prototype; the former `--without-workbench` switch is no longer valid now that controls are shared. Use a baseline source checkout for that comparison. This defect is not part of the approved dropdown correction. WebKit verification (`verify-listbox.mjs --webkit`) cannot launch here because `libicudata.so.74` is unavailable. Paper capture still times out; its test boards remain incomplete and unverified. This is not a production or real-device persistence test.

## Full admin rollout

Shared `admin-controls.css` and owner-derived `--admin-control-*` tokens now cover operational forms, filters, actions, tabs and login. `editor-workbench.css` applies to every document editor, retaining the approved gallery/product row layouts. The dashboard, navigation, tables, board, messages, delivery galleries and modal shell use the same square, restrained treatment. Financial calculations, mutation handlers, authentication and provider boundaries are unchanged.

Operational roots use the explicit `admin-page` class for shared gutters and title rhythm; Svelte's generated class order must not determine whether a page receives its layout. The source preview now uses the package's `vitePreprocess()` so imported component CSS is rendered faithfully.

```fish
node tests/browser/editor-document-pane/verify-admin-workbench.mjs
```

Observed on 2026-09-15: 158 rendered cases and 23 interaction checks passed in Chromium, with zero uncaught page errors. The matrix covers 24 routes plus login at 390, 834 and 1440 pixels in both themes, then representative empty/loading/read-error states. Interaction checks cover six create dialogs at phone/desktop sizes, field sizing and containment, Escape/focus return, filtering, failed-save retention, tab selection, message composition/back navigation, simulated login failure and the mobile menu. The script creates a temporary screenshot/report directory and blocks non-GET/HEAD requests; application providers remain refused by the fixture.

The separate gallery/product suite still passes 17 renders and four editing flows; the listbox suite passes touch/pointer, keyboard, Escape, Tab and outside-click checks. Shared admin: 936 tests, Svelte check and package build passed. Host: Svelte check and normal lint scope passed. New control styles pass targeted Biome checks. Svelte `:global` CSS fragments require the unknown-pseudo-class rule to be skipped in standalone CSS lint; the existing editor-shell specificity warnings remain.

See [the rollout inventory](../../../docs/design/full-admin-workbench-experiment.json). Browser inspection is synthetic; Paper comparison remains blocked by screenshot timeouts and is not marked verified. Package publication and production adoption are separate from these source changes.

## Phone-feedback refinements

The clients page now uses compact wrapping stats, paired category/status filters, full-width search and a left-aligned tag action. Quote and contract tabs no longer create a scroll region or one-pixel overflow; the surrounding page and data tables still scroll normally.

At mobile widths, shared modal sheets slide/fade in and out and expose a top drag handle. A full downward drag dismisses; short or cancelled drags snap back. The handle/header stay outside the scrolling content, so focused fields remain visible. X, outside tap, Escape and parent-driven cancellation still work, with focus restoration and scroll-lock cleanup after the outro. Desktop dialogs retain their centered layout; reduced motion skips the animation.

```fish
node tests/browser/editor-document-pane/verify-mobile-refinements.mjs
```

Observed: 28 focused checks passed, plus the 158-case/23-interaction full regression and 936 package tests. Browser tests wait for the actual intro-end event before measuring settled controls. Chromium touch gestures and desktop Firefox pointer dismissal were checked; this does not establish native iPhone Firefox behavior. Paper capture timed out again, so the inventory retains an explicit comparison gap.

## PR-review fixture corrections

Independent review found two fixture-only defects: portfolio detail routing always selected the first gallery, and paginated reads returned successful data for the requested error state. The preview now passes the selected gallery ID and preserves empty initial results for loading/error reads, exposing the simulated error through the query hook.

```fish
node tests/browser/editor-document-pane/verify-preview-fidelity.mjs
```

Seven checks cover real navigation between both gallery examples at phone/desktop sizes in both themes, and the actual compiled paginated hook plus message-page presentation for populated/loading/error states. Before the corrections, one passed and six failed consistently. All seven pass afterward. The existing message page shows its loading branch after an initial query error; the fixture preserves that application behavior and does not add an error banner to production code.
