# Catalog cleanup UI review

Recorded 2026-09-28 from the actual built candidate shared Admin package in the
isolated Angels Rest handbook fixture. All data is synthetic; fetch is replaced
only for the exact cleanup action. No authentication provider or live storage was
contacted by the UI check.

- Desktop: 1440 × 900 — [capture](catalog-cleanup/desktop.png).
- Mobile: 390 × 900 — [capture](catalog-cleanup/mobile.png).
- Product header → manage uploads → choose type → expired uploads → cancel
  without a request → confirm → remove row: passed at both sizes.
- No horizontal overflow or page errors were observed. Confirmations and the
  shared modal's keyboard/focus behavior remain in place.
- The initial overview placement was unreachable on mobile because the existing
  workbench hides that pane. The header action and shared modal correct this.
- Full component tests also cover refusal/retry and disabling controls during
  an outstanding request. Real storage authorization is covered separately by
  backend/host/Worker tests, not by the screenshot fixture.

The new cleanup dialog, product removal action and inquiry removal action are
**pending Paper sync**. The current session exposes no Paper editing tool. Existing
editable boards and their September 27 comparison records are preserved; the
inventory records this pending delta rather than claiming current sync. Add the
cleanup state with editable text/layout layers and compare against these rendered
captures when the Paper connection is available.

## Follow-up controls

The shared Blog header now opens content-history cleanup; the platform client dialog includes offboarding/retention controls. Chromium checked both at 1440×1000 and 390×1000, with synthetic data only. Active-revision deletion stayed disabled, exact-site confirmation guarded CRM erasure, canceled actions preserved data, and no page errors or horizontal overflow occurred.

- [Content desktop](catalog-cleanup/content-1440.png), [content mobile](catalog-cleanup/content-390.png)
- [Offboarding desktop](catalog-cleanup/offboard-1440.png), [offboarding mobile](catalog-cleanup/offboard-390.png)

These controls are also **pending Paper sync**; no editable boards were changed.

## Immediate-offline state

A real Queen Worm server with a synthetic local inactive-tenant backend returned
503/no-store for public pages and checkout while admin sign-in remained available.
The minimal outage document contains no retained client content or backend detail.
[Desktop](catalog-cleanup/offline-1440.png) and [mobile](catalog-cleanup/offline-390.png)
captures are local evidence; no live tenant was disabled. Existing provider delivery
and public CDN URLs have separate controls, as documented in the offboarding runbook.

## Website-content export

The actual shared export component was checked at 1440×900 and 390×900 in a local
fixture with a synthetic archive response. Preparing, cancel and download-ready
states render without horizontal overflow. Component tests cover cancellation and
operator-assistance errors; the authenticated host/Worker boundary is tested separately.

- [Export desktop](catalog-cleanup/export-1440.png), [export mobile](catalog-cleanup/export-390.png)

This optional dashboard section is also pending Paper sync; the current session has
no Paper editing tool. These screenshots contain synthetic fixture data only.
