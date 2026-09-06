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
