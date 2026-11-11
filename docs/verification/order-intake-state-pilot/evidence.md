# Observed evidence

Verified 2026-11-09 against HEAD
`187ca087f859999a7f0b5c82779f39bc89b6e28b` and the hashes then recorded in
[source-snapshot.json](source-snapshot.json); those records were refreshed after
the [2026-11-11 review](#source-refresh-review-2026-11-11). The checkout began clean. All new
files were task-owned; application, schema, generated sources, manifests, CI and
shared documentation remained unchanged during the initial pilot. The authorized
retention follow-up adds only the skill allowlist and verification-guide entry.

The final handover run followed the new skill's exact command. Its retained
[summary](evidence/summary.json), [correct model log](evidence/tlc-connected.log),
[platform log](evidence/tlc-platform.log), and control logs below are the observed
proof. Full implementation JSON reports remain in the run directory named in
the summary/evidence record. No skipped test is counted as a successful probe.
Compact [implementation observations](evidence/implementation-observations.json)
retain the suite counts and exact duplicate-row assertion failures.
[Supplementary checks](evidence/supplementary-checks.json) record successful
repository lint (existing warnings), warning-free isolated fixture lint, Python
syntax validation and skill validation. The validator used PyYAML 6.0.3 only in
a temporary directory, removed afterward.

| Check | Observed result | Interpretation |
| --- | --- | --- |
| Correct connected configuration | 1,904 generated, 603 distinct, zero queued; depth 17 | All reachable states at this finite bound satisfy `SingleDurableReceipt` and `TypeOK` |
| Correct platform configuration | 1,904 generated, 603 distinct, zero queued; depth 17 | Same check with absent connected account and platform scope |
| Missing transaction lookup model | Invariant violation, exit 12; 117 generated, 71 distinct, 33 queued; witness has 6 transitions | Expected failing design control; this run stops on the first violation |
| Split delete/insert model | Invariant violation, exit 12; 10 generated, 9 distinct, 4 queued; witness has 3 transitions | Expected failure of atomic transfer; design-only mutation |
| Actual Convex baseline | 249 passed, zero failed | 237 existing tests reused plus 12 bridge probes |
| Actual source lookup removed | Three failed duplicate-row assertions; nine unrelated bridge probes skipped by the intentional test-name filter | Same defect reproduced in hub/platform-tenant/connected-tenant fixtures; expected negative control |
| Actual source restored | 12 bridge probes passed, zero failed/skipped | Mutation dropped; the original code still passes |

The model checker is TLC 2.19 from release 1.7.4; JRE Temurin 21.0.9+10.
Seed 1, fingerprint polynomial 0, breadth-first search, one worker, 512 MiB heap.
No state/depth cutoff or symmetry/view reduction. TLC's reported optimistic
fingerprint-collision probability on each correct run is `4.3E-14`; this is a
bounded explicit-state check using fingerprints, not a mathematical proof.

## Counterexamples in application terms

[Missing lookup trace](evidence/tlc-missing-lookup.log):

1. Delivery A resolves the bound reservation.
2. A completes its checkout-detail reads.
3. A commits the order and consumes the reservation; its reply can still be unseen.
4. Delivery B resolves the now-existing order.
5. B completes its checkout-detail reads; its order-route payload omits the handle.
6. With the transaction's own lookup deliberately removed, B inserts another order.

The original code rechecks the session at step 6 and returns the first ID.
The [actual source mutation patch](evidence/implementation-mutation.patch) removes
that indexed lookup only inside a disposable copy. The bridge fixture commits
and discards the first result, executes the **production** route selector and
payload builder for replay, and asserts there is one row. Each mutated fixture
observes two rows. This is a representative replay of the same durable ordering,
not a hosted concurrent stress test. The unmodified stale-route and concurrent
fixtures also converge.

[Split transaction trace](evidence/tlc-split-transaction.log): resolve reservation
→ read details → delete reservation independently of order creation. There is
then no reservation and no order. This is a **design-only control**, not an
observed product defect. The real implementation has no such independent
delete endpoint: `consumeReservation` runs inside `orders.create`. The actual
rollback fixture throws at later order-number validation and observes that the
original bound row is unchanged and no order exists, then retries successfully.

Neither counterexample was reproduced as a defect in original product code.
The missing-lookup mutation reproduces a meaningful deliberately introduced
implementation defect; the split control demonstrates why model atomicity matters.

## Evidence boundaries and driver corrections

The [diagram](statechart.html) is an annotated projection, not an automatically
extracted 603-node graph. Representative implementation execution uses synthetic
in-memory Convex and the actual host selector/builder. HTTP authentication,
Stripe API reads, deployed OCC/durability, universal admissions, supplier calls
and email delivery are not implementation-verified here.

Initial driver runs failed before useful pilot assertions: an unsupported newer
TLC CLI flag, an overly narrow temporary copy missing generated JavaScript/CRM
imports, and a synthetic client fixture missing required `adminEmails`. Those
driver/fixture issues were corrected; no commerce source was changed. Their
failed-run logs remain under ignored `test-results/order-intake-state-*` and
are not reported as product defects or negative-control successes.

The reusable [skill](../../../.agents/skills/verify-order-intake-state/SKILL.md)
was validated and followed successfully, including source mutation, restoration,
proof capture and temporary-directory cleanup. The authorized retention follow-up
allowlists the skill in `.gitignore` and links the pilot from `docs/VERIFICATION.md`.

Retention rerun on 2026-11-09 at HEAD
`67a1ba624273ee7a69c3dbb99069986b3494df4f` passed with all recorded source hashes
unchanged. Both correct configurations again exhausted 603 distinct states;
the baseline passed 249 tests, both model controls failed as expected, the source
mutation produced the three expected failures, and restored code passed 12 probes.
Fresh local reports are in
`test-results/order-intake-state-20261109T171325Z-1933440/`; the retained evidence
above preserves the initial pilot run.

The inclusion review at source commit `24490663fbe19de9e57a1a20c81babc63f591d0b`
found that the driver accepted an otherwise successful baseline report with
one skipped bridge probe (248 passed, one pending). A report-level negative
control reproduced that false pass in the original runner. The reviewed runner
rejects it and now requires the complete suite inventory without skips/todos
for baseline/restored runs, and the exact three purchase-scope failures for the
filtered source mutation. Eight standard-library regression tests passed.

The updated driver's full run in
`test-results/order-intake-state-20261109T174540Z-1955411/` passed all seven checks
with the same model state counts and unchanged application/source hashes.
The retained mutation patches express the same edits with zero context so
ordinary Git whitespace checks can inspect the pilot without treating patch
context prefixes as source indentation. No commerce behavior changed.

Independent pre-merge review at `d9d1c37bd4b218d5b40d8670931d25e649b7270f`
found that a timed-out Vitest command could leave a running forked worker. A
review-owned temporary Vitest fixture reproduced the orphan; the reviewer stopped
that exact recorded process. The command helper now starts a separate process
group and kills that recorded group on timeout/interruption before removing its
temporary copy. The timeout still yields an incomplete result.

Ten driver regressions now pass, including real descendant termination and the
incomplete timeout result. In an isolated copy, the new cleanup regression fails
against the original helper and cleans up its own deliberately surviving child.
The complete updated pilot in
`test-results/order-intake-state-20261109T175503Z-1970557/` again passes all seven
checks with the same model counts and unchanged application fingerprints.
The timeout-control log is retained locally at
`test-results/angelsrest-reconciliation-20261109/timeout-negative-control.log`.

## Ordering refinement 2026-11-09

Separate **local-only** refinement at released HEAD
`663e9ca65d86f1cc9fc0ca8dc190bfd96ea623d3`; not included in PR #767.
Original source hashes, the original source manifest and all original evidence
above remain unchanged. The [supplemental manifest](refinement-source-snapshot.json)
adds two inspected host effect-boundary hashes; the driver now gates all 31
individual source hashes plus the unchanged 272-file CRM execution-tree digest.

The [ordering/ownership map](ordering-refinement.md) defines observations,
guard checkpoints, persistent owners, conditional commutativity, repeated
effects and exclusions. The existing model now contains a bound reservation
record and one monotonic environment producer closure, separates pre-commit
failure from lost commit response, and restricts late transaction rollback to
the new-order branch. `CommittedReplayAvailable` adds the outcome that producer
closure cannot itself reject a matching committed receipt. This was already
supported by current code and an existing gate test, not invented policy.

Final documented skill run:
`test-results/order-intake-state-20261109T183545Z-2019557/`.
Retained [summary](evidence/refinement-20261109/summary.json) includes HEAD,
dirty Git status, model/driver/fixture hashes, both source-record hashes and
actual tool versions. [Implementation observations](evidence/refinement-20261109/implementation-observations.json)
retain inventories and exact control failures; full Vitest JSON remains in the
run directory. [Supplementary checks](evidence/refinement-20261109/supplementary-checks.json)
record the 12 passing driver regressions, isolated Biome lint, successful
installed skill-creator validation and the previewed/rendered HTML diagram.

| Check | Observed result | Scope / interpretation |
| --- | --- | --- |
| Correct connected and platform configurations | Each: 4,196 generated / 1,206 distinct / zero queued; depth 18; exit 0 | Exhausted finite graph; both receipt invariants and `TypeOK` hold. Configurations remain isomorphic substitutions, not authorization proofs. |
| Lookup removal model | 233 generated / 119 distinct / 54 queued; exit 12 | Expected `SingleDurableReceipt` violation, 6 transitions. |
| Split transfer model | 22 generated / 17 distinct / 9 queued; exit 12 | Expected `SingleDurableReceipt` violation, 3 transitions; design-only fault. |
| [Gate-first model](evidence/refinement-20261109/tlc-gate-first.log) | 390 generated / 185 distinct / 75 queued; exit 12 | Expected `CommittedReplayAvailable` violation, 7 transitions; witness still has one order. |
| Actual Convex baseline | 252 passed, none skipped/failed | 237 existing tests plus 15 bridge probes; persistent bound ownership, paid amount and revenue projections observed. |
| Actual lookup removed | Exactly 3 expected duplicate-row failures; 12 filtered probes skipped | Existing real-source negative control preserved in disposable copy. |
| [Actual gate moved first](evidence/refinement-20261109/implementation-gate-first.patch) | Exactly 3 `Order producers are closed` failures; 12 filtered probes skipped | Same fresh-route counterexample against real mutated code, one failure per hub/platform-tenant/connected-tenant scope. |
| Actual source restored | All 15 probes passed, none skipped | Also tests stale reservation-route recovery through the closed gate, and unchanged local revenue projections. |

New counterexample, in domain language: A resolves reservation → reads details
→ commits order (reply still unobserved) → producers close → B resolves saved
order → reads details → a gate-first mutation rejects B before checking the
receipt. The unmodified implementation returns A's order ID. The isolated
source replay has the same durable ordering and fresh route, with synthetic
provider details; its earlier extra reservation read does not affect the trace.
No original product failure was found. This demonstrates non-equivalence of a
deliberate hypothetical guard move for one known trace, not a general refactor
equivalence proof or an actual proposed refactor assessment.

The first refinement attempt used a heterogeneous record/string reservation
representation that TLC refused to compare. It failed before exploration,
while implementation probes passed; it is not counted as formal evidence. The
record-set correction passed in a separate run; subsequent changes added
revenue observations, the exact fresh-route replay and final evidence metadata.
Their final complete run is the one retained here. The initial failed run
remains locally at `test-results/order-intake-state-20261109T183006Z-2012730/`.
The stdin Biome invocation did not provide a usable lint result; the isolated
file lint above did. Skill validation initially lacked PyYAML; the successful
validation used a pinned disposable dependency, with no global install.

All task-created execution copies and the temporary validator dependency were
removed. Historical controls were not weakened. Revenue and authorization
guards are representative real-code observations, not newly proved model
properties. No provider contract, production OCC, arbitrary account collision,
retention/offboarding race, liveness or exactly-once external effect is verified.

## Source refresh review 2026-11-11

The debloat batch (#777–#783) changed pinned sources, so `check.py` correctly
reported the correspondence and copied CRM tree as stale. Each pinned file was
diffed against the exact revision whose content matched its recorded hash.

| Change | Source | Model impact |
| --- | --- | --- |
| Customer confirmation uses the Convex-returned `fulfillmentType` (`orderIntake.ts`, `webhookOrders.ts`) | #778 | None. The value is read from the `orders.create` result after the transaction and only feeds post-commit email. |
| Snapshot checkouts ignore `isDigital` metadata (`webhookOrderPayload.ts`) | #778 | None. The current hub no longer stamps that metadata (the retired Sanity path did before #488), so first-create arguments are unchanged for hub-created sessions. On an existing-order replay the payload's `fulfillmentType` can now be `"self"` where metadata said `"true"`; the bridge probe's replay exercises this. `orders.create` returns the saved order and its stored `fulfillmentType` before reading that argument, and handle omission on replay is unchanged. |
| `isHubSite` exported (`commerceTenant.ts`) | #778 | None; same function, now importable. |
| Refund notifications spread the result minus `kind`; the admin-alert wrapper is inlined (`orderIntake.ts`, `webhookOrders.ts`, `printFulfillment.ts`) | #781 | None. These are post-commit effects with the same fields. |
| Unused dev dependencies and overrides removed; `jsdom` declared directly instead of resolving only as an optional Vitest dependency (`package.json`, `pnpm-lock.yaml`) | #779 | None. The pinned Vitest 4.1.12, convex 1.49.0, convex-test 0.0.52 and @edge-runtime/vm 5.0.0 are unchanged, and the reused suites run in the edge runtime, not jsdom. |
| Catalog test fixtures moved and catalog private-asset helpers shared (copied CRM tree) | #777 | None. The modeled code reaches these files only transitively: `orders.ts` through `catalogCommerce.ts`/`catalogProductGraphData.ts`, `schema.ts` through its validators, and `orders.test.ts` through `test/catalogProductGraphFixtures.ts`. The #777 changes are verbatim moves and renames with identical values and fields. |

Route selection, the single `orders.create` lookup, consume and insert
transaction, reservation consumption, replay handle omission and the producer
gate are unchanged.

A complete rerun with the candidate hashes, at `19bf2031` in a disposable
checkout, reported `Pilot status: pass`. Every count matches the
[ordering refinement](#ordering-refinement-2026-11-09):

- Correct connected and platform configurations: each 4,196 generated / 1,206
  distinct / zero queued.
- Lookup-removal, split-transfer and gate-first controls: expected violations,
  at 233/119/54, 22/17/9 and 390/185/75 (generated/distinct/queued).
- Actual Convex baseline: 252 passed, 0 failed.
- Both implementation mutations were caught (0 of 3 passed each), and the
  restored run passed 15 of 15.

The retained local evidence, including the candidate hash patch and the run log,
is in the ignored `test-results/order-intake-state-review-20261111/`. Only the
recorded hashes, heads and tree digest changed; no model, control, probe or
bound was edited. `initial_git_status` still describes the original recording.
The refresh run's checkout differed from `19bf2031` only in these two snapshot
records, whose committed heads and scope wording were finalised after the run;
the source hashes and tree digest are identical to the ones verified.
