# Public CSS migration

S08 replaces Tailwind utilities with component-owned CSS while preserving rendered behavior. All authored consumers are converted, and Tailwind and its Vite/typography plugins are removed. The navigation/theme pilot merged in PR #558. ThemeSwitcher, BottomNav, MobileNav and JellyNav now use scoped CSS. The foundation merged in PR #560, making the site palette, type scale and browser reset ordinary CSS. The public root layout and cart icon variants now use scoped CSS; the existing desktop navigation and footer already did. Shared Admin styles already use scoped CSS and `--admin-*` variables.

## Starting inventory and implementation sequence

The starting point is `86135ae` (S07 complete). Source searches found class attributes/directives in 50 Svelte files, with both utilities and existing semantic classes represented. This count is an inventory aid, not a count of files needing conversion. There are no `@apply` directives in `src/`. Tailwind configuration is concentrated in `src/lib/styles/global.css` and `theme.css`; the five blog templates originally used typography-plugin `prose` classes.

1. **Navigation/theme pilot:** move utility styling into the four components above. Preserve route matching, cart behavior, lazy liquid rendering, motion preferences and shared theme state. Keep the current reset and tokens during this slice.
2. **CSS foundation:** move the site palette/type scale from Tailwind `@theme` to ordinary custom properties, with a temporary utility bridge. Establish an explicit reset after checking Preflight inheritance in public, Admin and portal views.
3. **Site chrome and content:** convert header/footer, gallery, about and blog surfaces in focused families. Replace article typography deliberately across all five templates, including nested lists, quotes, links and images supported by the typed renderer.
4. **Commerce and forms:** convert product/set/collection, cart/checkout, contact/order lookup and private delivery surfaces. Preserve selection, validation, disabled states, sticky purchase controls and download behavior.
5. **Dependency removal:** remove Tailwind, Vite and typography plugins after remaining utilities/directives are gone. Update the browser fixture build and repository instructions; check inherited Admin/portal styles and measure emitted CSS before claiming savings.

Each implementation slice uses a focused PR, two independent green reviews on its final commit, required CI and preview checks, then merge before the next slice.

## Pilot cascade findings

The existing global list reset overrides BottomNav's `p-1` utility. Its computed list padding is zero, so the scoped replacement preserves zero. Time-aware navigation borders previously override utility border colors; the component explicitly uses `--time-border` with surface-color fallbacks. Utility padding and border names alone would have produced a different result.

The public theme switcher keeps the shared store and pressed states. Icon dimensions remain rem-based. Rounded corners and shadows use ordinary CSS without Tailwind's shadow-composition properties. JellyNav's accessible text uses local visually-hidden styles; its desktop breakpoint is local as well.

## Verification

Use the actual-component browser suite for navigation, liquid navigation and shared theme ownership. Compare desktop/mobile captures in light/dark across all six time periods; check keyboard focus, route ancestry, touch targets, breakpoint visibility, cart access and reduced-motion switching. Physical iOS safe-area behavior still needs device verification.

The site palette and type scale live in `theme.css` as native custom properties, imported in the existing theme layer. During migration, `tailwind-bridge.css` registered their names with an `@theme inline` block imported using `reference`: utilities used the site variables without emitting another definition. The bridge and default Tailwind tokens were removed after the consumer conversions.

`reset.css` replaces the Preflight import in the same base layer. It preserves the installed 4.2.4 normalization rules, including native controls, hidden content, media, tables, placeholders and date-input quirks; its font stacks and settings are ordinary CSS. The source attribution/license is retained. Existing unlayered global typography, list resets, time themes and Admin overrides keep their precedence.

A browser test injects reset/theme source directly into a document without Tailwind compilation to verify native token resolution and basic control/layout normalization. The final dependency slice removes the utility/typography build plugins after resolving their consumers.


## Public content conversion

Home's accessibility text, the about/contact layout, ASCII image wrappers and the portfolio lightbox use native component styles. The gallery index/detail pages already used scoped CSS. Converted typography and form layout rules use the native `components` cascade layer so existing unlayered heading and paragraph resets keep their precedence. Ineffective utility margins on those text elements were omitted.

The content fixture uses typed public route data and writable provider stubs. It checks three about-page column arrangements and lightbox keyboard/focus behavior; existing Turnstile and ASCII motion tests continue to cover those component lifecycles. The hero GIF is replaced with a fixed image only during comparison captures.

