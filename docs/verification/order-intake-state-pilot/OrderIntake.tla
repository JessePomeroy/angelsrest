--------------------------- MODULE OrderIntake ---------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS Workers, MaxAttempts, TenantId, SiteUrl, StripeSessionId,
          StripeConnectedAccountId, AccountScope, FrozenSnapshot

VARIABLES reservation, orders, pc, route, attempt, pendingReply, replies,
          producersOpen, rejectedReceipts
vars == <<reservation, orders, pc, route, attempt, pendingReply, replies,
          producersOpen, rejectedReceipts>>

BoundReservation == [tenant |-> TenantId, site |-> SiteUrl,
                     session |-> StripeSessionId, account |-> StripeConnectedAccountId,
                     scope |-> AccountScope, snapshot |-> FrozenSnapshot, state |-> "bound"]
HasReservation == reservation # {}

(* Starts AFTER reserveCheckoutSnapshot and bindCheckoutSnapshot committed.
   Both workers carry the SAME already authenticated purchase identity.
   No provider/API call is part of a Convex transaction. *)
Init ==
  /\ reservation = {BoundReservation}
  /\ orders = {}
  /\ pc = [w \in Workers |-> "ready"]
  /\ route = [w \in Workers |-> "none"]
  /\ attempt = [w \in Workers |-> 1]
  /\ pendingReply = [w \in Workers |-> 0]
  /\ replies = {}
  /\ producersOpen = TRUE
  /\ rejectedReceipts = {}

(* Environment configuration between mutations, not a durable tenant admission
   control. No reopen, purge, retirement or ownership changes in this bound. *)
CloseProducers ==
  /\ producersOpen
  /\ producersOpen' = FALSE
  /\ UNCHANGED <<reservation, orders, pc, route, attempt, pendingReply, replies,
                 rejectedReceipts>>

ResolveRouting(w) ==
  /\ pc[w] = "ready"
  /\ route' = [route EXCEPT ![w] = IF orders # {} THEN "order" ELSE "reservation"]
  /\ pc' = [pc EXCEPT ![w] = "routed"]
  /\ UNCHANGED <<reservation, orders, attempt, pendingReply, replies,
                 producersOpen, rejectedReceipts>>

(* Stripe reads / tenant resolution finish separately from the durable write.
   The routing result can become stale while these reads are in flight. *)
FetchDetails(w) ==
  /\ pc[w] = "routed"
  /\ pc' = [pc EXCEPT ![w] = "details"]
  /\ UNCHANGED <<reservation, orders, route, attempt, pendingReply, replies,
                 producersOpen, rejectedReceipts>>

NewOrder == [id |-> Cardinality(orders) + 1, tenant |-> TenantId,
             site |-> SiteUrl, session |-> StripeSessionId,
             account |-> StripeConnectedAccountId, scope |-> AccountScope,
             snapshot |-> IF HasReservation THEN (CHOOSE r \in reservation : TRUE).snapshot ELSE "none"]

(* ONE serializable Convex mutation: re-read existing order, or consume the
   bound reservation and insert. The earlier route read is NOT a write fence.
   A fresh order-route retry omits the reservation candidate in the real host. *)
