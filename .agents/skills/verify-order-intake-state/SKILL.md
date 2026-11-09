---
name: verify-order-intake-state
description: Check Angels Rest's bounded reservation-to-order intake state model and replay offline Convex recovery paths. Use after changes to session deduplication, checkout routing, reservation consumption, or transaction boundaries; excludes live provider acceptance and external fulfillment guarantees.
---

# Verify order intake state

Check one rule: duplicate attempts for the same authenticated purchase retain
one local order identity and its reserved snapshot, even with stale routing
reads, transaction aborts, or a lost commit reply. This is bounded model evidence
plus real-code regression probes, not a proof of arbitrary application code.

Read AGENTS.md and the complete Convex AI guidelines before inspecting Convex
source. Then read the [feature map](references/features/README.md) and
[pilot correspondence and limits](../../../docs/verification/order-intake-state-pilot/README.md).
No provider account, credential, application server, or operational database is needed.

## Run

From the Angels Rest repository root:

```zsh
python3 docs/verification/order-intake-state-pilot/check.py
```

First use on a new machine: append `--setup` to that command. It downloads only
the checksum-pinned TLC 1.7.4 release (TLC engine 2.19) and Temurin JRE 21.0.9+10
into `/tmp/angelsrest-order-intake-tools-v1`. It does not install pstack or change
global configuration. See the pilot for URLs, hashes and prerequisites.

The checked host is Linux x86_64, Python 3.14.8, Node 24.18.0, pnpm 10.34.5,
Vitest 4.1.12, Convex 1.49.0, convex-test 0.0.52, edge-runtime/vm 5.0.0. Use the
existing repository dependencies/lockfile. The driver rejects changed Node,
execution-package versions, source hashes, or missing user/network namespaces.
Missing prerequisites mean **incomplete**, not a pass.

The driver prints a fresh `test-results/order-intake-state-*` evidence directory.
No server starts. Implementation probes run in a temporary code copy and a
network namespace, with dotenv disabled and a synthetic environment. Cleanup
removes that copy, including both model variants and the mutated application
copy; logs, patches and JSON reports survive in the evidence directory.

## Interpret and investigate

Exit 0 and `summary.json` status `pass` require all of these:

- Both correct configurations exhaust the reachable graph with no violation:
  603 distinct / 1,904 generated states each at the reviewed model version.
- Both model controls violate `SingleDurableReceipt`: skipping the in-transaction
  lookup permits two orders; splitting delete/insert permits a lost reservation.
- The real Convex baseline passes 249 tests (237 existing, 12 bridge probes).
- Removing the actual session lookup in a disposable `orders.ts` copy causes
  exactly three duplicate-row assertion failures; restored code passes 12 probes.

Read the failing `tlc-*.log` for its shortest breadth-first path, translate the
actions using the correspondence table, and compare the transaction boundaries
with source. Reproduce a suspected product violation in the offline fixture
first. If it does not reproduce, investigate the abstraction before reporting a
bug. Setup errors, skipped tests, an unexpected mutation failure, and tool
timeouts do not count as successful negative controls. Never weaken the rule or
repair commerce code merely to obtain green evidence.

This checks two concurrent executions, up to two attempts each, one already-bound
V2 reservation, one checkout and fixed tenant/account ownership. It excludes
universal admission consumption, retention/offboarding/reset races, liveness,
and supplier/email/refund effects. No exactly-once external fulfillment claim.

## Source synchronization

Reviewed HEAD: `187ca087f859999a7f0b5c82779f39bc89b6e28b`.
The [source snapshot](../../../docs/verification/order-intake-state-pilot/source-snapshot.json)
records per-file SHA-256 hashes of the covered sources and a hash of the copied
CRM execution tree. HEAD alone cannot identify a dirty source snapshot.
Changes to any recorded source/dependency invalidate the correspondence gate.
Review guards, transaction boundaries, host payload selection and scope before
updating that record; then rerun the complete workflow including both controls.
Do not refresh hashes just to bypass a stale result.

Local discovery follows `.agents/skills/`; this skill is allowlisted in
`.gitignore` and linked from `docs/VERIFICATION.md`. Do not change repository
instructions or CI for this check.
