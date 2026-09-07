# Isolated component browser checks

Run from the repository root:

```sh
node scripts/run-playwright.mjs --config tests/browser/playwright.config.ts
```

The suite mounts the production Svelte components in a standalone Vite fixture
on `127.0.0.1:5196`. Playwright owns the server process and stops it after the run;
port conflicts fail instead of reusing an unrelated server. Install Chromium
with `pnpm exec playwright install chromium` if it is not already available.

Fixtures use the production global stylesheet and explicitly include `src` in
Tailwind's source scan. The cart uses its actual reactive stores. The delivery
page receives four local SVG previews and static gallery data. Only framework
navigation/environment and the Convex transport are substituted. Unexpected
Convex mutations throw, and browser requests to external origins fail the test.
No provider credentials, hosted content, or live writes are required.

The S01 checks cover empty/populated cart focus entry and keyboard containment,
Escape/button/backdrop dismissal with focus restoration and reopening, plus
delivery lightbox single-step arrows, both boundaries, focus retention when an
edge navigation control disappears, keyboard containment,
and Escape focus restoration. Every check runs in desktop and mobile Chromium.
These fixtures verify the actual components, but do not replace full-site
routing, authenticated integration, or visual checks.

S02 also mounts the actual theme switcher, checkout cancellation page, and print
set configurator with typed local data. Checks cover light/dark muted copy,
filled action and native-option contrast, select focus and value changes,
disabled controls, selection with and without a time period, and readable
afternoon cart labels. Color checks use the browser canvas to resolve CSS
colors to sRGB; translucent selection is composited over the fixture body.

S03 exercises the production bottom navigation with a minimal reactive route
state stub, checking destinations, active routes, near-prefix exclusions,
mobile target sizes, and desktop hiding. Theme checks run the primary actions,
selection, and cart labels across all six time periods in both modes, and
verify that switching modes no longer sets a Skeleton theme attribute.


S04 mounts the installed Admin layout alongside the public theme switcher and
checks shared state across Admin mount/unmount cycles and page reloads, with
both available and denied local storage. Its static unauthorized session only
supplies layout capabilities; this is not an authentication test. The first-paint
script is taken from the production app shell. The actual contact form also
checks field/button colors in both modes without document style mutation; a
ready Turnstile API stub prevents loading the external verification provider.
Component CSS is injected by the Svelte compiler in this fixture to avoid
virtual-CSS metadata cache misses when testing a locally packed Admin package.
Production bundling is verified separately with the host build.

S05 uses deterministic Cal and Turnstile provider scripts with the production
booking and verification components. Checks cover disabled booking, delayed
loads, unmount/reentry, failures and retries, modal cleanup, independent
verification instances, and actual contact/order request tokens and readiness.
These checks exercise the provider command boundary without live bookings or
Cloudflare verification; server verification remains covered separately.
