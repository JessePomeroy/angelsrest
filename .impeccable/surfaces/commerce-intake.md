---
version: 1
slug: "commerce-intake"
primary_target: "src/routes/admin/platform/intake/+page.svelte"
related_targets: ["src/lib/components/CommerceIntakeStatus.svelte", "src/routes/admin/platform/+page.svelte"]
---

# Background commerce intake

Mode: Operate. This extends the existing platform administrator workflow for roadmap item 37. The creator chooses a website and processing state, reviews accepted events, and requests bounded recovery only after resolving the cause. Existing admin tokens, typography, native controls and theme behavior remain authoritative.

## Direction contract

THESIS: Keep delayed and blocked intake visible after Stripe acknowledgement, with an explicit next action and no customer payload display.

OWN-WORLD: Inherit the established `--admin-*` palette, control edges, typography, restrained borders and disclosure behavior. Preserve the main platform page and all unrelated workflows.

STORY: Open background intake from Platform, filter by website/state, read the stored status and timings, inspect event details, then choose an audited recovery reason when eligible.

FIRST VIEWPORT: The title and purpose lead into native website/state filters. A timestamp identifies the observation; event rows show state, mode, checkout identity, reason and next attempt. Empty/unavailable/unauthorized states explain what to do next.

FORM: A scoped operator extension using plain rows, native details and ordinary server forms. No new design-system choice, generated images or animation. Desktop and narrow-phone layouts retain the same reading order and visible focus.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Finish documentation compares the extension with the incumbent system and preserves its files. Paper and screen inventory changes follow confirmed live delivery under repository instructions; synthetic browser evidence does not establish authenticated production acceptance.
