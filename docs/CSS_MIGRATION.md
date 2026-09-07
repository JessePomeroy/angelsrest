# Public CSS migration

S08 replaces Tailwind utilities with component-owned CSS while preserving rendered behavior. The first slice converts ThemeSwitcher, BottomNav, MobileNav and the remaining JellyNav utility classes. Shared Admin styles already use scoped CSS and `--admin-*` variables.

## Inventory and sequence

The starting point is `86135ae` (S07 complete). Source searches found class attributes/directives in 50 Svelte files, with both utilities and existing semantic classes represented. This count is an inventory aid, not a count of files needing conversion. There are no `@apply` directives in `src/`. Tailwind configuration is concentrated in `src/lib/styles/global.css` and `theme.css`; the five blog templates use typography-plugin `prose` classes.

1. **Navigation/theme pilot:** move utility styling into the four components above. Preserve route matching, cart behavior, lazy liquid rendering, motion preferences and shared theme state. Keep the current reset and tokens during this slice.
2. **CSS foundation:** move the site palette/type scale from Tailwind `@theme` to ordinary custom properties, with a temporary utility bridge. Establish an explicit reset after checking Preflight inheritance in public, Admin and portal views.
3. **Site chrome and content:** convert header/footer, gallery, about and blog surfaces in focused families. Replace article typography deliberately across all five templates, including nested lists, quotes, code, links and images.
4. **Commerce and forms:** convert product/set/collection, cart/checkout, contact/order lookup and private delivery surfaces. Preserve selection, validation, disabled states, sticky purchase controls and download behavior.
5. **Dependency removal:** remove Tailwind, Vite and typography plugins after remaining utilities/directives are gone. Update the browser fixture build and repository instructions; check inherited Admin/portal styles and measure emitted CSS before claiming savings.

Each implementation slice uses a focused PR, two independent green reviews on its final commit, required CI and preview checks, then merge before the next slice.

## Pilot cascade findings

The existing global list reset overrides BottomNav's `p-1` utility. Its computed list padding is zero, so the scoped replacement preserves zero. Time-aware navigation borders previously override utility border colors; the component explicitly uses `--time-border` with surface-color fallbacks. Utility padding and border names alone would have produced a different result.

The public theme switcher keeps the shared store and pressed states. Icon dimensions remain rem-based. Rounded corners and shadows use ordinary CSS without Tailwind's shadow-composition properties. JellyNav's accessible text uses local visually-hidden styles; its desktop breakpoint is local as well.

## Verification

Use the actual-component browser suite for navigation, liquid navigation and shared theme ownership. Compare desktop/mobile captures in light/dark across all six time periods; check keyboard focus, route ancestry, touch targets, breakpoint visibility, cart access and reduced-motion switching. Physical iOS safe-area behavior still needs device verification.

The pilot is not a standalone reset replacement. It still inherits the current global foundation, and its semantic tokens remain defined by the existing theme file. Do not remove the build plugins until later slices resolve these dependencies.
