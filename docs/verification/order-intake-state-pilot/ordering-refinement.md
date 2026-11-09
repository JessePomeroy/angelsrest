# Ordering and ownership refinement — 2026-11-09

Local follow-up based on released HEAD `663e9ca65d86f1cc9fc0ca8dc190bfd96ea623d3`.
It is outside PR #767. Jesse subsequently authorized delivery, babysitting and
cleanup of this retained refinement on November 9, 2026. This follow-up changes
verification artifacts only; application files, generated files, dependency
manifests and CI remain unchanged.
Historical evidence under `evidence/` and the original source record are preserved.

The original pilot already checked local uniqueness, frozen snapshot transfer,
stale reservation routes, abort/rollback and commit-response loss. Existing
`orders.test.ts` also tested an existing order replaying through a closed producer
gate. The substantive addition makes that recovery outcome explicit in the same
bounded model, tests it across all three fixture scopes and demonstrates why
moving the gate ahead of the lookup changes behavior without duplicating an order
in the witness.
No production defect or actual proposed application refactor was identified.

## Observable boundary

The formal observation is the bound reservation's presence and immutable owner /
snapshot, the persisted order ID and owner / snapshot, successful returned IDs,
and whether the producer gate rejects an already committed receipt. The model
now represents a zero-or-one **record set**, rather than a Boolean reservation.
Its fixed owner fields remain assumptions, not a new proof of authorization.

The offline probes additionally observe the original paid total, one revenue
contribution and daily/all-time aggregate counts. These are durable useful
outcomes even without a screen change. Revenue is implementation-test evidence,
not a modeled invariant or a verification of revenue backfill/reconciliation.

Email acceptance, supplier acceptance, notification outcomes, fee capture and
job completion are distinct downstream observations, outside this model. A
successful `orders.create` response only reports local intake. The hub signature
and trusted tenant/account routing boundary is assumed; conflict probes exercise
local guards but do not replace authentication coverage or live provider tests.

## Authoritative owners and representations

| Fact | Authority and persisted representation | Derivation / reconciliation contract |
| --- | --- | --- |
| Tenant identity | `platformClients.tenantId`; historical `stripeAccountBindings` for account ownership | `assertTenantRouting`, `adoptOrderTenant`, `connectedAccountMatchesSite` revalidate inside transactions. `siteUrl` is a routing partition, not a tenant ID. Historical account bindings permit recovery after current-account changes; current account selection controls new sales. Ownership changes are excluded here. |
| Checkout identity | Authenticated Stripe Session ID plus verified event account / server-stamped metadata | Reservation routing uses `(accountScope, stripeSessionId)`; consumption uses `(siteUrl, handleHash)` and checks bound state, scope and session. Orders use a **session-only index** and then owner checks; this is not a composite database uniqueness constraint. Cross-account literal Session ID collision is unresolved/outside scope, not a demonstrated defect. |
| Frozen purchase | `checkoutSnapshotReservations.snapshot`, with tenant/site/account/scope/session binding | `reserveCheckoutSnapshot` and `bindCheckoutSnapshot` precede the model. `consumeReservation` deletes the bound row and returns saved contents inside `orders.create`; the order owns them only when the same transaction commits. Neither event metadata nor a stale route owns this snapshot. |
| Local receipt | `orders` row and its `_id`, saved snapshot, total and owner | Session lookup and owner checks precede candidate interpretation and producer closure. Replays preserve this observation; legacy tenant adoption or safe fulfillment-type repair can write other fields, so arbitrary byte-for-byte row idempotence is not asserted. |
| Routing snapshot | `readCheckoutRouting` query result, then host's in-flight `source` | A derived read, not a claim or write fence. A fresh `order` route omits the handle via the production selector/builder. A stale `reservation` route can still carry it; the mutation rechecks authoritative orders first. |
| New-order gate | Server configuration `ORDER_PRODUCERS_STATE`; only exact `open` permits new intake | Distinct from durable per-tenant admission controls. The model permits one environment closure between mutations, never a mid-transaction config change or reopening. Existing receipt recovery bypasses this gate, not tenant/account authorization. |
| Revenue projection | Order → `recordOrderRevenue` contribution keyed by order ID → daily/all-time totals | First insertion and projection updates share the create transaction. Existing-order replay returns before recording again. The digital fixtures observe one contribution and unchanged totals after duplicates. Backfills have separate cursor/verification rules and are omitted. |
| Delivery execution | Commerce inbox event record / leases, separate from order identity | Different event IDs and overlapping leases may reach the same checkout; session deduplication remains necessary. Existing inbox suite reused; lease protocol not remodeled. |
| Email / supplier effects | Provider acceptance plus later local delivery/submission checkpoints | Local flags represent what was recorded, not atomic provider truth. See the external boundary below; no exactly-once extension. |

Concrete owners above are in `orders.ts`, `helpers/orderRouting.ts`,
`helpers/stripeAccountOwnership.ts`, `helpers/checkoutSnapshot.ts`,
`helpers/orderProducerGate.ts`, `helpers/orderRevenue.ts`, and
`commerceIntakeInbox.ts`. The original source manifest covers these plus their
execution tree. The supplemental manifest pins the two inspected host effect
boundaries without changing the original manifest's historical identity.

## Transitions and checkpoints

