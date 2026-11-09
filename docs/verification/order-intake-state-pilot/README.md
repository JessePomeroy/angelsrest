# Order intake state pilot

**Status: bounded model checked; offline implementation probes passed.**
No defect found in the scoped original implementation. This is design evidence
with source correspondence and representative real-code probes, not a proof
that the application or every commerce path is correct.

The rule is **one durable intake receipt**: starting from one bound V2 checkout
reservation and no order, duplicate executions for the same authenticated
purchase can leave at most one local order identity, retaining the reservation's
snapshot and purchase identity. Until a create commits, the reservation remains;
afterward, every successful replay returns that order. This prevents duplicate
local orders and loss of the customer's purchased product snapshot.

The [2026-11-09 ordering refinement](ordering-refinement.md) adds a narrow
recovery outcome: closing new-order producers cannot itself reject a matching
already-committed receipt. It makes reservation ownership explicit and maps
conditional operation orderings, authoritative representations and external effects.
Original run evidence is preserved; the refinement is a separate local-only change.

## Rerun

From the repository root:

```zsh
python3 docs/verification/order-intake-state-pilot/check.py
```

On first use append `--setup`. It fetches only the development tools below into
`/tmp/angelsrest-order-intake-tools-v1`; subsequent runs need no tool download.
Optional `--out /absolute/new/directory` selects a fresh evidence directory.
Existing directories are never overwritten. The default is a unique ignored
`test-results/order-intake-state-*` directory. Setup needs HTTPS access to GitHub;
the implementation runs with **no network** using Linux user/network namespaces.
No application server starts; the script removes its temporary code copy after
the run. It never loads application dotenv files or inherited secrets.

Observed host: Linux x86_64, Python 3.14.8 (3.12+ required for safe tar extraction),
Node 24.18.0, pnpm 10.34.5; installed Vitest 4.1.12, convex 1.49.0,
convex-test 0.0.52, @edge-runtime/vm 5.0.0. The driver pins Node and those package
versions, checks the existing lockfile hash and uses the installed dependencies.
It needs `unshare -Urn` permission. Missing dependencies/namespaces or a timeout
produce an incomplete result, never ordinary tests relabeled as formal checking.
Baseline and restored runs must execute the complete recorded suite inventory
without skips or todos. Only the mutation's explicit name filter may skip its
twelve unrelated probes; each control's three failures must identify all three
purchase scopes and its own expected assertion/error.

Each command has its own task-owned process group. A timeout or Python
interruption stops that group, including forked Vitest workers, before cleanup;
timeouts still produce an incomplete result. Abruptly killing the driver itself
does not provide this cleanup guarantee.

When changing the driver, check report acceptance and timeout cleanup without Java,
repository dependencies, downloads or namespaces:

```zsh
python3 -B docs/verification/order-intake-state-pilot/test_check.py
```

| Development tool | Pinned download | SHA-256 |
| --- | --- | --- |
| TLC release 1.7.4; engine 2.19, revision 5a47802 | [tla2tools.jar](https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar) | `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88` |
| Temurin JRE 21.0.9+10, Linux x86_64 | [JRE archive](https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.9%2B10/OpenJDK21U-jre_x64_linux_hotspot_21.0.9_10.tar.gz) | `aeab55d064a1a27a3744b0880b9b414077b4ed2b1790817eea3df60aec946431` |

No dependency manifest, CI file, global skill/configuration, or production
dependency changes. This command is deliberately not wired into existing gates.

## What already existed; what this adds

[Engineering verification](../../VERIFICATION.md) already documents authorization,
invoice replay, protocol, in-memory Convex, browser and Worker contract gates.
This pilot does not repeat that workflow audit or recreate its infrastructure.
Inventory found no existing TLA+ model or order-intake formal-verification skill.

The driver **reuses** `checkoutSnapshotReservations.test.ts` (29 tests, including
concurrent creates, transfer and cleanup), `orders.test.ts` (178 tests, including
session replay and numbering), and `commerceIntakeInbox.test.ts` (30 tests,
including duplicate acceptance, stale leases and recovery). Existing order-intake
unit/in-memory integration suites also cover fulfillment recovery; they were
inspected, not rerun by this narrow pilot. Invoice, protocol, Worker and browser
gates were inventoried, not rerun or claimed as fresh acceptance here.