## Blog typography

All five blog templates, rich-text image presentation and the listing empty state now use native CSS. `article.css` owns shared typography for the elements supported by `BlogRichText`: paragraphs, headings, nested lists, quotes, marked spans, links and images/captions. It preserves the prior light/dark article palette and narrative sizing, with MIT attribution for the adapted typography rules. Templates own their layout and technical/narrative font choices. The typography build plugin and package are removed with the Tailwind build dependencies.

Global text/list/link resets exclude `.article-body` descendants so article spacing remains intact. Figure spacing stays font-relative: the previous `my-8` utility was ineffective in technical articles. Browser fixtures cover all five templates and populated/empty listings, including technical equipment breakpoints, nested lists, links, images and light/dark styles.

## Cart presentation

The cart drawer, full cart page and shared line item use scoped CSS, including their responsive layouts, dark/hover/focus/disabled states and native dialog backdrop. Icons use explicit rem-based sizes. The drawer uses a single native shadow instead of Tailwind shadow-composition placeholders. Long titles keep block layout and ellipsis clipping so controls remain visible. Store transitions, checkout transport, dialog modality and focus restoration retain their existing owners.

Cart fixtures cover empty, populated, expired and checkout-error states in both layouts. Browser checks exercise quantities, removals, pending/error recovery and the 767/768px boundary; existing keyboard tests continue to cover focus trapping and restoration.

## Checkout confirmation and cancellation

Checkout success and cancellation use scoped CSS for their layouts, status panels, native verification form and navigation/download controls. Verification POST fields/actions, proof-gated data handling and download URLs remain unchanged. Fixtures cover basic, shared-link, missing-session, verification-error, physical and digital confirmations plus cancellation; browser checks verify native form submission and keyboard focus without calling Stripe or the real verification/download routes.

## Customer order lookup

Order lookup uses scoped CSS for its form, result and status badge. The former utility-class status map is now native CSS selected by `data-status`, including the gray fallback for an unknown status. Status labels remain typed display data. Lookup POST transport, Turnstile token handling/reset and error behavior are unchanged. The form spacing selector explicitly reaches the Turnstile child root; captures cover idle/loading/error and all six supported statuses plus fallback. Browser checks exercise status transitions, child spacing and disabled-hover precedence.

## Print sets and shared controls

Print-set layout/purchase actions, `PrintConfigurator` and `StickyMobileBar` now use scoped CSS. Selection, cart feedback, checkout calls and the sticky observer remain unchanged. The bar retains its class/bottom-offset API and existing dynamic background/shadow styles. Parent spacing explicitly reaches shared component roots; mobile/desktop actions keep their 768px boundary.

Fixtures include framed/canvas/unavailable/sold-out/missing-image sets, shared controls on the product page, and standalone inline/stuck bar states. Browser checks protect configurator spacing/focus/disabled finishes, image placeholders, responsive actions and the sticky API.

## Individual products

Both product-page branches use scoped CSS: configurable prints and merchandise/digital products. Image-gallery layout/hover styles, stock badges, native paper selection and responsive purchase controls preserve their prior cascade. The print configurator retains its shared-root spacing; mobile selection/category colors follow the sticky state through Svelte class directives.

Typed fixtures cover paper pricing, physical/digital/sold-out/unpriced/missing-image products, print finishes and lightbox selection. Browser checks protect cart/checkout fields, purchase restrictions, keyboard navigation/focus restoration and the 767/768px boundary. Product state and transport code remain unchanged.

## Remaining catalog presentation

The retained print-collection template and shop empty state use scoped CSS. Collection padding keeps its 767/768/1024px transitions without the former important utilities; native component rules produce the same result. The time-aware card hover rule moved from the global `.group` selector into the collection component, retaining unlayered precedence and all six light/dark time accents. Existing collection route availability and category filtering are unchanged.

Fixtures cover populated/empty collection and shop views, breadcrumb/card destinations, columns, category filtering and hover scale. Comparison captures cover all three padding widths plus mobile and all six hover periods.


## Final dependency removal