CreateTransaction(w) ==
  /\ pc[w] = "details"
  /\ (orders # {} \/ producersOpen)
  /\ IF orders # {}
        THEN /\ pendingReply' = [pendingReply EXCEPT ![w] = (CHOOSE o \in orders : TRUE).id]
             /\ pc' = [pc EXCEPT ![w] = "committed"]
             /\ UNCHANGED <<reservation, orders>>
        ELSE IF route[w] = "order" \/ HasReservation
          THEN /\ orders' = orders \cup {NewOrder}
               /\ reservation' = {}
               /\ pendingReply' = [pendingReply EXCEPT ![w] = NewOrder.id]
               /\ pc' = [pc EXCEPT ![w] = "committed"]
          ELSE /\ pc' = [pc EXCEPT ![w] = "stopped"]
               /\ UNCHANGED <<reservation, orders, pendingReply>>
  /\ UNCHANGED <<route, attempt, replies, producersOpen, rejectedReceipts>>

(* Gate failure before reservation consumption. Record IDs present at rejection,
   not orders that might be committed by another delivery afterward. *)
RejectClosed(w) ==
  /\ pc[w] = "details" /\ ~producersOpen
  /\ orders = {}
  /\ rejectedReceipts' = rejectedReceipts \cup {o.id : o \in orders}
  /\ pc' = [pc EXCEPT ![w] = "stopped"]
  /\ UNCHANGED <<reservation, orders, route, attempt, pendingReply, replies, producersOpen>>

(* Includes an exception AFTER consumeReservation's delete: transaction rolls
   back; it is not a separately visible reservation deletion. *)
AbortTransaction(w) ==
  /\ pc[w] = "details"
  /\ orders = {} /\ producersOpen /\ HasReservation
  /\ pc' = [pc EXCEPT ![w] = "stopped"]
  /\ UNCHANGED <<reservation, orders, route, attempt, pendingReply, replies,
                 producersOpen, rejectedReceipts>>

FailBeforeCommit(w) ==
  /\ pc[w] \in {"routed", "details"}
  /\ pc' = [pc EXCEPT ![w] = "stopped"]
  /\ pendingReply' = [pendingReply EXCEPT ![w] = 0]
  /\ UNCHANGED <<reservation, orders, route, attempt, replies,
                 producersOpen, rejectedReceipts>>

(* A response timeout AFTER commit loses the reply, not the durable receipt. *)
LoseCommitReply(w) ==
  /\ pc[w] = "committed"
  /\ pc' = [pc EXCEPT ![w] = "stopped"]
  /\ pendingReply' = [pendingReply EXCEPT ![w] = 0]
  /\ UNCHANGED <<reservation, orders, route, attempt, replies,
                 producersOpen, rejectedReceipts>>

ReceiveReply(w) ==
  /\ pc[w] = "committed"
  /\ replies' = replies \cup {pendingReply[w]}
  /\ pc' = [pc EXCEPT ![w] = "done"]
  /\ UNCHANGED <<reservation, orders, route, attempt, pendingReply,
                 producersOpen, rejectedReceipts>>

RetryOrDuplicate(w) ==
  /\ pc[w] \in {"stopped", "done"}
  /\ attempt[w] < MaxAttempts
  /\ attempt' = [attempt EXCEPT ![w] = @ + 1]
  /\ pc' = [pc EXCEPT ![w] = "ready"]
  /\ route' = [route EXCEPT ![w] = "none"]
  /\ pendingReply' = [pendingReply EXCEPT ![w] = 0]
  /\ UNCHANGED <<reservation, orders, replies, producersOpen, rejectedReceipts>>

Quiescent ==
  /\ \A w \in Workers : pc[w] \in {"stopped", "done"}
  /\ UNCHANGED vars

Next == CloseProducers \/ (\E w \in Workers :
          ResolveRouting(w) \/ FetchDetails(w) \/ CreateTransaction(w)
          \/ RejectClosed(w) \/ AbortTransaction(w) \/ FailBeforeCommit(w)
          \/ LoseCommitReply(w) \/ ReceiveReply(w)
          \/ RetryOrDuplicate(w)) \/ Quiescent

(* One durable intake receipt: no duplicate identity, no lost/overwritten
   reservation snapshot, and every observed successful reply names that order.
   This is a safety property; it does not promise eventual intake. *)
SingleDurableReceipt ==
  /\ Cardinality(orders) <= 1
  /\ (HasReservation <=> orders = {})
  /\ (HasReservation => reservation = {BoundReservation})
  /\ \A o \in orders :
       /\ o.tenant = TenantId /\ o.site = SiteUrl /\ o.session = StripeSessionId
       /\ o.account = StripeConnectedAccountId /\ o.scope = AccountScope
       /\ o.snapshot = FrozenSnapshot
  /\ replies \subseteq {o.id : o \in orders}

(* Lookup precedes the producer gate: closure cannot itself reject a matching
   committed receipt. This is an outcome safety rule, not eventual recovery. *)
CommittedReplayAvailable == rejectedReceipts = {}

TypeOK ==
  /\ reservation \subseteq {BoundReservation}
  /\ producersOpen \in BOOLEAN
  /\ rejectedReceipts \subseteq 1..(Cardinality(Workers) * MaxAttempts)
  /\ pc \in [Workers -> {"ready", "routed", "details", "committed", "stopped", "done"}]
  /\ route \in [Workers -> {"none", "reservation", "order"}]
  /\ attempt \in [Workers -> 1..MaxAttempts]
  /\ pendingReply \in [Workers -> 0..(Cardinality(Workers) * MaxAttempts)]
  /\ replies \subseteq 1..(Cardinality(Workers) * MaxAttempts)

=============================================================================
