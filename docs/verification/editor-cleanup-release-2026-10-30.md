# Shared editor cleanup release

The shared editors now give the document title and publication controls a clear
header row. Back links sit above that row. Counts sit with their collections,
and product upload cleanup and blog content cleanup remain available beside the
lists. Permanent product deletion sits below the editing form. Populated product,
portfolio and About media uploaders are bounded, with 44-pixel media chooser
targets across phone, tablet and desktop widths.

This treatment covers all six originally reviewed product kinds, portfolio,
blog posts/authors/categories, About, Contact and site settings. Optional
Homepage Quote and Modeling pages inherit the shared header rules; they were
traced in source but not rendered in the Angels Rest fixture.

## Delivered source and runtime

The owner reviewed the local draft and approved shipping it. Shared Admin
[source PR283](https://github.com/JessePomeroy/admin-dashboard/pull/283) merged
as `0aa349490ab9c76f1b3867cfe98ce4a8debe3b19`;
[version PR284](https://github.com/JessePomeroy/admin-dashboard/pull/284) published
**6.9.2** through workflow `41061227186`, registry version `1474137465`.

While the separate 6.9.2 host adoption was undergoing staging acceptance, main
adopted **6.11.0** through [PR737](https://github.com/JessePomeroy/angelsrest/pull/737).
The cleanup source is an ancestor of that package's source, and its editor
stylesheet retains the reviewed cleanup unchanged. The later package also adds
preview controls and zines; this record does not establish acceptance of those
separate features. The obsolete [6.9.2 adoption PR735](https://github.com/JessePomeroy/angelsrest/pull/735)
was closed without merging its older dependency pin.

Production source `20c5336bbba310959ed867dc9a6f1542c61eca17` declares Admin
**6.11.0**, registry version `1474909256`. The provider reports READY deployment
`dpl_3JktCaUCdDE7azzgXocB8aSkp7uk`, and the `www.angelsrest.online` alias was
verified against that deployment before and after the live navigation probe.
Frozen local installation matches the declared package, and its installed editor
stylesheet is byte-identical to the reviewed source.

## Verification and limits

Two independent source reviews found one tablet touch-target regression. The
media chooser minimum was restored to 44 pixels at every width. Thirty-six
focused touch cases passed across Product, Portfolio and About, six intermediate
widths and both themes. Independent normal-motion checks verified cleanup-dialog
Escape/close-button focus return at phone, tablet and desktop widths.

The approved source passed 40 actual-component layout/picker/cleanup cases and
48 field-alignment cases across the six original product kinds and related
editors. Package checks included 1,082 tests, affected component regressions,
Svelte diagnostics, lint and package build; required source and version CI passed.

After the superseding release, the actual installed **6.11.0** package was
rendered again with the host's current configuration and fictional records:
all 40 layout/picker/cleanup cases passed across 2000/1600/900/390-pixel viewports
and both themes. Product desktop/phone, About desktop and blog phone captures
were visually inspected. These checks include the later header preview action's
layout, but refuse provider writes and do not claim preview/publishing success.

The live production public navigation probe passed at 16:18 UTC: icons continued
past four seconds, rendering remained deferred until interaction, visible idle
work stayed within the existing budget, Escape restored focus and no runtime
errors occurred. Complete browser proofs remain in the operator workspace
`angelsrest-mobile-nav-20261030`.

Final immutable-artifact and public-path acceptance for this runtime uses main
CI [41087636182](https://github.com/JessePomeroy/angelsrest/actions/runs/41087636182).
Retain its matching production observation for `/` and `/cart` before merging
this release record. Provider binding is source-only; it does not establish that
Vercel served the CI artifact's bytes.

The obsolete 6.9.2 candidate passed its required and staging CI, but its isolated
staging deployment was never promoted. No authenticated production editor
records were inspected, and no new authenticated 6.11.0 staging acceptance is
claimed. The local checks use fictional records; successful persistence and
unrelated new-feature/provider workflows are outside this verification.

## Handbook follow-up

Direct Paper editing tools are unavailable in this session. The inventory marks
the released cleanup `pending-paper-sync`. Preserve existing editable board IDs,
source baselines and comparison dates until an editable update and a comparison
using the same viewport, theme, data and state can be completed. No board is
marked verified by the local screenshots or deployment metadata.