Added value: TLC exhausts the bounded combinations of stale route reads,
transaction abort, commit followed by reply loss, concurrent execution and
redelivery. The existing concurrent scenario alone does not explore these
orderings, plus one producer-gate closure between mutations. Fifteen bridge
probes relate key paths to actual Convex code and durable revenue projections;
isolated source mutations catch duplicate local orders and blocked receipt recovery.

## Identifiers and actual checkpoints

The tenant's stable `tenantId`, presentation/purchase partition `siteUrl`, Stripe
connected account ID, Stripe Checkout Session ID, Stripe event ID and supplier
order number are different identifiers. A platform-account event has no
`event.account`; its trusted server-stamped metadata supplies tenant routing.
A connected-account event uses its verified `event.account`. The hub owns both
entry paths; spokes do not run another order-intake webhook.

Reservations are found by `(siteUrl, handleHash)` for consumption and by
`(accountScope, stripeSessionId)` for routing/binding. Account scope is `platform`
or `connected:<account ID>`. **Orders use a session-only index**, not a
`(tenant, account, session)` composite. The model neither assumes nor proves
that literal Session IDs cannot collide across different Stripe accounts.
That different-purchase question is outside this single-purchase bound.
`.unique()` is a read that rejects multiple rows, not a schema uniqueness constraint.

1. The route verifies the Stripe signature/destination role. Optional
   `commerceIntakeInbox.accept` durably retains an event, keyed by event ID;
   `wake/read/advance` lease execution separately. Different events or overlapping
   runners can still reach order creation. Inbox behavior is reused coverage,
   not a second modeled state machine.
2. `reserveCheckoutSnapshot` saves frozen data; `bindCheckoutSnapshot` associates
   it with one account/session and schedules reconciliation. Both precede `Init`.
3. The orchestration queries `resolveCheckoutRouting`, resolves tenant context,
   then reads Stripe session/line items. These are separate calls; a route can be
   stale by the time it submits a mutation.
4. **One `orders.create` transaction** validates authority and tenant identity,
   re-reads the order by session, checks account ownership, and returns an existing
   order before interpreting a reservation candidate. On first creation it
   consumes/deletes the bound reservation, validates later fields, allocates an
   order number, inserts the order, and writes associated local records/schedules.
   An exception rolls all those writes back. There is no durable gap between
   delete and insert.
5. The response, receipt/email work, print job/provider work and later inbox
   `advance` happen after that transaction. Losing a response cannot undo a
   committed order. Retrying a fresh `order` route omits the reservation handle;
   the transaction's own lookup must still return the saved order.

## Model-to-source correspondence

| Model action / rule | Concrete source | Correspondence / exercised evidence |
| --- | --- | --- |
| `Init` | [orders.ts](../../../packages/crm-api/convex/orders.ts), `reserveCheckoutSnapshot`, `bindCheckoutSnapshot` | Starts after both commits; fixture executes both functions rather than seeding a bound row |
| `ResolveRouting` | [orderRouting.ts](../../../packages/crm-api/convex/helpers/orderRouting.ts), `readCheckoutRouting`; `orders.resolveCheckoutRouting` | Order first, otherwise bound reservation; a transactionally consistent query, not a durable claim |
| `FetchDetails` | [orderIntake.ts](../../../src/lib/server/orderIntake.ts), `processStripeWebhookEvent`, `handleCheckoutCompleted`, `fetchSessionDetails`; [commerceTenant.ts](../../../src/lib/server/commerceTenant.ts) | Abstracts successful external reads/tenant resolution; their contents/authorization are assumed, not formally verified |
| `CreateTransaction` | [orders.ts](../../../packages/crm-api/convex/orders.ts), `create`, `consumeReservation`; [webhookOrders.ts](../../../src/lib/server/webhookOrders.ts), `createOrderInConvex` | Lookup + consume + insert are one mutation; stale and concurrent fixture paths return the same ID |
| `AbortTransaction` | `consumeReservation` delete followed by later validation in `create` | Invalid supplied order number throws after delete; fixture observes unchanged reservation and no order, then retries |
| `FailBeforeCommit`, `LoseCommitReply` | Host/read failure before invoking create versus a lost response after commit | Separate actions and durable outcomes; fixture discards a successful result. No actual OS crash/production network fault is claimed |
| `CloseProducers`, `RejectClosed`, `CommittedReplayAvailable` | `helpers/orderProducerGate.ts`, `orders.create` existing return before `assertOrderProducersOpen`; existing gate tests and new bridge probe | One environment closure between mutations. Rejecting new intake preserves the reservation; a matching committed receipt bypasses this gate. Gate-first model/source controls demonstrate the distinction |
| `RetryOrDuplicate` | Hub webhook redelivery or inbox runner re-entry | Re-executes route selection; actual [checkoutSnapshotConsumer.ts](../../../src/lib/server/checkoutSnapshotConsumer.ts) `selectCheckoutSnapshotInput` and [webhookOrderPayload.ts](../../../src/lib/server/webhookOrderPayload.ts) `buildConvexOrderCreatePayload` omit the consumed handle on order-route replay |
| `ReceiveReply` | `orders.create` return value through `createOrderInConvex` | Collects successful IDs only; it does not mean supplier fulfillment or webhook HTTP acknowledgement completed |
| `Quiescent` | Abstraction of no further deliveries in this finite run | Stuttering end condition; no new implementation operation or liveness promise |
| `SingleDurableReceipt` | Session indexed lookup, snapshot transfer, existing-order return, tenant/account guards | At most one correct order; reservation present iff no order within this intake-only model; successful IDs refer to that order |

