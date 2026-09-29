# Performance implementation — September 29, 2026

Local work in Angels Rest and the shared admin `refactor/shared-ui-components`
worktrees. No backend deployment, package publication, or host deployment has
occurred. Existing visual and nonvisual refactors remain in these worktrees.

## Checklist

- [x] Split admin imports: additive `core`, `pages/*`, and `components/*`
  entrypoints. Existing root exports remain supported. Hub routes use the narrower
  entrypoints; server exports remain separate.
- [x] Defer the mobile Three renderer until navigation/cart interaction; stop
  its animation loop when settled. Keep photo-lens feedback on a short timer.
  Grain draws at its existing 125 ms cadence without scheduling every frame,
  and pauses when the document is hidden.
- [x] Shop images: responsive thumb/card candidates with intrinsic dimensions;
  first two product images eager, remaining product images lazy.
- [x] Portfolio index: new public summary query reads one preview per published,
  visible gallery. Published revision, placement, asset ownership, site availability,
  and ready-asset checks remain enforced. Detail queries are unchanged.
- [x] Board reorder: one authorized atomic request per affected column instead of
  one sequential request per changed card. Duplicate IDs, foreign tenants/project
  types, and invalid columns are rejected. Older hosts retain their existing API.
- [x] Dashboard: compact invoice/quote summaries replace full line-item payloads;
  recent activity and partial-payment balances remain available. Truncation is
  disclosed. Order statistics stream the bounded history and retain only ten
  recent full records rather than materializing the entire scan.
- [x] ASCII portrait: the extra CORS image and conversion wait for hover/tap or
  keyboard activation; ordinary image and reduced-motion fallback remain usable.
- [x] Delivery gallery: initially mount 48 items, add 48 with Show more, and move
  keyboard focus to the first new item. Whole-gallery selection, lightbox traversal,
  favorites, and downloads still use the complete authorized collection.

## Evidence and limits

The production build's static JavaScript dependency closure (local gzip estimate,
app entry + root layout + target route/layout) changed as follows:

| Entry | Audited installed admin 6.5.5 | Local candidate |
| --- | ---: | ---: |
| Admin shell | 344,764 bytes | 167,896 bytes |
| Client Stripe setup | 347,034 bytes | 140,740 bytes |

The candidate includes the pending local refactors. These are build comparisons,
not production transfer measurements or real-user latency claims. The public
shop's earlier 5.46 MB observation has not been remeasured on a deployed candidate.
Native lazy-loading thresholds and chosen responsive images vary by browser/DPR.

Tests cover deferred renderer loading, stable idle draw counts, navigation/cart
and lens behavior, dynamic motion preferences, portrait cancellation/fallback,
shop categories, and a 2,000-item gallery mounting only 48 items initially.
Backend tests cover tenant authorization, atomic board rollback, compact invoice
balances, portfolio preview ownership, and exact-limit/sentinel order statistics.
The existing delivery download/lightbox and admin-session suites also pass.

**Follow-up implementation:** true delivery metadata pagination and maintained
order totals are now implemented locally. See [scaling follow-up](performance-scaling-follow-up.md)
for migration prerequisites and current verification. Invoice/quote summaries
continue to use their bounded 201-row windows. The original measurements below
belong to the first performance pass, not a deployed follow-up.

No physical-phone/GPU benchmark, production Convex timing, authenticated live
admin test, or provider load test was performed. Local visual checks used
fictional fixtures; remote fonts/providers were blocked. The new gallery control
was inspected in both themes; existing low-contrast light-theme filenames were
not changed by this performance pass. Paper editing tools
were unavailable, so the handbook comparison remains pending in the inventory.

## Verification result

- Shared admin: 1,006 tests; Svelte check and package build passed.
- Hub: 2,879 unit/integration tests, 28 session/protocol tests, and 21 script tests passed.
- Hub lint, Svelte check, CRM API TypeScript and consumer-contract checks passed.
- Desktop/mobile Chromium: 45 targeted cases passed (one desktop-only-inapplicable
  navigation case skipped), plus 11 navigation/performance cases and 22 delivery/
  performance cases in focused runs. Some cases overlap between runs.
- WebKit mobile: all four new performance cases passed in the cached offline
  Playwright container. Native WebKit could not launch because libicudata.so.74
  was unavailable; container verification resolved that environment gap.
- Fictional mobile captures inspected for shop, expanded water navigation, and
  the new gallery control in light and dark themes; no horizontal overflow.

## Local integration and release order

The hub's installed admin symlink currently points to a local candidate under
`node_modules/.pnpm/@jessepomeroy+admin@performance/` for verification. The committed
package range and lockfile still reference released 6.5.5. A clean install will
not yet resolve the new entrypoints. Do not ship the host ahead of its package.

1. Follow the backend preparation and migration gates in the [scaling follow-up](performance-scaling-follow-up.md) before deploying the paginated host.
2. Publish the shared admin minor release using its changeset.
3. Update the hub dependency using pnpm, repeat checks with the published package,
   then deploy the host.
4. Verify live page payloads and provider-independent onboarding/login navigation.

The available Reflecting Pool checkout consumes admin 3.41.6 and CRM API 3.1.0.
It was inspected for context but not upgraded or certified against this candidate.
The optional new admin capabilities preserve older-host behavior; full spoke
adoption remains a separate release integration check.