| Action | Trigger / snapshot / precondition | Durable change and boundary |
| --- | --- | --- |
| `ResolveRouting`, then `FetchDetails` | Verified delivery, read order or bound reservation; resolve tenant and await Stripe details separately | No reservation/order claim. Query snapshot can become stale during any later await. Successful details are abstracted. |
| `CreateTransaction` existing branch | `orders.create`: authenticate, validate incoming tenant, query session index, reject retired/conflicting ownership; return matching existing row | Replay before producer gate, candidate parsing and late number validation. Still one serializable mutation, with no provider call. |
| `CreateTransaction` new branch | No existing order, producer gate open, matching owner/bound candidate; real code additionally validates admission/catalog/financial inputs | Delete reservation, validate remaining input, insert order, record revenue and relevant local jobs/schedules in **one transaction**. These extra policy checks are not all modeled. |
| `RejectClosed` | No existing order and producer gate closed | Throws before consumption; no write. The model records IDs present **at rejection**, so a later concurrent commit does not retrospectively make a legitimate rejection a violation. |
| `AbortTransaction` | New-order branch can fail after deletion, before commit | All writes roll back. Fixture injects an invalid optional order number directly into the mutation; this is not a known natural webhook payload. The model now restricts this late-failure action to the new-order branch. |
| `FailBeforeCommit` | Host/read failure before it invokes the committing mutation | No write by this attempt; another delivery may already have committed. |
| `LoseCommitReply` | Mutation committed, transport/host loses response | Order persists; reservation stays consumed. Fixture discards the return value. This is not a failed transaction and not an actual OS/network crash experiment. |
| `RetryOrDuplicate` | Another delivery / retry, within two attempts per worker | Fresh routing is allowed; same transaction checks apply. No eventual-success/fairness requirement. |

The added `CommittedReplayAvailable` invariant means producer closure alone never
rejects a receipt already present at this checkpoint. It does not promise that
an external read succeeds, authorization never changes, or a stopped attempt is
eventually retried. `rejectedReceipts` is a model-only history observation, not
a proposed database field or a production error queue.

## Reachable pairs and repetitions

Equivalence below uses the defined receipt observation; it ignores generated ID
spelling across independent runs while requiring replies within a run to agree.

| Pair / repetition | When order is safe or significant |
| --- | --- |
| Route A / route B | With no intervening write, read order is immaterial. With a create between them, returned sources differ. Those read results are **not** equivalent, though both paths may converge on the same durable receipt. |
| Route A / create B | Either order preserves the final receipt only because create A rechecks orders transactionally. An old reservation read is not permission to consume a now-missing row. |
| Create A / create B | Same authenticated purchase, valid captured inputs, open gate and fixed ownership: either serial order produces one receipt, then returns it. If competing first-write inputs differ, which valid input wins can matter; arbitrary changed first-write inputs are not claimed to commute. |
| Repeat create after commit | Returns the same receipt and skips new consumption / revenue recording, even with an obsolete or malformed candidate. Authorization/owner checks still apply. This says nothing about repeating downstream sends. |
| Close gate / first create | **Does not commute.** Close first rejects and preserves the reservation; create first saves the receipt and then closure does not undo it. Both are approved outcomes. |
| Close gate / replay existing create | Under fixed authorization/ownership and no retirement, closure alone does not change replay success. Reordering the gate check ahead of the existing-order return violates this outcome. |
| Abort / competing create | Abort contributes no committed writes. The competing create may succeed; a later retry then returns it. An abort cannot delete the other transaction's receipt. |
| Delete reservation / insert order | Not separate reachable committed operations in this implementation. Splitting them is a deliberate broken model, not a discovered real ordering. |
| Lose reply / retry | Retry cannot precede the loss in this attempt's control flow, but another delivery can overlap. A lost response does not revert ownership to the reservation. |
| Receipt preparation / external send / acknowledgement | Prerequisites and later acceptance matter. Not interchangeable with create or guaranteed repeat-safe by this pilot. |

## External effects and remaining uncertainty

`webhookOrders.createOrderInConvex` awaits create before `onOrderRecorded` and
then print processing (or returns a scheduled job). In `orderReceipt.ts`,
`prepareOrderReceipt` records the local fence, provider sending uses per-audience
keys, and `completeOrderReceipt` later records acceptance. The host deadline
does not abort the SDK request; a late completion may still checkpoint. An
expired retry window can remain uncertain. No provider retention contract was
verified in this follow-up; there is no exactly-once email proof.

In `printFulfillment.ts`, `claimPrintFulfillmentV5`, preparation and
`beginPrintFulfillmentSubmission` precede `provider.createOrder`; the subsequent
`recordPrintFulfillmentSubmissionReceipt` is another mutation and provider
confirmation/reconciliation is separate again. Definitely rejected submission
and unknown outcome take different branches. Local order uniqueness cannot
make that external call and local checkpoint atomic. Supplier credentials,
supplier acceptance/idempotency and email deliveries were not exercised.

The gate-first change is a **deliberate hypothetical mutation**, not an actual
product refactor proposal. Its non-equivalence is supported by the bounded
counterexample and the same fresh-order-route sequence failing actual mutated
code in all three synthetic scopes. No unrestricted refactor-equivalence proof
is claimed. There is no known failing input for the unmodified product here.

See [separate observed evidence](evidence.md#ordering-refinement-2026-11-09),
[the diagram](statechart.html), and [the reusable skill](../../../.agents/skills/verify-order-intake-state/SKILL.md).