Source snapshot: HEAD `187ca087f859999a7f0b5c82779f39bc89b6e28b` plus per-file
SHA-256 hashes in [source-snapshot.json](source-snapshot.json). The initial
checkout was clean. The runner also checks a digest of the copied CRM source and
fixture tree before/after execution, to detect dependency drift during concurrent
work. Any correspondence mismatch requires review, not automatic hash refresh.
The [supplemental source record](refinement-source-snapshot.json) records the
refinement review at HEAD `663e9ca65d86f1cc9fc0ca8dc190bfd96ea623d3` and hashes the
two additional inspected host effect boundaries; original application hashes
are unchanged. The driver validates both records before and after execution.

## Bounds and limits

[OrderIntake.tla](OrderIntake.tla) has two independent executions and at most two
attempts each (four attempts total; at most two active at once), one bound V2
reservation, one session, one immutable snapshot token and a fixed authenticated
tenant/site/account tuple. Connected and platform configurations are checked
separately. Each attempt can abort/crash; it may commit and lose its reply, or
return successfully and receive another duplicate. Durable writes survive host
re-entry. No symmetry, view, depth cutoff or state constraint discards states.
One monotonic producer-gate closure may interleave; reopening, configuration
changes inside a mutation and durable tenant-admission control changes are omitted.
The original 603-state runs and the expanded 1,206-state runs have separate evidence.
The two configurations are isomorphic parameter substitutions, not separate
authorization proofs; the actual fixtures exercise the different routing guards.
TLC uses breadth-first exploration, one worker, fixed seed/fingerprint polynomial;
finite safety only, with stuttering terminal states and no fairness/liveness rule.

Modeling mutations as atomic serializable steps relies on the documented
[Convex transaction/OCC contract](https://docs.convex.dev/database/advanced/occ).
The offline `convex-test` run exercises function behavior and rollback in memory;
it does **not** test the hosted OCC implementation, actual crash durability,
Stripe authenticity/availability or deployed webhook delivery.

The model excludes pre-bind failures, optional universal Checkout admission
consumption/financial snapshot policy, other sessions/tenants changing ownership,
retention/reconciliation deletion, offboarding/reset/retirement, catalog changes,
manual refunds and liveness. In particular the reservation equivalence is an
**intake-only** rule, not a promise that retention can never remove a bound row.
Bridge fixtures use a digital snapshot without captured print inputs or a
universal admission. Hub legacy-without-ID behavior has an additional fixture;
the finite model uses a fixed abstract tenant identity.

Fulfillment is outside the property. Local order deduplication does not establish
exactly-once LumaPrints submission or Resend delivery. A provider success and a
local checkpoint are distinct operations; no provider timeout/idempotency
contract was exercised, so no external exactly-once claim is made.

See [evidence](evidence.md), the [statechart](statechart.html), and the reusable
[verify-order-intake-state skill](../../../.agents/skills/verify-order-intake-state/SKILL.md).
The method adapts the supplied [formal-verification creator](https://github.com/cursor/plugins/blob/main/pstack/skills/create-formal-verification-skill/SKILL.md)
and [statechart guidance](https://github.com/cursor/plugins/blob/main/pstack/skills/statechart/SKILL.md)
without installing pstack.

The pilot and `.agents/skills/verify-order-intake-state/` are retained in the
repository. The skill is allowlisted in `.gitignore`, and `docs/VERIFICATION.md`
links the rerun command and scope. CI, repository instructions and commerce
behavior remain unchanged.
