--------------------------- MODULE OrderIntake ---------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS Workers, MaxAttempts, TenantId, SiteUrl, StripeSessionId,
          StripeConnectedAccountId, AccountScope, FrozenSnapshot

VARIABLES reservation, orders, pc, route, attempt, pendingReply, replies
vars == <<reservation, orders, pc, route, attempt, pendingReply, replies>>

(* Starts AFTER reserveCheckoutSnapshot and bindCheckoutSnapshot committed.
   Both workers carry the SAME already authenticated purchase identity.
   No provider/API call is part of a Convex transaction. *)
Init ==
  /\ reservation = TRUE
  /\ orders = {}
  /\ pc = [w \in Workers |-> "ready"]
  /\ route = [w \in Workers |-> "none"]
  /\ attempt = [w \in Workers |-> 1]
  /\ pendingReply = [w \in Workers |-> 0]
  /\ replies = {}

ResolveRouting(w) ==
  /\ pc[w] = "ready"
  /\ route' = [route EXCEPT ![w] = IF orders # {} THEN "order" ELSE "reservation"]
  /\ pc' = [pc EXCEPT ![w] = "routed"]
  /\ UNCHANGED <<reservation, orders, attempt, pendingReply, replies>>

(* Stripe reads / tenant resolution finish separately from the durable write.
   The routing result can become stale while these reads are in flight. *)
FetchDetails(w) ==
  /\ pc[w] = "routed"
  /\ pc' = [pc EXCEPT ![w] = "details"]
  /\ UNCHANGED <<reservation, orders, route, attempt, pendingReply, replies>>

NewOrder == [id |-> Cardinality(orders) + 1, tenant |-> TenantId,
             site |-> SiteUrl, session |-> StripeSessionId,
             account |-> StripeConnectedAccountId, scope |-> AccountScope,
             snapshot |-> IF reservation THEN FrozenSnapshot ELSE "none"]

(* ONE serializable Convex mutation: re-read existing order, or consume the
   bound reservation and insert. The earlier route read is NOT a write fence.
   A fresh order-route retry omits the reservation candidate in the real host. *)
CreateTransaction(w) ==
  /\ pc[w] = "details"
  /\ IF orders # {}
        THEN /\ pendingReply' = [pendingReply EXCEPT ![w] = (CHOOSE o \in orders : TRUE).id]
             /\ pc' = [pc EXCEPT ![w] = "committed"]
             /\ UNCHANGED <<reservation, orders>>
        ELSE IF route[w] = "order" \/ reservation
          THEN /\ orders' = orders \cup {NewOrder}
               /\ reservation' = FALSE
               /\ pendingReply' = [pendingReply EXCEPT ![w] = NewOrder.id]
               /\ pc' = [pc EXCEPT ![w] = "committed"]
          ELSE /\ pc' = [pc EXCEPT ![w] = "stopped"]
               /\ UNCHANGED <<reservation, orders, pendingReply>>
  /\ UNCHANGED <<route, attempt, replies>>

(* Includes an exception AFTER consumeReservation's delete: transaction rolls
   back; it is not a separately visible reservation deletion. *)
AbortTransaction(w) ==
  /\ pc[w] = "details"
  /\ pc' = [pc EXCEPT ![w] = "stopped"]
  /\ UNCHANGED <<reservation, orders, route, attempt, pendingReply, replies>>

(* In committed, a crash/timeout loses the reply, NOT the committed order. *)
CrashOrLostReply(w) ==
  /\ pc[w] \in {"routed", "details", "committed"}
  /\ pc' = [pc EXCEPT ![w] = "stopped"]
  /\ pendingReply' = [pendingReply EXCEPT ![w] = 0]
  /\ UNCHANGED <<reservation, orders, route, attempt, replies>>

ReceiveReply(w) ==
  /\ pc[w] = "committed"
  /\ replies' = replies \cup {pendingReply[w]}
  /\ pc' = [pc EXCEPT ![w] = "done"]
  /\ UNCHANGED <<reservation, orders, route, attempt, pendingReply>>

RetryOrDuplicate(w) ==
  /\ pc[w] \in {"stopped", "done"}
  /\ attempt[w] < MaxAttempts
  /\ attempt' = [attempt EXCEPT ![w] = @ + 1]
  /\ pc' = [pc EXCEPT ![w] = "ready"]
  /\ route' = [route EXCEPT ![w] = "none"]
  /\ pendingReply' = [pendingReply EXCEPT ![w] = 0]
  /\ UNCHANGED <<reservation, orders, replies>>

Quiescent ==
  /\ \A w \in Workers : pc[w] \in {"stopped", "done"}
  /\ UNCHANGED vars

Next == (\E w \in Workers :
          ResolveRouting(w) \/ FetchDetails(w) \/ CreateTransaction(w)
          \/ AbortTransaction(w) \/ CrashOrLostReply(w) \/ ReceiveReply(w)
          \/ RetryOrDuplicate(w)) \/ Quiescent

(* One durable intake receipt: no duplicate identity, no lost/overwritten
   reservation snapshot, and every observed successful reply names that order.
   This is a safety property; it does not promise eventual intake. *)
SingleDurableReceipt ==
  /\ Cardinality(orders) <= 1
  /\ (reservation <=> orders = {})
  /\ \A o \in orders :
       /\ o.tenant = TenantId /\ o.site = SiteUrl /\ o.session = StripeSessionId
       /\ o.account = StripeConnectedAccountId /\ o.scope = AccountScope
       /\ o.snapshot = FrozenSnapshot
  /\ replies \subseteq {o.id : o \in orders}

TypeOK ==
  /\ reservation \in BOOLEAN
  /\ pc \in [Workers -> {"ready", "routed", "details", "committed", "stopped", "done"}]
  /\ route \in [Workers -> {"none", "reservation", "order"}]
  /\ attempt \in [Workers -> 1..MaxAttempts]
  /\ pendingReply \in [Workers -> 0..(Cardinality(Workers) * MaxAttempts)]
  /\ replies \subseteq 1..(Cardinality(Workers) * MaxAttempts)

=============================================================================
