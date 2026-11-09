# One durable intake receipt

Customer impact: duplicate payment-event handling must not create a second
local order or lose the saved product snapshot between reservation and order.

Entry points inspected: the hub's `/api/webhooks/stripe`, its optional durable
commerce inbox runner, `processStripeWebhookEvent`, `createOrderInConvex`,
`orders.resolveCheckoutRouting`, and `orders.create`/`consumeReservation`.
The actual HTTP signature/authentication boundary is an assumed prerequisite
of this pilot, not a live-exercised feature.

Run the exact command in SKILL.md. Prerequisites are the pinned development
tools and installed repository dependencies; `check.py --setup` fetches the two
development binaries when missing. Health means matching source hashes, tool
versions, and a working offline namespace. There is no logged-in user/account.

The fixture drives actual reserve, bind, route and create functions in fresh
in-memory Convex instances. It checks stale routing before competing writes,
discarded commit replies followed by a fresh route, malformed/changed replay
inputs, tenant/account conflicts before and after intake, and a late validation
failure after reservation deletion followed by a successful retry. The fresh
route replay calls the production selector and payload builder.
It also checks fresh/stale recovery after producer closure and persistent bound
ownership. Receipt assertions include the one contribution and daily/all-time
revenue totals; those projections are offline implementation evidence only.

Success: exactly one row, original snapshot/identity and paid total preserved,
all successful replay IDs equal, consumed reservation absent. Aborted creation:
no order, original bound row unchanged. Conflicting identity: rejected without
consuming/altering the valid receipt. Cancellation and refunds are outside this
feature's scope.
Producer closure can reject new intake, but cannot itself block the existing-order
return. A separate gate-first source mutation must fail this recovery outcome
while the lookup-removal mutation must fail uniqueness. See the pilot's ordering
map for conditional commutativity and the excluded provider/notification effects.

Proof: `summary.json`, full `tlc-*.log` traces, Vitest JSON reports and the isolated
mutation patches in the printed evidence directory. The model covers all its
finite action orderings; the TypeScript fixture covers representative real-code
paths only. In-memory Convex does not establish production OCC or durability;
those are platform assumptions, separately documented in the pilot.

Cleanup is automatic temporary-directory removal; proof remains under
`test-results`. No application/Worker process or live provider state is created.
See the pilot's HTML diagram for the successful flow and deliberately broken
counterexample. Re-render the HTML with the runtime's supported HTML preview
and render tools when showing it; do not use browser preview tools for this task.
