---
version: 1
slug: "src-routes-admin-platform-page-svelte"
primary_target: "src/routes/admin/platform/+page.svelte"
related_targets: ["src/lib/components/PlatformReleaseStatus.svelte"]
---

# Platform release status

Mode: Operate. Extend `src/routes/admin/platform/+page.svelte` for the platform creator reviewing a site's release during delivery. The roadmap fixes the task: compare intended and observed versions, inspect verification gaps, and identify the next action. Preserve client setup, payments, the shared platform page, and existing admin styling. No new visual identity or activation control.

## Direction contract

THESIS: Make the distinction between intended, observed and verified releases visible in one compact operator panel.

OWN-WORLD: Inherit existing `--admin-*` surfaces, borders, text hierarchy, native selects, restrained status color and typography. This is a desktop operator task that also works on a narrow phone viewport; the current theme remains authoritative.

STORY: Choose a website; inspect each recorded environment; see the running build's packages, the last scoped healthy reference, missing proof and the next action. Unknown evidence stays explicitly unknown.

FIRST VIEWPORT: A section heading and website select lead into compact environment rows. Intent, observed deployment, verification and next action follow in that order. Evidence details expand with a native details element; site changes never display another site's stale evidence.

FORM: Local extension inside the established platform surface. Seed key: not applicable to a scoped extension. No comp or new design-system decision. Existing native interactions supply the interaction grammar; no decorative animation or raster assets.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

For this ordinary extension, finish documentation compares with the incumbent system and preserves its files; Paper and the screen inventory follow verified live delivery under repository instructions.