Tailwind, `@tailwindcss/vite` and `@tailwindcss/typography` are removed from the manifest and lockfile (11 installed packages removed). Vite and the browser fixture build no longer load Tailwind; the temporary theme bridge, fixture `@source` and Biome Tailwind parser setting are removed. The native reset and article styles retain their source licenses. Repository instructions now require scoped CSS.

A compiler-based class scan caught dependencies missed by the earlier naming heuristic: the gradient wrapper's fixed positioning, the invoice payment-result pages' `container` breakpoints, and the photo lens's dynamic `visible` class. These now have explicit native styles. The final scan found no static utility consumers; the lens visibility class is an explicitly styled component state. No provider/auth/payment transport changes are included.

Final captures cover public chrome, actual Admin layout, private delivery, all portal document kinds, both invoice result pages, cart/checkout, print/set/digital product views, collection/shop, article typography and contact/order forms. All 84 measured snapshots match, including full computed properties for print selects. Of 76 screenshots, 61 are identical; remaining differences are raster details (mobile select text affects at most 0.12% of a capture, while other differences are at most five color-channel values). Film-grain comparison uses a fixed random seed. Browser fixtures use local provider stubs and fallback fonts; these captures are not a physical-device or live-provider test.

Production CSS measurement against the immediately preceding S08k build: 29 assets / 383,089 raw bytes / 65,503 independently gzipped bytes before; 29 assets / 366,216 raw bytes / 62,662 independently gzipped bytes after. This sums emitted client CSS across all routes; it is not the transfer size of one page.

## WebKit follow-up coverage

The component suite now runs desktop Chromium, mobile Chromium and WebKit with the iPhone 13 device preset. Install both engines with `pnpm exec playwright install --with-deps chromium webkit`, then run `pnpm test:browser`. CI uses the same project matrix with two workers.

Color expectations are normalized through the current engine's computed-style serialization so OKLCH float precision does not create false failures. Hover-only assertions run on desktop; the sticky purchase bar runs on both mobile projects. The gradient lifecycle test dispatches mouse events directly and waits for asynchronous media-preference application before asserting the animation queue. It verifies scheduling and cleanup, not physical touch input or GPU performance.

The sphere drag test still uses Chromium CDP touch injection and explicitly skips WebKit. Physical iPhone safe areas, Safari toolbar changes, real touch dragging and mobile GPU behavior remain device acceptance work. Provider fixtures also remain distinct from live authenticated or payment/email/fulfillment integration checks.

## Physical iPhone layout follow-up

The first iPhone 17 / iOS 26.6.1 check found missing landscape navigation and a roughly 3.8px gap between the reduced-motion bottom nav and purchase bar. Mobile navigation now remains available on short landscape touch viewports; `MobileNav` owns renderer eligibility, including reduced-motion and import-failure fallbacks. The ordinary desktop layout remains in use outside that phone-sized condition.

The site layout owns typed, per-instance mobile geometry through Svelte context. `BottomNav` reports its fractional border-box height, including safe-area padding, and the purchase bar uses that height instead of a guessed offset. With the sphere active, the bar sits at the viewport bottom with safe-area padding, and its visible height reserves space in the sphere's movement bounds. Physical viewport dimensions remain separate for rendering and saved coordinates. The ordinary nav uses square selections. Observers clean up on unmount, and standalone purchase bars retain their explicit offset API.

Combined layout/product browser fixtures cover rotation with an expanded menu, reduced-motion switching, fractional nav resizing, renderer import failure, and keeping sphere movement above the purchase controls. Linux WebKit captures supplement these checks; the corrected release still needs a physical iPhone retest.

### Production CSS order and follow-up cart layout

A shared component stylesheet can precede the root stylesheet in SvelteKit's
generated head. Declaring `components` first accidentally gives the later `base`
layer higher priority, resetting component padding and borders. The document now
declares `theme, base, components` before generated head content. A WebKit replay
of the production stylesheet order failed with zero cart padding before this fix.

The docked purchase bar and bottom nav retain their measured dimensions; the
nav's top border takes the purchase bar color while docked to remove the visible
separator without creating a ResizeObserver/IntersectionObserver feedback loop.
Cart line totals are labeled and grouped with product details, above quantity and
remove controls, leaving the cart subtotal in the separate footer. Physical Safari
confirmation of the remaining seam is still needed; equal DOM bounds alone do
not prove that a painted seam is absent.
