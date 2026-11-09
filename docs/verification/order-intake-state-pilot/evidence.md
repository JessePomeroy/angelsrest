# Observed evidence

Verified 2026-11-09 against HEAD
`187ca087f859999a7f0b5c82779f39bc89b6e28b` and the hashes in
[source-snapshot.json](source-snapshot.json). The checkout began clean. All new
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
