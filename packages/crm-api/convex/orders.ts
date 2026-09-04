import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	type MutationCtx,
	mutation,
	query,
	type QueryCtx,
} from "./_generated/server";
import {
	requireDocumentSiteAdmin,
	requireOrderLookupCaller,
	requireSiteAdmin,
	requireWebhookCallerOrAuth,
} from "./authHelpers";
import {
	catalogCommerceRequestValidator,
	catalogCommerceResolutionErrorKind,
	resolveCatalogCommerce,
} from "./helpers/catalogCommerce";
import {
	checkoutSnapshotValidator,
	isBoundedStripeExpiration,
	isStripeCheckoutSessionId,
	isStripeConnectedAccountId,
	parseReservationCandidate,
	reservedCheckoutSnapshotValidator,
	reservationHandleHash,
	stripeAccountScope,
} from "./helpers/checkoutSnapshot";
import { tenantIdentityMatchesSite } from "./helpers/tenantContext";
import { AGGREGATE_SCAN_LIMIT, BULK_SCAN_LIMIT } from "./helpers/limits";
import {
	assertOrderNumberAvailable,
	getNextOrderNumber as generateNextOrderNumber,
	parseCanonicalOrderNumber,
} from "./helpers/numbering";
import { assertOrderProducersOpen } from "./helpers/orderProducerGate";
import { resolveBoundedOrderStatsScan } from "./helpers/orderStats";
import {
	classifyRefundTargetRows,
	refundTargetClassificationValidator,
} from "./helpers/refundTargetClassifier";
import {
	FEE_CAPTURE_INITIAL_DELAY_MS,
	isNonnegativeSafeInteger,
	isStripeCurrency,
} from "./helpers/stripeFeeCapture";
import {
	consumeCheckoutSessionAdmission,
	getDurablePurposeControl,
} from "./commerceClosure";

const orderStatusValidator = v.union(
	v.literal("new"),
	v.literal("printing"),
	v.literal("ready"),
	v.literal("shipped"),
	v.literal("delivered"),
	v.literal("refunded"),
	v.literal("fulfillment_error"),
);

const shipmentEmailDeliveryStatusValidator = v.union(
	v.literal("sent"),
	v.literal("failed"),
	v.literal("skipped"),
);

const shipmentEmailDeliveryFailureCodeValidator = v.union(
	v.literal("missing_customer_email"),
	v.literal("notification_profile_unavailable"),
	v.literal("email_delivery_failed"),
	v.literal("unexpected_send_failure"),
	v.literal("legacy_delivery_failed"),
);

const fulfillmentRecoveryStatusValidator = v.union(
	v.literal("refund_pending"),
	v.literal("refunded"),
	v.literal("refund_failed"),
	v.literal("refund_attention"),
);

const automatedRefundStatusValidator = v.union(
	v.literal("pending"),
	v.literal("requires_action"),
	v.literal("succeeded"),
	v.literal("failed"),
	v.literal("canceled"),
);

type AutomatedRefundStatus =
	| "pending"
	| "requires_action"
	| "succeeded"
	| "failed"
	| "canceled";

type AutomatedRefundAttentionReason = "attempts_exhausted" | "age_exceeded";

const printFulfillmentReconciliationClassValidator = v.union(
	v.literal("provider_rejected"),
	v.literal("response_contract"),
	v.literal("ambiguous_result"),
	v.literal("client_error"),
);

const printFulfillmentInconclusiveClassValidator = v.union(
	v.literal("transport"),
	v.literal("rate_or_server"),
	v.literal("resource_bound"),
	v.literal("client_exception"),
	v.literal("result_not_observed"),
);

type PrintFulfillmentInconclusiveClass =
	| "transport"
	| "rate_or_server"
	| "resource_bound"
	| "client_exception"
	| "result_not_observed";

const manualRefundReconciliationResultValidator = v.union(
	v.object({ kind: v.literal("reconciled") }),
	v.object({ kind: v.literal("replayed") }),
	v.object({ kind: v.literal("pending_order") }),
	v.object({
		kind: v.literal("retryable"),
		reason: v.literal("print_submission_in_flight"),
	}),
	v.object({
		kind: v.literal("rejected"),
		reason: v.union(v.literal("identity_conflict"), v.literal("state_conflict")),
	}),
);

type ManualRefundReconciliationResult =
	| { kind: "reconciled" }
	| { kind: "replayed" }
	| { kind: "pending_order" }
	| { kind: "retryable"; reason: "print_submission_in_flight" }
	| { kind: "rejected"; reason: "identity_conflict" | "state_conflict" };

const STRIPE_EVENT_ID = /^evt_[A-Za-z0-9]{8,120}$/;
const STRIPE_REFUND_ID = /^re_[A-Za-z0-9]{8,120}$/;
const STRIPE_PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9]{8,120}$/;
const STRIPE_CHARGE_ID = /^ch_[A-Za-z0-9]{8,120}$/;
const CLAIM_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LUMAPRINTS_ORDER_NUMBER = /^[1-9]\d{0,63}$/;
const PRINT_PREPARATION_LEASE_MS = 15 * 60 * 1000;
const PRINT_RECONCILIATION_ALERT_LEASE_MS = 15 * 60 * 1000;
const AUTOMATED_REFUND_LEASE_MS = 15 * 60 * 1000;
const FULFILLMENT_NOTIFICATION_LEASE_MS = 15 * 60 * 1000;
const SHIPMENT_EMAIL_NOTIFICATION_LEASE_MS = 15 * 60 * 1000;
// Resend retains idempotency keys for 24 hours. Stop automatic sends one hour
// early so a lost completion checkpoint cannot authorize a duplicate later.
const EMAIL_AUTOMATIC_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const PRINT_RECONCILIATION_PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PRINT_RECONCILIATION_PENDING_MAX_ATTEMPTS = 5;
const AUTOMATED_REFUND_PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const AUTOMATED_REFUND_PENDING_MAX_ATTEMPTS = 5;
const REFUND_AUTOMATION_TAG = "fulfillment_recovery_v1";
const FULFILLMENT_NOTIFICATION_PROTOCOL = "leased_v1";
const SHIPMENT_EMAIL_NOTIFICATION_PROTOCOL = "leased_v2";

function canClaimShipmentEmail(status: string) {
	return status === "new" || status === "printing" || status === "ready";
}

async function findGlobalLumaPrintsOrder(ctx: MutationCtx, lumaprintsOrderNumber: string) {
	const matchingOrders = await ctx.db
		.query("orders")
		.withIndex("by_lumaprintsOrderNumber_global", (q) =>
			q.eq("lumaprintsOrderNumber", lumaprintsOrderNumber),
		)
		.take(2);
	if (matchingOrders.length > 1) {
		throw new Error("Duplicate LumaPrints order number across tenants");
	}
	return matchingOrders[0] ?? null;
}

function hasUncertainPrintSubmission(order: Doc<"orders">) {
	return order.printFulfillmentClaim === true
		&& order.lumaprintsOrderNumber === undefined
		&& order.printFulfillmentResolution !== "resolved"
		&& (
			order.printFulfillmentPhase === "submitting"
				|| order.printFulfillmentPhase === undefined
		);
}

/**
 * Temporary rollout compatibility for the exact durable states written by the
 * baseline V1 and V2 hosts. New hosts must use the tokenized completion or GET
 * reconciliation mutations below.
 */
function hasBaselinePrintCompletionClaim(order: Doc<"orders">) {
	if (!hasUncertainPrintSubmission(order)) return false;
	if (order.printFulfillmentPhase === undefined) {
		return order.printFulfillmentClaimToken === undefined
			&& order.printFulfillmentClaimedAt === undefined
			&& order.printFulfillmentLeaseExpiresAt === undefined;
	}
	return order.printFulfillmentPhase === "submitting"
		&& order.printFulfillmentClaimToken !== undefined
		&& CLAIM_TOKEN.test(order.printFulfillmentClaimToken)
		&& order.printFulfillmentClaimedAt !== undefined
		&& order.printFulfillmentLeaseExpiresAt === undefined;
}

function printFulfillmentCompletionOutcome(order: Doc<"orders">) {
	if (
		order.status === "refunded"
		&& order.stripeRefundId
		&& order.fulfillmentRecoveryStatus === undefined
	) return { kind: "manual_refunded" as const, stripeRefundId: order.stripeRefundId };
	if (order.stripeRefundId) {
		return { kind: "automated_refunded" as const, stripeRefundId: order.stripeRefundId };
	}
	return { kind: "fulfilled" as const };
}

async function attachPrintFulfillmentResult(
	ctx: MutationCtx,
	order: Doc<"orders">,
	lumaprintsOrderNumber: string,
	options: { reserveOrderConfirmation?: boolean } = {},
) {
	const existing = await findGlobalLumaPrintsOrder(ctx, lumaprintsOrderNumber);
	if (existing && existing._id !== order._id) {
		throw new Error("LumaPrints order number belongs to another order");
	}
	await ctx.db.patch(order._id, {
		lumaprintsOrderNumber,
		printFulfillmentClaim: undefined,
		printFulfillmentClaimToken: undefined,
		printFulfillmentPhase: undefined,
		printFulfillmentClaimedAt: undefined,
		printFulfillmentLeaseExpiresAt: undefined,
		printFulfillmentResolution: "resolved",
		printFulfillmentReconciliationClass: undefined,
		printFulfillmentReconciliationBlockedAt: undefined,
		printFulfillmentReconciliationPendingFirstAt: undefined,
		printFulfillmentReconciliationPendingAttempts: undefined,
		printFulfillmentReconciliationLastAttemptAt: undefined,
		printFulfillmentReconciliationLastAttemptClass: undefined,
		printFulfillmentReconciliationPendingClassCounts: undefined,
		printFulfillmentReconciliationEscalationReason: undefined,
		...(options.reserveOrderConfirmation && order.orderConfirmationClaimedAt === undefined
			? { orderConfirmationClaimedAt: Date.now() }
			: {}),
	});
	return printFulfillmentCompletionOutcome({ ...order, lumaprintsOrderNumber });
}

async function claimShipmentEmailForOrder(
	ctx: MutationCtx,
	order: Doc<"orders">,
	trackingNumber?: string,
	trackingUrl?: string,
) {
	if (order.shipmentEmailNotificationProtocol === SHIPMENT_EMAIL_NOTIFICATION_PROTOCOL) {
		return {
			claimed: false,
			order: {
				_id: order._id,
				siteUrl: order.siteUrl,
				orderNumber: order.orderNumber,
				customerEmail: order.customerEmail,
			},
		};
	}
	const patch: Record<string, unknown> = {};
	if (canClaimShipmentEmail(order.status)) patch.status = "shipped";
	if (trackingNumber !== undefined) patch.trackingNumber = trackingNumber;
	if (trackingUrl !== undefined) patch.trackingUrl = trackingUrl;

	const shouldClaim =
		order.shipmentEmailSentAt === undefined && canClaimShipmentEmail(order.status);
	if (shouldClaim) {
		patch.shipmentEmailSentAt = Date.now();
		patch.shipmentEmailDeliveryStatus = "pending";
	}

	if (Object.keys(patch).length > 0) await ctx.db.patch(order._id, patch);
	return {
		claimed: shouldClaim,
		order: {
			_id: order._id,
			siteUrl: order.siteUrl,
			orderNumber: order.orderNumber,
			customerEmail: order.customerEmail,
		},
	};
}

async function recordShipmentEmailForOrder(
	ctx: MutationCtx,
	order: Doc<"orders">,
	status: "sent" | "failed" | "skipped",
	error?: string,
) {
	if (order.shipmentEmailNotificationProtocol === SHIPMENT_EMAIL_NOTIFICATION_PROTOCOL) {
		return {
			recorded: false,
			order: { _id: order._id, siteUrl: order.siteUrl, orderNumber: order.orderNumber },
		};
	}
	const patch: Pick<
		Doc<"orders">,
		| "shipmentEmailDeliveryStatus"
		| "shipmentEmailDeliveryAttemptedAt"
		| "shipmentEmailDeliveryError"
	> = {
		shipmentEmailDeliveryStatus: status,
		shipmentEmailDeliveryAttemptedAt: Date.now(),
	};
	if (status === "failed") patch.shipmentEmailDeliveryError = "legacy_delivery_failed";
	else patch.shipmentEmailDeliveryError = undefined;

	await ctx.db.patch(order._id, patch);
	return {
		recorded: true,
		order: { _id: order._id, siteUrl: order.siteUrl, orderNumber: order.orderNumber },
	};
}

export const UNBOUND_RETENTION_MS = 25 * 60 * 60 * 1000;
export const PAID_SAFE_DELAY_MS = 35 * 24 * 60 * 60 * 1000;
const RESERVATION_RETRY_DELAYS_MS = [60 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000] as const;

async function canonicalSiteForConnectedAccount(ctx: QueryCtx, account: string) {
	const client = await ctx.db.query("platformClients")
		.withIndex("by_stripeConnectedAccountId", (q) => q.eq("stripeConnectedAccountId", account))
		.unique();
	return client?.siteUrl ?? null;
}

async function connectedAccountMatchesSite(
	ctx: QueryCtx,
	siteUrl: string,
	account: string | undefined,
) {
	return account === undefined || await canonicalSiteForConnectedAccount(ctx, account) === siteUrl;
}

async function assertNewOrderAdmissionOpenIfActivated(ctx: QueryCtx, siteUrl: string) {
	const control = await getDurablePurposeControl(ctx, siteUrl, "new_order_admission");
	if (control?.state === "closed") throw new Error("New order admission is closed");
}

function routingConflict(): never {
	throw new Error("Checkout routing facts conflict");
}

async function retiredOrderSession(
	ctx: Pick<QueryCtx, "db">,
	stripeSessionId: string,
) {
	return await ctx.db
		.query("retiredOrderSessions")
		.withIndex("by_stripeSessionId", (q) => q.eq("stripeSessionId", stripeSessionId))
		.unique();
}

async function tokenlessPreProtocolCheckoutIsCompatible(
	ctx: QueryCtx,
	args: {
		siteUrl: string;
		stripeConnectedAccountId: string | undefined;
		stripeSessionCreatedAt: number | undefined;
		stripeSessionExpiresAt: number | undefined;
	},
) {
	if (
		!Number.isSafeInteger(args.stripeSessionCreatedAt)
		|| !Number.isSafeInteger(args.stripeSessionExpiresAt)
	) return false;
	const createdAt = args.stripeSessionCreatedAt as number;
	const expiresAt = args.stripeSessionExpiresAt as number;
	const lifetime = expiresAt - createdAt;
	if (lifetime < 1800 || lifetime > 86_400) return false;
	const cutoff = await ctx.db.query("commerceProtocolCutoffs")
		.withIndex("by_siteUrl_and_accountScope", (q) => q
			.eq("siteUrl", args.siteUrl)
			.eq("accountScope", stripeAccountScope(args.stripeConnectedAccountId)))
		.unique();
	return cutoff !== null
		&& Date.now() < cutoff.acceptUntilMs
		&& createdAt < cutoff.cutoffCreatedSeconds
		&& createdAt >= cutoff.cutoffCreatedSeconds - 86_400;
}

export const reserveCheckoutSnapshot = internalMutation({
	args: {
		tenantId: v.optional(v.string()), siteUrl: v.string(), handleHash: v.string(), snapshotDigest: v.string(),
		snapshot: reservedCheckoutSnapshotValidator, stripeConnectedAccountId: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		if (
			args.stripeConnectedAccountId !== undefined
			&& !isStripeConnectedAccountId(args.stripeConnectedAccountId)
		) return { outcome: "invalid" as const };
		if (!await connectedAccountMatchesSite(ctx, args.siteUrl, args.stripeConnectedAccountId)) {
			return { outcome: "routing_mismatch" as const };
		}
		if (args.tenantId && !await tenantIdentityMatchesSite(ctx, args.tenantId, args.siteUrl)) {
			return { outcome: "routing_mismatch" as const };
		}
		const existing = await ctx.db.query("checkoutSnapshotReservations")
			.withIndex("by_siteUrl_and_handleHash", (q) => q.eq("siteUrl", args.siteUrl).eq("handleHash", args.handleHash)).unique();
		const accountScope = stripeAccountScope(args.stripeConnectedAccountId);
		if (existing) {
			const replayed = existing.snapshotDigest === args.snapshotDigest
				&& JSON.stringify(existing.snapshot) === JSON.stringify(args.snapshot)
				&& existing.accountScope === accountScope
				&& existing.stripeConnectedAccountId === args.stripeConnectedAccountId
				&& (args.tenantId === undefined || existing.tenantId === args.tenantId);
			return { outcome: replayed ? "replayed" as const : "conflict" as const };
		}
		assertOrderProducersOpen();
		await assertNewOrderAdmissionOpenIfActivated(ctx, args.siteUrl);
		const createdAt = Date.now();
		const unboundPurgeAt = createdAt + UNBOUND_RETENTION_MS;
		const reservationId = await ctx.db.insert("checkoutSnapshotReservations", {
			state: "reserved", tenantId: args.tenantId, siteUrl: args.siteUrl, handleHash: args.handleHash,
			snapshotDigest: args.snapshotDigest, snapshot: args.snapshot, accountScope,
			stripeConnectedAccountId: args.stripeConnectedAccountId,
			unboundPurgeAt, createdAt, updatedAt: createdAt,
		});
		await ctx.scheduler.runAt(unboundPurgeAt, internal.orders.purgeUnboundCheckoutSnapshot, {
			reservationId, createdAt, unboundPurgeAt,
		});
		return { outcome: "created" as const };
	},
});

export const bindCheckoutSnapshot = internalMutation({
	args: {
		tenantId: v.optional(v.string()), siteUrl: v.string(), handleHash: v.string(), stripeConnectedAccountId: v.optional(v.string()),
		stripeSessionId: v.string(), stripeExpiresAt: v.number(),
	},
	handler: async (ctx, args) => {
		if (
			(args.stripeConnectedAccountId !== undefined
				&& !isStripeConnectedAccountId(args.stripeConnectedAccountId))
			|| !isStripeCheckoutSessionId(args.stripeSessionId)
			|| !isBoundedStripeExpiration(args.stripeExpiresAt)
		) return { outcome: "invalid" as const };
		if (!await connectedAccountMatchesSite(ctx, args.siteUrl, args.stripeConnectedAccountId)) {
			return { outcome: "routing_mismatch" as const };
		}
		if (args.tenantId && !await tenantIdentityMatchesSite(ctx, args.tenantId, args.siteUrl)) {
			return { outcome: "routing_mismatch" as const };
		}
		const row = await ctx.db.query("checkoutSnapshotReservations")
			.withIndex("by_siteUrl_and_handleHash", (q) => q.eq("siteUrl", args.siteUrl).eq("handleHash", args.handleHash)).unique();
		if (!row) return { outcome: "not_found" as const };
		if (args.tenantId !== undefined && row.tenantId !== args.tenantId) {
			return { outcome: "conflict" as const };
		}
		const accountScope = stripeAccountScope(args.stripeConnectedAccountId);
		if (await retiredOrderSession(ctx, args.stripeSessionId)) {
			return { outcome: "conflict" as const };
		}
		const sessionOwner = await ctx.db.query("checkoutSnapshotReservations")
			.withIndex("by_accountScope_and_stripeSessionId", (q) => q.eq("accountScope", accountScope)
				.eq("stripeSessionId", args.stripeSessionId)).unique();
		if (sessionOwner && sessionOwner._id !== row._id) return { outcome: "conflict" as const };
		if (row.state === "bound") {
			const replayed = row.accountScope === accountScope
				&& row.stripeConnectedAccountId === args.stripeConnectedAccountId
				&& row.stripeSessionId === args.stripeSessionId && row.stripeExpiresAt === args.stripeExpiresAt;
			return { outcome: replayed ? "replayed" as const : "conflict" as const };
		}
		if (row.accountScope !== accountScope) return { outcome: "conflict" as const };
		assertOrderProducersOpen();
		await assertNewOrderAdmissionOpenIfActivated(ctx, args.siteUrl);
		const boundAt = Date.now();
		const boundReconcileAt = args.stripeExpiresAt * 1000 + PAID_SAFE_DELAY_MS;
		if (!Number.isSafeInteger(boundReconcileAt)) return { outcome: "invalid" as const };
		await ctx.db.patch(row._id, {
			state: "bound", stripeSessionId: args.stripeSessionId,
			stripeExpiresAt: args.stripeExpiresAt, boundAt, boundReconcileAt, updatedAt: boundAt,
			reconciliationAttempt: 0, reconciliationNextAt: boundReconcileAt,
		});
		await ctx.scheduler.runAt(boundReconcileAt, internal.stripeFees.reconcileCheckoutSnapshotReservation,
			{ reservationId: row._id, boundAt, attempt: 0 });
		return { outcome: "bound" as const };
	},
});

export const purgeUnboundCheckoutSnapshot = internalMutation({
	args: { reservationId: v.id("checkoutSnapshotReservations"), createdAt: v.number(), unboundPurgeAt: v.number() },
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.reservationId);
		if (!row || row.state !== "reserved" || row.createdAt !== args.createdAt
			|| row.unboundPurgeAt !== args.unboundPurgeAt || Date.now() < args.unboundPurgeAt) return false;
		await ctx.db.delete(row._id);
		return true;
	},
});

async function consumeReservation(
	ctx: MutationCtx, siteUrl: string, stripeSessionId: string,
	stripeConnectedAccountId: string | undefined, itemCount: number, candidate: unknown,
	checkoutSessionAdmissionId?: Id<"checkoutSessionAdmissions">,
) {
	const handle = parseReservationCandidate(candidate);
	if (!handle) throw new Error("Invalid checkout snapshot reservation");
	const handleHash = await reservationHandleHash(siteUrl, handle);
	const row = await ctx.db.query("checkoutSnapshotReservations")
		.withIndex("by_siteUrl_and_handleHash", (q) => q.eq("siteUrl", siteUrl).eq("handleHash", handleHash)).unique();
	if (!row || row.state !== "bound" || row.accountScope !== stripeAccountScope(stripeConnectedAccountId)
		|| row.stripeSessionId !== stripeSessionId || row.snapshot.items.length !== itemCount
		|| checkoutSessionAdmissionId !== undefined
			&& row.checkoutSessionAdmissionId !== checkoutSessionAdmissionId) {
		throw new Error("Checkout snapshot reservation does not match paid session");
	}
	await ctx.db.delete(row._id);
	return row.snapshot;
}

/** Private catalog commerce authority; reachable only through the authenticated HTTP route. */
export const catalogCommerce = internalQuery({
	args: { siteUrl: v.string(), request: catalogCommerceRequestValidator },
	handler: async (ctx, { siteUrl, request }) =>
		await resolveCatalogCommerce(ctx, siteUrl, request),
});
export const catalogCommerceHttp = internalQuery({
	args: { siteUrl: v.string(), request: catalogCommerceRequestValidator },
	handler: async (ctx, { siteUrl, request }) => {
		try {
			return { outcome: "resolved" as const, value: await resolveCatalogCommerce(ctx, siteUrl, request) };
		} catch (error) {
			const outcome = catalogCommerceResolutionErrorKind(error);
			if (!outcome) throw error;
			return { outcome };
		}
	},
});

export const getCheckoutSnapshotForReconciliation = internalQuery({
	args: { reservationId: v.id("checkoutSnapshotReservations"), boundAt: v.number(), attempt: v.number() },
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.reservationId);
		if (
			row?.state !== "bound"
			|| row.boundAt !== args.boundAt
			|| row.reconciliationAttempt !== args.attempt
			|| row.reconciliationAlertedAt !== undefined
			|| row.reconciliationNextAt === undefined
			|| Date.now() < row.reconciliationNextAt
			|| row.stripeSessionId === undefined
		) return null;
		if (await retiredOrderSession(ctx, row.stripeSessionId)) return null;
		return {
			stripeSessionId: row.stripeSessionId,
			stripeConnectedAccountId: row.stripeConnectedAccountId,
		};
	},
});

async function fencedBoundRow(
	ctx: MutationCtx, reservationId: Id<"checkoutSnapshotReservations">, boundAt: number, attempt: number,
) {
	const row = await ctx.db.get(reservationId);
	return row?.state === "bound" && row.boundAt === boundAt
		&& row.reconciliationAttempt === attempt && row.reconciliationAlertedAt === undefined ? row : null;
}

export const deleteExpiredUnpaidCheckoutSnapshot = internalMutation({
	args: { reservationId: v.id("checkoutSnapshotReservations"), boundAt: v.number(), attempt: v.number() },
	handler: async (ctx, args) => {
		const row = await fencedBoundRow(ctx, args.reservationId, args.boundAt, args.attempt);
		if (!row) return false;
		await ctx.db.delete(row._id);
		return true;
	},
});

export const retainCheckoutSnapshot = internalMutation({
	args: {
		reservationId: v.id("checkoutSnapshotReservations"), boundAt: v.number(),
		attempt: v.number(), paid: v.boolean(), providerSessionVerified: v.boolean(),
	},
	handler: async (ctx, args) => {
		const row = await fencedBoundRow(ctx, args.reservationId, args.boundAt, args.attempt);
		if (!row) return { alert: false };
		const verifiedAt = args.providerSessionVerified
			? row.reconciliationProviderVerifiedAt ?? Date.now()
			: row.reconciliationProviderVerifiedAt;
		const delay = args.paid ? undefined : RESERVATION_RETRY_DELAYS_MS[args.attempt];
		if (delay !== undefined) {
			const nextAt = Date.now() + delay;
			await ctx.db.patch(row._id, {
				reconciliationAttempt: args.attempt + 1, reconciliationNextAt: nextAt,
				reconciliationProviderVerifiedAt: verifiedAt,
			});
			await ctx.scheduler.runAt(nextAt, internal.stripeFees.reconcileCheckoutSnapshotReservation,
				{ reservationId: row._id, boundAt: args.boundAt, attempt: args.attempt + 1 });
			return { alert: false };
		}
		if (verifiedAt === undefined) {
			await ctx.db.delete(row._id);
			return { alert: false };
		}
		if (row.reconciliationAlertedAt !== undefined) return { alert: false };
		await ctx.db.patch(row._id, {
			reconciliationAttempt: args.attempt, reconciliationNextAt: undefined,
			reconciliationProviderVerifiedAt: verifiedAt, reconciliationAlertedAt: Date.now(),
		});
		return { alert: true };
	},
});

export const list = query({
	args: {
		siteUrl: v.string(),
		status: v.optional(orderStatusValidator),
	},
	handler: async (ctx, { siteUrl, status }) => {
		await requireSiteAdmin(ctx, siteUrl);
		if (status) {
			return await ctx.db
				.query("orders")
				.withIndex("by_siteUrl_status", (q) =>
					q.eq("siteUrl", siteUrl).eq("status", status),
				)
				.order("desc")
				.take(BULK_SCAN_LIMIT);
		}
		return await ctx.db
			.query("orders")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(BULK_SCAN_LIMIT);
	},
});

/**
 * Read one bounded tenant source and return only normalized target classes.
 * This query grants no provider, recovery, or mutation authority.
 */
export const classifyRefundTarget = query({
	args: {
		siteUrl: v.string(),
		target: v.object({
			orderNumber: v.string(),
			stripeSessionId: v.string(),
			stripePaymentIntentId: v.string(),
			stripeRefundId: v.string(),
		}),
	},
	returns: refundTargetClassificationValidator,
	handler: async (ctx, { siteUrl, target }) => {
		await requireSiteAdmin(ctx, siteUrl);
		if (
			target.orderNumber.length === 0
			|| target.orderNumber.length > 160
			|| !isStripeCheckoutSessionId(target.stripeSessionId)
			|| !STRIPE_PAYMENT_INTENT_ID.test(target.stripePaymentIntentId)
			|| !STRIPE_REFUND_ID.test(target.stripeRefundId)
		) throw new Error("Invalid refund target selectors");

		const rowsWithOverflowSentinel = await ctx.db
			.query("orders")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(BULK_SCAN_LIMIT + 1);
		return classifyRefundTargetRows(rowsWithOverflowSentinel, BULK_SCAN_LIMIT, target, null);
	},
});

/**
 * Create a new order. Called by the Stripe webhook (with `webhookSecret`) or
 * by admin tooling (with an authenticated session). Audit C4: the old
 * version accepted any caller; now requires either the shared webhook
 * secret or an authenticated admin.
 */
export const create = mutation({
	args: {
		siteUrl: v.string(),
		webhookSecret: v.optional(v.string()),
		orderNumber: v.optional(v.string()),
		stripeSessionId: v.string(),
		customerEmail: v.string(),
		customerName: v.optional(v.string()),
		stripePaymentIntentId: v.optional(v.string()),
		stripeConnectedAccountId: v.optional(v.string()),
		stripePaymentCurrency: v.optional(v.string()),
		stripePaymentLivemode: v.optional(v.boolean()),
		stripeSessionCreatedAt: v.optional(v.number()),
		stripeSessionExpiresAt: v.optional(v.number()),
		checkoutSnapshot: v.optional(checkoutSnapshotValidator),
		// Unknown by design: an existing paid order must win before a malformed V2 candidate is interpreted.
		checkoutSnapshotReservation: v.optional(v.any()),
		// Unknown by design: an existing paid order must win before a malformed
		// admission candidate is interpreted. Only authenticated webhook intake may
		// consume a provider-bound admission.
		checkoutSessionAdmission: v.optional(v.any()),
		shippingAddress: v.optional(
			v.object({
				line1: v.string(),
				line2: v.optional(v.string()),
				city: v.string(),
				state: v.string(),
				postalCode: v.string(),
				country: v.string(),
			}),
		),
		items: v.array(
			v.object({
				productName: v.string(),
				quantity: v.number(),
				price: v.number(),
			}),
		),
		total: v.number(),
		subtotal: v.optional(v.number()),
		stripeFees: v.optional(v.number()),
		fulfillmentType: v.union(
			v.literal("lumaprints"),
			v.literal("self"),
			v.literal("digital"),
		),
		paperName: v.optional(v.string()),
		paperSubcategoryId: v.optional(v.string()),
		couponCode: v.optional(v.string()),
		discountAmount: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const auth = await requireWebhookCallerOrAuth(ctx, args.webhookSecret);
		if (auth.via === "auth") {
			await requireSiteAdmin(ctx, args.siteUrl);
		}
		// Don't let either capability leak into the stored document.
		const {
			webhookSecret: _discard,
			checkoutSnapshotReservation,
			checkoutSessionAdmission,
			stripeSessionCreatedAt,
			stripeSessionExpiresAt,
			...rest
		} = args;
		// Idempotency: if an order with this stripeSessionId already exists,
		// return it along with fulfillment state so the caller can skip
		// already-completed side effects (LumaPrints submission, fee capture,
		// confirmation emails). Previously only `_id` and `orderNumber` were
		// returned, which caused retries to re-submit to LumaPrints and
		// re-email the customer. See audit C13.
		const existing = await ctx.db
			.query("orders")
			.withIndex("by_stripeSessionId", (q) =>
				q.eq("stripeSessionId", args.stripeSessionId),
			)
			.unique();
		const retired = await retiredOrderSession(ctx, args.stripeSessionId);
		if (retired && existing) routingConflict();
		if (retired) {
			if (retired.siteUrl !== args.siteUrl) routingConflict();
			if (retired.routingKind === "connected") {
				if (
					retired.stripeConnectedAccountId === undefined
					|| args.stripeConnectedAccountId !== retired.stripeConnectedAccountId
				) routingConflict();
			} else if (
				retired.stripeConnectedAccountId !== undefined
				|| args.stripeConnectedAccountId !== undefined
					&& !await connectedAccountMatchesSite(
						ctx, retired.siteUrl, args.stripeConnectedAccountId,
					)
			) routingConflict();
			throw new Error("Order session is retired");
		}
		if (existing) {
			if (existing.siteUrl !== args.siteUrl) routingConflict();
			if (existing.stripeConnectedAccountId !== undefined) {
				if (
					args.stripeConnectedAccountId !== existing.stripeConnectedAccountId
					|| !await connectedAccountMatchesSite(
						ctx, existing.siteUrl, existing.stripeConnectedAccountId,
					)
				) routingConflict();
			} else if (
				args.stripeConnectedAccountId !== undefined
				&& !await connectedAccountMatchesSite(
					ctx, existing.siteUrl, args.stripeConnectedAccountId,
				)
			) {
				// Legacy orders without a stored account may still replay when the
				// signed event account canonically belongs to the stored tenant.
				routingConflict();
			}
			return {
				_id: existing._id,
				orderNumber: existing.orderNumber,
				alreadyExisted: true as const,
				lumaprintsOrderNumber: existing.lumaprintsOrderNumber,
				status: existing.status,
				stripeFees: existing.stripeFees,
				stripeConnectedAccountId: existing.stripeConnectedAccountId,
				stripeFeeCaptureStatus: existing.stripeFeeCaptureStatus,
				stripeFeeCaptureAttempts: existing.stripeFeeCaptureAttempts,
				stripeFeeCaptureLastAttemptAt: existing.stripeFeeCaptureLastAttemptAt,
				stripeFeeCaptureNextAttemptAt: existing.stripeFeeCaptureNextAttemptAt,
				stripeFeeCaptureError: existing.stripeFeeCaptureError,
				fulfillmentError: existing.fulfillmentError,
				stripeRefundId: existing.stripeRefundId,
				fulfillmentRecoveryStatus: existing.fulfillmentRecoveryStatus,
				automatedRefundId: existing.automatedRefundId,
				automatedRefundStatus: existing.automatedRefundStatus,
				fulfillmentFailureNotificationProtocol:
					existing.fulfillmentFailureNotificationProtocol,
				printFulfillmentClaim: existing.printFulfillmentClaim,
				printFulfillmentPhase: existing.printFulfillmentPhase,
				printFulfillmentResolution: existing.printFulfillmentResolution,
				printFulfillmentReconciliationClass:
					existing.printFulfillmentReconciliationClass,
				printFulfillmentReconciliationEscalationReason:
					existing.printFulfillmentReconciliationEscalationReason,
				checkoutSnapshot: existing.checkoutSnapshot,
			};
		}

		assertOrderProducersOpen();
		if (
			args.stripeConnectedAccountId !== undefined
			&& !await connectedAccountMatchesSite(
				ctx, args.siteUrl, args.stripeConnectedAccountId,
			)
		) routingConflict();
		const refundIntent = await ctx.db.query("manualRefundIntents")
			.withIndex("by_accountScope_and_stripeSessionId", (q) => q
				.eq("accountScope", stripeAccountScope(args.stripeConnectedAccountId))
				.eq("stripeSessionId", args.stripeSessionId))
			.unique();
		if (refundIntent && (
			refundIntent.siteUrl !== args.siteUrl
			|| refundIntent.stripeConnectedAccountId !== args.stripeConnectedAccountId
			|| refundIntent.stripePaymentIntentId !== args.stripePaymentIntentId
			|| refundIntent.amount !== args.total
			|| refundIntent.stripeTenantMetadataSiteUrl !== undefined
					&& refundIntent.stripeTenantMetadataSiteUrl !== args.siteUrl
		)) routingConflict();
		const isManuallyRefunded = refundIntent !== null;
		const admissionControl = auth.via === "webhook"
			? await getDurablePurposeControl(ctx, args.siteUrl, "new_order_admission")
			: null;
		if (
			admissionControl?.state === "closed"
			&& !isManuallyRefunded
			&& checkoutSessionAdmission === undefined
			&& checkoutSnapshotReservation === undefined
			&& !await tokenlessPreProtocolCheckoutIsCompatible(ctx, {
				siteUrl: args.siteUrl,
				stripeConnectedAccountId: args.stripeConnectedAccountId,
				stripeSessionCreatedAt,
				stripeSessionExpiresAt,
			})
		) throw new Error("New order admission is closed");
		if (
			!isManuallyRefunded
			&& args.stripeFees !== undefined
			&& !isNonnegativeSafeInteger(args.stripeFees)
		) throw new Error("Stripe fees must be nonnegative safe-integer minor units");

		let admission = null;
		if (checkoutSessionAdmission !== undefined) {
			if (auth.via !== "webhook") {
				throw new Error("Checkout admission requires webhook authority");
			}
			admission = await consumeCheckoutSessionAdmission(ctx, {
				siteUrl: args.siteUrl,
				stripeConnectedAccountId: args.stripeConnectedAccountId,
				stripeSessionId: args.stripeSessionId,
				candidate: checkoutSessionAdmission,
			});
		}
		let orderInput = admission
			? {
					...rest,
					checkoutAdmissionProtocolVersion: 1 as const,
					checkoutAdmissionHostGeneration: admission.hostGeneration,
					checkoutAdmissionGeneration: admission.admissionGeneration,
					checkoutAdmissionHandleHash: admission.admissionHandleHash,
				}
			: rest;
		if (checkoutSnapshotReservation !== undefined) {
			if (rest.checkoutSnapshot !== undefined) throw new Error("Checkout snapshot input is ambiguous");
			const checkoutSnapshot = await consumeReservation(
				ctx, args.siteUrl, args.stripeSessionId, args.stripeConnectedAccountId,
				args.items.length, checkoutSnapshotReservation as unknown, admission?._id,
			);
			orderInput = {
				...orderInput,
				checkoutSnapshot,
				fulfillmentType: checkoutSnapshot.items.every(
					({ productKind }) => productKind === "digital_download",
				) ? "digital" : rest.fulfillmentType,
			};
		}

		let orderNumber: string;
		if (args.orderNumber === undefined) {
			orderNumber = await generateNextOrderNumber(ctx, args.siteUrl);
		} else {
			if (parseCanonicalOrderNumber(args.orderNumber) === null) {
				throw new Error("Invalid order number");
			}
			await assertOrderNumberAvailable(ctx, args.siteUrl, args.orderNumber);
			orderNumber = args.orderNumber;
		}

		const hasLegacyFeeInput = !isManuallyRefunded && orderInput.stripeFees !== undefined;
		const hasPaymentProjection = orderInput.stripePaymentIntentId !== undefined
			&& isStripeCurrency(orderInput.stripePaymentCurrency)
			&& orderInput.stripePaymentLivemode !== undefined
			&& isNonnegativeSafeInteger(orderInput.total);
		const providerFeeCaptureAuthorized = auth.via === "webhook"
			&& !isManuallyRefunded
			&& !hasLegacyFeeInput
			&& hasPaymentProjection;
		const feeCaptureScheduledAt = providerFeeCaptureAuthorized
			? Date.now() + FEE_CAPTURE_INITIAL_DELAY_MS
			: undefined;
		const feeCaptureStatus = isManuallyRefunded && orderInput.stripePaymentIntentId
				? "canceled" as const
			: hasLegacyFeeInput
				? "legacy_unverified" as const
				: providerFeeCaptureAuthorized
					? "pending" as const
					: auth.via === "webhook" && orderInput.stripePaymentIntentId
						? "failed" as const
						: undefined;
		const _id = await ctx.db.insert("orders", {
			...orderInput,
			stripeFees: isManuallyRefunded ? undefined : orderInput.stripeFees,
			orderNumber,
			status: isManuallyRefunded ? "refunded" : "new",
			stripeRefundId: refundIntent?.stripeRefundId,
			stripeFeeProvenance: hasLegacyFeeInput ? "legacy_unverified" : undefined,
			stripeFeeCaptureStatus: feeCaptureStatus,
			stripeFeeCaptureAttempts: providerFeeCaptureAuthorized ? 0 : undefined,
			stripeFeeCaptureNextAttemptAt: feeCaptureScheduledAt,
			stripeFeeCaptureError:
				feeCaptureStatus === "failed" ? "payment_projection_invalid" : undefined,
		});
		if (refundIntent) {
			await ctx.db.patch(refundIntent._id, { orderId: _id, consumedAt: Date.now() });
		}

		// Schedule Stripe fee capture off the webhook hot path (audit H5).
		// Stripe's balance_transaction isn't populated the instant
		// checkout.session.completed fires, so we wait 15s then fetch.
		// The action is idempotent and reschedules itself up to 3 times if
		// the fee still isn't available — see convex/stripeFees.ts.
		if (feeCaptureScheduledAt !== undefined) {
			await ctx.scheduler.runAfter(
				FEE_CAPTURE_INITIAL_DELAY_MS,
				internal.stripeFees.captureFeesForOrder,
				{ orderId: _id },
			);
		}

		return {
			_id,
			orderNumber,
			// Old webhook consumers already treat `alreadyExisted` refunded rows as
			// terminal and suppress fulfillment and notification side effects.
			alreadyExisted: isManuallyRefunded,
			lumaprintsOrderNumber: undefined,
			status: isManuallyRefunded ? ("refunded" as const) : ("new" as const),
			stripeFees: undefined,
			stripeFeeCaptureStatus: feeCaptureStatus,
			stripeFeeCaptureAttempts: providerFeeCaptureAuthorized ? 0 : undefined,
			stripeFeeCaptureLastAttemptAt: undefined,
			stripeFeeCaptureNextAttemptAt: feeCaptureScheduledAt,
			stripeFeeCaptureError:
				feeCaptureStatus === "failed" ? ("payment_projection_invalid" as const) : undefined,
			fulfillmentError: undefined,
			stripeRefundId: refundIntent?.stripeRefundId,
			fulfillmentRecoveryStatus: undefined,
			automatedRefundId: undefined,
			automatedRefundStatus: undefined,
			fulfillmentFailureNotificationProtocol: undefined,
			legacyAutomatedRefundNotificationsSuppressed: undefined,
			printFulfillmentClaim: undefined,
			printFulfillmentPhase: undefined,
			printFulfillmentResolution: undefined,
			printFulfillmentReconciliationClass: undefined,
			printFulfillmentReconciliationEscalationReason: undefined,
			checkoutSnapshot: orderInput.checkoutSnapshot,
		};
	},
});

/**
 * Stripe-webhook-only projection for one full, succeeded manual refund.
 * The signed hub handler verifies provider evidence before this transaction.
 */
export const reconcileSucceededManualRefund = mutation({
	args: {
		webhookSecret: v.string(),
		stripeEventId: v.string(),
		stripeRefundId: v.string(),
		stripeChargeId: v.string(),
		stripeSessionId: v.string(),
		stripePaymentIntentId: v.string(),
		stripeConnectedAccountId: v.optional(v.string()),
		stripeTenantMetadataSiteUrl: v.optional(v.string()),
		siteUrl: v.string(),
		refundAmount: v.number(),
		sessionAmountTotal: v.number(),
		refundCurrency: v.literal("usd"),
		sessionCurrency: v.literal("usd"),
		eventLivemode: v.boolean(),
		sessionLivemode: v.boolean(),
	},
	returns: manualRefundReconciliationResultValidator,
	handler: async (ctx, args): Promise<ManualRefundReconciliationResult> => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const validIdentity = STRIPE_EVENT_ID.test(args.stripeEventId)
			&& STRIPE_REFUND_ID.test(args.stripeRefundId)
			&& STRIPE_CHARGE_ID.test(args.stripeChargeId)
			&& STRIPE_PAYMENT_INTENT_ID.test(args.stripePaymentIntentId)
			&& isStripeCheckoutSessionId(args.stripeSessionId)
			&& (args.stripeConnectedAccountId === undefined
				|| isStripeConnectedAccountId(args.stripeConnectedAccountId))
			&& Number.isSafeInteger(args.refundAmount)
			&& args.refundAmount > 0
			&& args.refundAmount === args.sessionAmountTotal
			&& args.refundCurrency === args.sessionCurrency
			&& args.eventLivemode === args.sessionLivemode;
		if (!validIdentity) {
			return { kind: "rejected", reason: "identity_conflict" };
		}
		if (args.stripeConnectedAccountId !== undefined) {
			const clients = await ctx.db.query("platformClients")
				.withIndex("by_stripeConnectedAccountId", (q) => q
					.eq("stripeConnectedAccountId", args.stripeConnectedAccountId))
				.take(2);
			if (clients.length !== 1 || clients[0].siteUrl !== args.siteUrl) {
				return { kind: "rejected", reason: "identity_conflict" };
			}
		}

		const accountScope = stripeAccountScope(args.stripeConnectedAccountId);
		const refundIntents = await ctx.db.query("manualRefundIntents")
			.withIndex("by_stripeRefundId", (q) => q.eq("stripeRefundId", args.stripeRefundId))
			.take(2);
		const sessionIntents = await ctx.db.query("manualRefundIntents")
			.withIndex("by_accountScope_and_stripeSessionId", (q) => q
				.eq("accountScope", accountScope).eq("stripeSessionId", args.stripeSessionId))
			.take(2);
		if (refundIntents.length > 1 || sessionIntents.length > 1) {
			return { kind: "rejected", reason: "identity_conflict" };
		}
		const byRefund = refundIntents[0];
		const bySession = sessionIntents[0];
		if (byRefund && bySession && byRefund._id !== bySession._id) {
			return { kind: "rejected", reason: "identity_conflict" };
		}
		let intent: Doc<"manualRefundIntents"> | undefined = byRefund ?? bySession;
		if (intent && (
			intent.accountScope !== accountScope
			|| intent.siteUrl !== args.siteUrl
			|| intent.stripeRefundId !== args.stripeRefundId
			|| intent.stripeChargeId !== args.stripeChargeId
			|| intent.stripeSessionId !== args.stripeSessionId
			|| intent.stripePaymentIntentId !== args.stripePaymentIntentId
			|| intent.stripeConnectedAccountId !== args.stripeConnectedAccountId
			|| intent.stripeTenantMetadataSiteUrl !== args.stripeTenantMetadataSiteUrl
			|| intent.amount !== args.refundAmount
			|| intent.currency !== args.refundCurrency
			|| intent.livemode !== args.eventLivemode
		)) return { kind: "rejected", reason: "identity_conflict" };

		const matches = await ctx.db.query("orders")
			.withIndex("by_stripeSessionId", (q) => q.eq("stripeSessionId", args.stripeSessionId))
			.take(2);
		if (matches.length > 1) {
			return { kind: "rejected", reason: "identity_conflict" };
		}
		const order = matches[0];
		if (order && (
			order.siteUrl !== args.siteUrl
			|| args.stripeTenantMetadataSiteUrl !== undefined
				&& args.stripeTenantMetadataSiteUrl !== order.siteUrl
			|| order.total !== args.refundAmount
			|| order.stripePaymentIntentId !== undefined
				&& order.stripePaymentIntentId !== args.stripePaymentIntentId
		)) return { kind: "rejected", reason: "identity_conflict" };

		if (order?.stripeConnectedAccountId !== undefined) {
			if (
				args.stripeConnectedAccountId !== order.stripeConnectedAccountId
				|| !await connectedAccountMatchesSite(
					ctx, order.siteUrl, order.stripeConnectedAccountId,
				)
			) return { kind: "rejected", reason: "identity_conflict" };
		} else if (
			order
			&& args.stripeConnectedAccountId !== undefined
			&& !await connectedAccountMatchesSite(ctx, order.siteUrl, args.stripeConnectedAccountId)
		) return { kind: "rejected", reason: "identity_conflict" };
		const submissionIsUncertain = order ? hasUncertainPrintSubmission(order) : false;
		const legacyPrintClaimIsInFlight = order?.status === "new"
			&& order.lumaprintsOrderNumber === undefined
			&& order.stripeRefundId === undefined
			&& order.printFulfillmentClaim === true
			&& order.printFulfillmentCoordinatorVersion === undefined;
		const mayRefundAfterSubmissionFence = order?.printFulfillmentCoordinatorVersion === 3
			|| order?.printFulfillmentCoordinatorVersion === 4;
		const hasNoPrintSubmission = order !== undefined
			&& order.lumaprintsOrderNumber === undefined
			&& !order.printFulfillmentClaim
			&& order.printFulfillmentPhase === undefined
			&& order.printFulfillmentResolution === undefined;
		const hasResolvedPrintSubmission = order?.lumaprintsOrderNumber !== undefined
			&& LUMAPRINTS_ORDER_NUMBER.test(order.lumaprintsOrderNumber)
			&& !order.printFulfillmentClaim
			&& order.printFulfillmentPhase === undefined
			&& order.printFulfillmentResolution === "resolved";
		const isManualTerminal = order?.status === "refunded"
			&& order.stripeRefundId === args.stripeRefundId
			&& (hasNoPrintSubmission || submissionIsUncertain || hasResolvedPrintSubmission)
			&& order.fulfillmentError === undefined
			&& order.fulfillmentRecoveryStatus === undefined;
		const canTakeOverPendingRecovery = order?.status === "fulfillment_error"
			&& order.fulfillmentRecoveryStatus === "refund_pending"
			&& order.stripeRefundId === undefined
			&& order.lumaprintsOrderNumber === undefined
			&& !order.printFulfillmentClaim
			&& order.printFulfillmentResolution === undefined;
		const hasVersionedPreProviderPreparation = (
			order?.printFulfillmentCoordinatorVersion === 3
			|| order?.printFulfillmentCoordinatorVersion === 4
		)
			&& order.lumaprintsOrderNumber === undefined
			&& order.printFulfillmentClaim === true
			&& order.printFulfillmentPhase === "preparing"
			&& order.printFulfillmentResolution === undefined;
		const hasPreSubmissionPrintState = order?.lumaprintsOrderNumber === undefined
			&& order?.printFulfillmentResolution === undefined
			&& !order?.printFulfillmentClaim
			&& (
				order?.printFulfillmentPhase === undefined
					|| order.printFulfillmentPhase === "preparing"
			);
		const isRefundableNew = order?.status === "new"
			&& order.stripeRefundId === undefined
			&& order.fulfillmentError === undefined
			&& order.fulfillmentRecoveryStatus === undefined
			&& (
				hasPreSubmissionPrintState
				|| hasVersionedPreProviderPreparation
				|| submissionIsUncertain && mayRefundAfterSubmissionFence
				|| hasResolvedPrintSubmission
			);
		if (legacyPrintClaimIsInFlight) {
			return {
				kind: "retryable" as const,
				reason: "print_submission_in_flight" as const,
			};
		}
		if (submissionIsUncertain && !mayRefundAfterSubmissionFence) {
			return {
				kind: "retryable" as const,
				reason: "print_submission_in_flight" as const,
			};
		}

		if (!intent) {
			const intentId = await ctx.db.insert("manualRefundIntents", {
				accountScope,
				siteUrl: args.siteUrl,
				stripeEventId: args.stripeEventId,
				stripeRefundId: args.stripeRefundId,
				stripeChargeId: args.stripeChargeId,
				stripeSessionId: args.stripeSessionId,
				stripePaymentIntentId: args.stripePaymentIntentId,
				stripeConnectedAccountId: args.stripeConnectedAccountId,
				stripeTenantMetadataSiteUrl: args.stripeTenantMetadataSiteUrl,
				amount: args.refundAmount,
				currency: args.refundCurrency,
				livemode: args.eventLivemode,
				createdAt: Date.now(),
			});
			intent = await ctx.db.get(intentId) ?? undefined;
		}
		if (!intent) throw new Error("Manual refund intent was not stored");
		if (!order) return { kind: "pending_order" };

		if (isManualTerminal) {
			if (intent.orderId === undefined) {
				await ctx.db.patch(intent._id, { orderId: order._id, consumedAt: Date.now() });
			}
			return { kind: "replayed" };
		}
		if (!isRefundableNew && !canTakeOverPendingRecovery) {
			return { kind: "rejected", reason: "state_conflict" };
		}
		const cancelsFeeCapture = order.stripePaymentIntentId !== undefined
			&& order.stripeFees === undefined
			&& (
				order.stripeFeeCaptureStatus === undefined
				|| order.stripeFeeCaptureStatus === "pending"
			);

		await ctx.db.patch(order._id, {
			status: "refunded",
			stripeRefundId: args.stripeRefundId,
			fulfillmentError: undefined,
			fulfillmentRecoveryStatus: undefined,
			automatedRefundId: undefined,
			automatedRefundStatus: undefined,
			automatedRefundClaimedAt: undefined,
			automatedRefundClaimToken: undefined,
			automatedRefundLeaseExpiresAt: undefined,
			fulfillmentFailureNotificationProtocol: undefined,
			legacyAutomatedRefundNotificationsSuppressed: undefined,
			stripeFeeCaptureStatus: cancelsFeeCapture
				? "canceled"
				: order.stripeFeeCaptureStatus,
			stripeFeeCaptureNextAttemptAt: cancelsFeeCapture
				? undefined
				: order.stripeFeeCaptureNextAttemptAt,
			stripeFeeCaptureAttemptToken: cancelsFeeCapture
				? undefined
				: order.stripeFeeCaptureAttemptToken,
			stripeFeeCaptureError: cancelsFeeCapture
				? undefined
				: order.stripeFeeCaptureError,
			// A verified refund records payment truth. It does not erase an
			// irreversible provider fence or a result that already crossed it.
			...(submissionIsUncertain
				? {
						printFulfillmentResolution:
							order.printFulfillmentResolution === "reconciliation_blocked"
								? "reconciliation_blocked"
								: "submission_uncertain",
					}
				: hasResolvedPrintSubmission
					? {}
					: {
							printFulfillmentClaim: undefined,
							printFulfillmentClaimToken: undefined,
							printFulfillmentPhase: undefined,
							printFulfillmentClaimedAt: undefined,
							printFulfillmentLeaseExpiresAt: undefined,
							printFulfillmentResolution: undefined,
							printFulfillmentReconciliationClass: undefined,
							printFulfillmentReconciliationBlockedAt: undefined,
						}),
		});
		await ctx.db.patch(intent._id, { orderId: order._id, consumedAt: Date.now() });
		return { kind: "reconciled" };
	},
});

/** Server-only paid-download authority checked before any provider or file read. */
export const resolvePaidDownloadOrder = query({
	args: { stripeSessionId: v.string(), webhookSecret: v.string() },
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!isStripeCheckoutSessionId(args.stripeSessionId)) return null;
		const [order, retired] = await Promise.all([
			ctx.db.query("orders")
				.withIndex("by_stripeSessionId", (q) =>
					q.eq("stripeSessionId", args.stripeSessionId),
				)
				.unique(),
			retiredOrderSession(ctx, args.stripeSessionId),
		]);
		if (retired || !order) return null;
		return {
			checkoutSnapshot: order.checkoutSnapshot,
			refunded: order.status === "refunded" || order.stripeRefundId !== undefined
				|| order.fulfillmentRecoveryStatus === "refund_pending"
				|| order.fulfillmentRecoveryStatus === "refunded",
		};
	},
});

/** Webhook-only, session-first routing. No snapshot, digest, or handle crosses this projection. */
export const resolveCheckoutRouting = query({
	args: {
		stripeSessionId: v.string(),
		stripeConnectedAccountId: v.optional(v.string()),
		stripeTenantMetadataSiteUrl: v.optional(v.string()),
		webhookSecret: v.string(),
	},
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const order = await ctx.db.query("orders")
			.withIndex("by_stripeSessionId", (q) => q.eq("stripeSessionId", args.stripeSessionId)).unique();
		const retired = await retiredOrderSession(ctx, args.stripeSessionId);
		if (retired && order) routingConflict();
		if (retired) {
			if (retired.routingKind === "connected") {
				if (
					retired.stripeConnectedAccountId === undefined
					|| args.stripeConnectedAccountId !== retired.stripeConnectedAccountId
				) routingConflict();
			} else if (
				retired.stripeConnectedAccountId !== undefined
				|| args.stripeConnectedAccountId !== undefined
					&& !await connectedAccountMatchesSite(
						ctx, retired.siteUrl, args.stripeConnectedAccountId,
					)
			) routingConflict();
			if (
				args.stripeTenantMetadataSiteUrl !== undefined
				&& args.stripeTenantMetadataSiteUrl !== retired.siteUrl
			) routingConflict();
			return { source: "retired" as const, siteUrl: retired.siteUrl,
				stripeConnectedAccountId: retired.stripeConnectedAccountId };
		}
		if (order) {
			if (order.stripeConnectedAccountId !== undefined) {
				if (
					args.stripeConnectedAccountId !== order.stripeConnectedAccountId
					|| !await connectedAccountMatchesSite(
						ctx, order.siteUrl, order.stripeConnectedAccountId,
					)
				) routingConflict();
			} else if (
				args.stripeConnectedAccountId !== undefined
				&& !await connectedAccountMatchesSite(
					ctx, order.siteUrl, args.stripeConnectedAccountId,
				)
			) {
				// Explicit legacy fallback: old connected-account orders may not
				// carry the stored account, but the signed event account must still
				// resolve canonically to the order tenant.
				routingConflict();
			}
			if (
				args.stripeTenantMetadataSiteUrl !== undefined
				&& args.stripeTenantMetadataSiteUrl !== order.siteUrl
			) routingConflict();
			return { source: "order" as const, siteUrl: order.siteUrl,
				stripeConnectedAccountId: order.stripeConnectedAccountId };
		}
		const reservation = await ctx.db.query("checkoutSnapshotReservations")
			.withIndex("by_accountScope_and_stripeSessionId", (q) => q
				.eq("accountScope", stripeAccountScope(args.stripeConnectedAccountId))
				.eq("stripeSessionId", args.stripeSessionId)).unique();
		if (!reservation || reservation.state !== "bound") return null;
		if (args.stripeConnectedAccountId !== undefined) {
			if (
				reservation.stripeConnectedAccountId !== args.stripeConnectedAccountId
				|| !await connectedAccountMatchesSite(
					ctx, reservation.siteUrl, args.stripeConnectedAccountId,
				)
			) routingConflict();
		} else if (args.stripeTenantMetadataSiteUrl !== reservation.siteUrl) {
			// Platform-account sessions are tenant-routable only through the
			// marker stamped by the trusted Checkout creation response path.
			routingConflict();
		}
		if (
			args.stripeTenantMetadataSiteUrl !== undefined
			&& args.stripeTenantMetadataSiteUrl !== reservation.siteUrl
		) routingConflict();
		return { source: "reservation" as const, siteUrl: reservation.siteUrl,
			stripeConnectedAccountId: reservation.stripeConnectedAccountId };
	},
});

/**
 * Additive Unit-B routing fallback for universal Checkout admissions. Keeping
 * this separate preserves resolveCheckoutRouting's exact V2 return union for
 * already-deployed hosts and package consumers.
 */
export const resolveCheckoutAdmissionRouting = query({
	args: {
		stripeSessionId: v.string(),
		stripeConnectedAccountId: v.optional(v.string()),
		stripeTenantMetadataSiteUrl: v.optional(v.string()),
		webhookSecret: v.string(),
	},
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!isStripeCheckoutSessionId(args.stripeSessionId)) return null;
		const [order, retired, admission] = await Promise.all([
			ctx.db.query("orders")
				.withIndex("by_stripeSessionId", (q) => q.eq("stripeSessionId", args.stripeSessionId))
				.unique(),
			retiredOrderSession(ctx, args.stripeSessionId),
			ctx.db.query("checkoutSessionAdmissions")
				.withIndex("by_accountScope_and_stripeSessionId", (q) => q
					.eq("accountScope", stripeAccountScope(args.stripeConnectedAccountId))
					.eq("stripeSessionId", args.stripeSessionId))
				.unique(),
		]);
		if (order || retired || !admission || admission.state !== "bound") return null;
		if (
			admission.stripeConnectedAccountId !== args.stripeConnectedAccountId
			|| args.stripeTenantMetadataSiteUrl !== undefined
				&& args.stripeTenantMetadataSiteUrl !== admission.siteUrl
		) routingConflict();
		if (
			args.stripeConnectedAccountId !== undefined
			&& !await connectedAccountMatchesSite(
				ctx,
				admission.siteUrl,
				args.stripeConnectedAccountId,
			)
		) routingConflict();
		return {
			source: "admission" as const,
			siteUrl: admission.siteUrl,
			stripeConnectedAccountId: admission.stripeConnectedAccountId,
		};
	},
});

/** Legacy V1 claim retained for a safe Convex-first rollout. */
export const claimPrintFulfillment = mutation({
	args: { orderId: v.id("orders"), webhookSecret: v.string() },
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new Error("Order not found");
		if (order.lumaprintsOrderNumber)
			return { kind: "fulfilled" as const, orderNumber: order.lumaprintsOrderNumber };
		if (hasUncertainPrintSubmission(order)) {
			return order.printFulfillmentResolution === "reconciliation_blocked"
				? { kind: "busy" as const }
				: { kind: "reconcile" as const, externalId: order.stripeSessionId };
		}
		if (
			order.status === "refunded"
			&& order.stripeRefundId
			&& order.fulfillmentRecoveryStatus === undefined
		) return { kind: "busy" as const };
		if (order.status === "refunded" || order.stripeRefundId)
			return { kind: "refunded" as const, stripeRefundId: order.stripeRefundId };
		if (order.fulfillmentRecoveryStatus) return { kind: "busy" as const };
		// A versioned stamp survives preparation-lease release. Do not let a
		// legacy host subsequently cross the POST fence under newer semantics.
		if (order.printFulfillmentCoordinatorVersion !== undefined) return { kind: "busy" as const };
		await ctx.db.patch(args.orderId, {
			printFulfillmentClaim: true,
			printFulfillmentResolution: "submission_uncertain",
		});
		return { kind: "claimed" as const, externalId: order.stripeSessionId };
	},
});

/** Tokenized preparation lease used by the V2 fulfillment coordinator. */
export const claimPrintFulfillmentV2 = mutation({
	args: {
		orderId: v.id("orders"),
		claimToken: v.string(),
		webhookSecret: v.string(),
	},
	returns: v.union(
		v.object({ kind: v.literal("fulfilled"), orderNumber: v.string() }),
		v.object({ kind: v.literal("reconcile"), externalId: v.string() }),
		v.object({ kind: v.literal("manual_refunded"), stripeRefundId: v.string() }),
		v.object({ kind: v.literal("automated_refunded"), stripeRefundId: v.string() }),
		v.object({ kind: v.literal("busy") }),
		v.object({ kind: v.literal("preparing") }),
		v.object({
			kind: v.literal("claimed"),
			externalId: v.string(),
			leaseExpiresAt: v.number(),
		}),
	),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid print claim token");
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new Error("Order not found");
		if (order.lumaprintsOrderNumber)
			return { kind: "fulfilled" as const, orderNumber: order.lumaprintsOrderNumber };
		if (hasUncertainPrintSubmission(order)) {
			if (order.printFulfillmentResolution === "reconciliation_blocked") {
				return { kind: "busy" as const };
			}
			return { kind: "reconcile" as const, externalId: order.stripeSessionId };
		}
		if (
			order.status === "refunded"
			&& order.stripeRefundId
			&& order.fulfillmentRecoveryStatus === undefined
		) {
			return { kind: "manual_refunded" as const, stripeRefundId: order.stripeRefundId };
		}
		if (order.stripeRefundId) {
			return { kind: "automated_refunded" as const, stripeRefundId: order.stripeRefundId };
		}
		if (order.fulfillmentRecoveryStatus || order.status !== "new") {
			return { kind: "busy" as const };
		}
		// Preserve the V2 return union while refusing ownership of a row that a
		// newer coordinator already marked durably.
		if (order.printFulfillmentCoordinatorVersion !== undefined) {
			return { kind: "busy" as const };
		}
		const now = Date.now();
		if (order.printFulfillmentClaim) {
			if (order.printFulfillmentPhase !== "preparing") {
				return { kind: "reconcile" as const, externalId: order.stripeSessionId };
			}
			if (
				order.printFulfillmentLeaseExpiresAt !== undefined
				&& order.printFulfillmentLeaseExpiresAt > now
			) return { kind: "preparing" as const };
		}
		const leaseExpiresAt = now + PRINT_PREPARATION_LEASE_MS;
		await ctx.db.patch(args.orderId, {
			printFulfillmentClaim: true,
			printFulfillmentClaimToken: args.claimToken,
			printFulfillmentPhase: "preparing",
			printFulfillmentClaimedAt: now,
			printFulfillmentLeaseExpiresAt: leaseExpiresAt,
			printFulfillmentResolution: undefined,
			printFulfillmentReconciliationClass: undefined,
			printFulfillmentReconciliationBlockedAt: undefined,
		});
		return {
			kind: "claimed" as const,
			externalId: order.stripeSessionId,
			leaseExpiresAt,
		};
	},
});

/**
 * Versioned coordinator claim. Its return value may evolve independently while
 * V2 remains byte-compatible for already-deployed hosts.
 */
export const claimPrintFulfillmentV3 = mutation({
	args: {
		orderId: v.id("orders"),
		claimToken: v.string(),
		webhookSecret: v.string(),
	},
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid print claim token");
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new Error("Order not found");
		if (order.lumaprintsOrderNumber) {
			return { kind: "fulfilled" as const, orderNumber: order.lumaprintsOrderNumber };
		}
		if (hasUncertainPrintSubmission(order)) {
			if (order.printFulfillmentResolution === "reconciliation_blocked") {
				return {
					kind: "reconciliation_blocked" as const,
					reconciliationClass:
						order.printFulfillmentReconciliationClass ?? "client_error",
					...(order.printFulfillmentReconciliationEscalationReason === undefined
						? {}
						: {
								escalationReason:
									order.printFulfillmentReconciliationEscalationReason,
							}),
				};
			}
			return { kind: "reconcile" as const, externalId: order.stripeSessionId };
		}
		if (
			order.status === "refunded"
			&& order.stripeRefundId
			&& order.fulfillmentRecoveryStatus === undefined
		) {
			return { kind: "manual_refunded" as const, stripeRefundId: order.stripeRefundId };
		}
		if (order.stripeRefundId) {
			return { kind: "automated_refunded" as const, stripeRefundId: order.stripeRefundId };
		}
		if (order.fulfillmentRecoveryStatus || order.status !== "new") {
			return { kind: "busy" as const };
		}
		// A legacy V3 caller must never take over an admitted V4 obligation after
		// its transient preparation lease is released or expires.
		if (order.printFulfillmentCoordinatorVersion === 4) {
			return { kind: "busy" as const };
		}
		const now = Date.now();
		if (order.printFulfillmentClaim) {
			if (order.printFulfillmentPhase !== "preparing") {
				return { kind: "reconcile" as const, externalId: order.stripeSessionId };
			}
			if (
				order.printFulfillmentLeaseExpiresAt !== undefined
				&& order.printFulfillmentLeaseExpiresAt > now
			) return { kind: "preparing" as const };
		}
		const leaseExpiresAt = now + PRINT_PREPARATION_LEASE_MS;
		await ctx.db.patch(args.orderId, {
			printFulfillmentClaim: true,
			printFulfillmentClaimToken: args.claimToken,
			printFulfillmentPhase: "preparing",
			printFulfillmentClaimedAt: now,
			printFulfillmentLeaseExpiresAt: leaseExpiresAt,
			printFulfillmentCoordinatorVersion: 3,
			printFulfillmentResolution: undefined,
			printFulfillmentReconciliationClass: undefined,
			printFulfillmentReconciliationBlockedAt: undefined,
			printFulfillmentReconciliationPendingFirstAt: undefined,
			printFulfillmentReconciliationPendingAttempts: undefined,
			printFulfillmentReconciliationLastAttemptAt: undefined,
			printFulfillmentReconciliationLastAttemptClass: undefined,
			printFulfillmentReconciliationPendingClassCounts: undefined,
			printFulfillmentReconciliationEscalationReason: undefined,
		});
		return {
			kind: "claimed" as const,
			externalId: order.stripeSessionId,
			leaseExpiresAt,
		};
	},
});

/**
 * Additive R4 coordinator. Durable provider admission is separate from the
 * transient preparation lease; a closed control cannot revoke an admitted row.
 */
export const claimPrintFulfillmentV4 = mutation({
	args: {
		orderId: v.id("orders"),
		claimToken: v.string(),
		webhookSecret: v.string(),
	},
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid print claim token");
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new Error("Order not found");
		if (order.lumaprintsOrderNumber) {
			return { kind: "fulfilled" as const, orderNumber: order.lumaprintsOrderNumber };
		}
		if (hasUncertainPrintSubmission(order)) {
			if (order.printFulfillmentResolution === "reconciliation_blocked") {
				return {
					kind: "reconciliation_blocked" as const,
					reconciliationClass:
						order.printFulfillmentReconciliationClass ?? "client_error",
					...(order.printFulfillmentReconciliationEscalationReason === undefined
						? {}
						: { escalationReason: order.printFulfillmentReconciliationEscalationReason }),
				};
			}
			return { kind: "reconcile" as const, externalId: order.stripeSessionId };
		}
		if (
			order.status === "refunded"
			&& order.stripeRefundId
			&& order.fulfillmentRecoveryStatus === undefined
		) return { kind: "manual_refunded" as const, stripeRefundId: order.stripeRefundId };
		if (order.stripeRefundId) {
			return { kind: "automated_refunded" as const, stripeRefundId: order.stripeRefundId };
		}
		if (
			order.fulfillmentRecoveryStatus
			|| order.status !== "new"
			|| order.fulfillmentType !== "lumaprints"
		) return { kind: "busy" as const };

		const now = Date.now();
		const alreadyAdmitted = order.printFulfillmentCoordinatorVersion === 4
			&& order.printProviderAdmissionStatus === "admitted"
			&& Number.isSafeInteger(order.printProviderAdmissionGeneration)
			&& Number.isSafeInteger(order.printProviderAdmissionAt);
		const hasProviderAdmissionFragment = order.printProviderAdmissionStatus !== undefined
			|| order.printProviderAdmissionGeneration !== undefined
			|| order.printProviderAdmissionAt !== undefined;
		if (hasProviderAdmissionFragment && !alreadyAdmitted) {
			return { kind: "busy" as const };
		}
		if (order.printFulfillmentClaim) {
			if (order.printFulfillmentPhase !== "preparing") {
				return { kind: "reconcile" as const, externalId: order.stripeSessionId };
			}
			if (
				order.printFulfillmentLeaseExpiresAt !== undefined
				&& order.printFulfillmentLeaseExpiresAt > now
			) return { kind: "preparing" as const };
		}

		let providerGeneration = order.printProviderAdmissionGeneration;
		if (!alreadyAdmitted) {
			if (order.printFulfillmentCoordinatorVersion !== undefined) {
				return { kind: "busy" as const };
			}
			const control = await getDurablePurposeControl(
				ctx,
				order.siteUrl,
				"new_provider_submission",
			);
			if (!control || control.state !== "open") {
				return { kind: "submission_closed" as const };
			}
			providerGeneration = control.generation;
		}

		const leaseExpiresAt = now + PRINT_PREPARATION_LEASE_MS;
		await ctx.db.patch(order._id, {
			printFulfillmentClaim: true,
			printFulfillmentClaimToken: args.claimToken,
			printFulfillmentPhase: "preparing",
			printFulfillmentClaimedAt: now,
			printFulfillmentLeaseExpiresAt: leaseExpiresAt,
			printFulfillmentCoordinatorVersion: 4,
			printProviderAdmissionStatus: "admitted",
			printProviderAdmissionGeneration: providerGeneration,
			printProviderAdmissionAt: order.printProviderAdmissionAt ?? now,
			printFulfillmentResolution: undefined,
			printFulfillmentReconciliationClass: undefined,
			printFulfillmentReconciliationBlockedAt: undefined,
			printFulfillmentReconciliationPendingFirstAt: undefined,
			printFulfillmentReconciliationPendingAttempts: undefined,
			printFulfillmentReconciliationLastAttemptAt: undefined,
			printFulfillmentReconciliationLastAttemptClass: undefined,
			printFulfillmentReconciliationPendingClassCounts: undefined,
			printFulfillmentReconciliationEscalationReason: undefined,
		});
		await ctx.scheduler.runAt(
			leaseExpiresAt,
			internal.orders.expirePrintFulfillmentPreparationV4,
			{ orderId: order._id, claimToken: args.claimToken, leaseExpiresAt },
		);
		return {
			kind: "claimed" as const,
			externalId: order.stripeSessionId,
			leaseExpiresAt,
			providerGeneration,
		};
	},
});

export const expirePrintFulfillmentPreparationV4 = internalMutation({
	args: {
		orderId: v.id("orders"),
		claimToken: v.string(),
		leaseExpiresAt: v.number(),
	},
	handler: async (ctx, args) => {
		const order = await ctx.db.get(args.orderId);
		if (
			!order
			|| order.printFulfillmentCoordinatorVersion !== 4
			|| order.printProviderAdmissionStatus !== "admitted"
			|| order.printFulfillmentPhase !== "preparing"
			|| order.printFulfillmentClaimToken !== args.claimToken
			|| order.printFulfillmentLeaseExpiresAt !== args.leaseExpiresAt
			|| Date.now() < args.leaseExpiresAt
		) return false;
		await ctx.db.patch(order._id, {
			printFulfillmentClaim: undefined,
			printFulfillmentClaimToken: undefined,
			printFulfillmentPhase: undefined,
			printFulfillmentClaimedAt: undefined,
			printFulfillmentLeaseExpiresAt: undefined,
		});
		return true;
	},
});

/** Release only the caller's pre-submission preparation lease. */
export const releasePrintFulfillmentClaim = mutation({
	args: { orderId: v.id("orders"), claimToken: v.string(), webhookSecret: v.string() },
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const order = await ctx.db.get(args.orderId);
		if (
			!order
			|| order.status !== "new"
			|| !order.printFulfillmentClaim
			|| order.printFulfillmentPhase !== "preparing"
			|| order.printFulfillmentClaimToken !== args.claimToken
			|| order.lumaprintsOrderNumber !== undefined
			|| order.stripeRefundId !== undefined
			|| order.fulfillmentRecoveryStatus !== undefined
		) return false;
		await ctx.db.patch(order._id, {
			printFulfillmentClaim: undefined,
			printFulfillmentClaimToken: undefined,
			printFulfillmentPhase: undefined,
			printFulfillmentClaimedAt: undefined,
			printFulfillmentLeaseExpiresAt: undefined,
			printFulfillmentResolution: undefined,
			printFulfillmentReconciliationClass: undefined,
			printFulfillmentReconciliationBlockedAt: undefined,
			printFulfillmentReconciliationPendingFirstAt: undefined,
			printFulfillmentReconciliationPendingAttempts: undefined,
			printFulfillmentReconciliationLastAttemptAt: undefined,
			printFulfillmentReconciliationLastAttemptClass: undefined,
			printFulfillmentReconciliationPendingClassCounts: undefined,
			printFulfillmentReconciliationEscalationReason: undefined,
		});
		return true;
	},
});

/** Atomically fence the irreversible provider POST after local preparation. */
export const beginPrintFulfillmentSubmission = mutation({
	args: { orderId: v.id("orders"), claimToken: v.string(), webhookSecret: v.string() },
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new Error("Order not found");
		if (
			order.status === "refunded"
			&& order.stripeRefundId
			&& order.fulfillmentRecoveryStatus === undefined
		) {
			return { kind: "manual_refunded" as const, stripeRefundId: order.stripeRefundId };
		}
		if (order.stripeRefundId) {
			return { kind: "automated_refunded" as const, stripeRefundId: order.stripeRefundId };
		}
		if (
			order.status !== "new"
			|| order.printFulfillmentPhase !== "preparing"
			|| order.printFulfillmentClaimToken !== args.claimToken
			|| order.printFulfillmentLeaseExpiresAt === undefined
			|| order.printFulfillmentLeaseExpiresAt <= Date.now()
		) return { kind: "lost" as const };
		if (
			order.printFulfillmentCoordinatorVersion === 4
			&& (
				order.printProviderAdmissionStatus !== "admitted"
				|| order.printProviderAdmissionGeneration === undefined
			)
		) return { kind: "lost" as const };
		await ctx.db.patch(order._id, {
			printFulfillmentPhase: "submitting",
			printFulfillmentLeaseExpiresAt: undefined,
			printFulfillmentResolution: "submission_uncertain",
			printFulfillmentReconciliationClass: undefined,
			printFulfillmentReconciliationBlockedAt: undefined,
		});
		return { kind: "submitting" as const, externalId: order.stripeSessionId };
	},
});

/** Store the exact fenced POST result, even when a refund committed first. */
export const completePrintFulfillmentSubmission = mutation({
	args: {
		orderId: v.id("orders"),
		claimToken: v.string(),
		externalId: v.string(),
		lumaprintsOrderNumber: v.string(),
		webhookSecret: v.string(),
	},
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid print claim token");
		if (
			!isStripeCheckoutSessionId(args.externalId)
			|| !LUMAPRINTS_ORDER_NUMBER.test(args.lumaprintsOrderNumber)
		) throw new Error("Invalid print fulfillment result");
		const order = await ctx.db.get(args.orderId);
		if (!order || order.stripeSessionId !== args.externalId) {
			throw new Error("Print fulfillment identity does not match order");
		}
		if (order.lumaprintsOrderNumber !== undefined) {
			if (
				order.lumaprintsOrderNumber !== args.lumaprintsOrderNumber
				|| order.printFulfillmentResolution !== "resolved"
			) throw new Error("Print fulfillment result conflicts");
			return printFulfillmentCompletionOutcome(order);
		}
		if (
			!hasUncertainPrintSubmission(order)
			|| order.printFulfillmentPhase !== "submitting"
			|| order.printFulfillmentClaimToken !== args.claimToken
		) throw new Error("Print fulfillment submission claim is unavailable");
		return await attachPrintFulfillmentResult(ctx, order, args.lumaprintsOrderNumber);
	},
});

/**
 * Resolve a fenced POST that the provider definitely rejected. The exact
 * submission token is required so only the process that crossed the POST
 * fence can clear it. The refund checkpoint commits in the same transaction,
 * preventing a crash from making a later delivery replay the provider POST.
 */
export const rejectPrintFulfillmentSubmission = mutation({
	args: {
		orderId: v.id("orders"),
		claimToken: v.string(),
		externalId: v.string(),
		webhookSecret: v.string(),
	},
	returns: v.union(
		v.object({ kind: v.literal("refund_pending") }),
		v.object({ kind: v.literal("manual_refunded"), stripeRefundId: v.string() }),
		v.object({ kind: v.literal("automated_refunded"), stripeRefundId: v.string() }),
	),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid print claim token");
		if (!isStripeCheckoutSessionId(args.externalId)) {
			throw new Error("Invalid print fulfillment identity");
		}
		const order = await ctx.db.get(args.orderId);
		if (!order || order.stripeSessionId !== args.externalId) {
			throw new Error("Print fulfillment identity does not match order");
		}
		if (
			order.lumaprintsOrderNumber !== undefined
			|| !hasUncertainPrintSubmission(order)
			|| order.printFulfillmentPhase !== "submitting"
			|| order.printFulfillmentClaimToken !== args.claimToken
		) throw new Error("Print fulfillment submission claim is unavailable");

		const clearFence = {
			printFulfillmentClaim: undefined,
			printFulfillmentClaimToken: undefined,
			printFulfillmentPhase: undefined,
			printFulfillmentClaimedAt: undefined,
			printFulfillmentLeaseExpiresAt: undefined,
			printFulfillmentResolution: undefined,
			printFulfillmentReconciliationClass: undefined,
			printFulfillmentReconciliationBlockedAt: undefined,
		};
		if (
			order.status === "refunded"
			&& order.stripeRefundId
			&& order.fulfillmentRecoveryStatus === undefined
		) {
			await ctx.db.patch(order._id, clearFence);
			return { kind: "manual_refunded" as const, stripeRefundId: order.stripeRefundId };
		}
		if (order.stripeRefundId) {
			await ctx.db.patch(order._id, clearFence);
			return { kind: "automated_refunded" as const, stripeRefundId: order.stripeRefundId };
		}
		if (
			order.status !== "new"
			|| order.fulfillmentRecoveryStatus !== undefined
			|| order.fulfillmentError !== undefined
		) throw new Error("Print fulfillment rejection transition is unavailable");
		await ctx.db.patch(order._id, {
			...clearFence,
			status: "fulfillment_error",
			fulfillmentError: "Print provider rejected fulfillment",
			fulfillmentRecoveryStatus: "refund_pending",
			automatedRefundPreRequestProtocol: "print_rejection_v1",
		});
		return { kind: "refund_pending" as const };
	},
});

/** Attach a GET-verified result to one durable uncertain submission fence. */
export const reconcilePrintFulfillmentSubmission = mutation({
	args: {
		orderId: v.id("orders"),
		externalId: v.string(),
		lumaprintsOrderNumber: v.string(),
		webhookSecret: v.string(),
	},
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (
			!isStripeCheckoutSessionId(args.externalId)
			|| !LUMAPRINTS_ORDER_NUMBER.test(args.lumaprintsOrderNumber)
		) throw new Error("Invalid print reconciliation result");
		const order = await ctx.db.get(args.orderId);
		if (!order || order.stripeSessionId !== args.externalId) {
			throw new Error("Print fulfillment identity does not match order");
		}
		if (order.lumaprintsOrderNumber !== undefined) {
			if (
				order.lumaprintsOrderNumber !== args.lumaprintsOrderNumber
				|| order.printFulfillmentResolution !== "resolved"
			) throw new Error("Print fulfillment result conflicts");
			return printFulfillmentCompletionOutcome(order);
		}
		if (!hasUncertainPrintSubmission(order)) {
			throw new Error("Print fulfillment reconciliation claim is unavailable");
		}
		return await attachPrintFulfillmentResult(ctx, order, args.lumaprintsOrderNumber);
	},
});

/**
 * Record one inconclusive V3 GET result. Repeated absence or resource-bound
 * reads eventually become operator-blocked without asserting that the provider
 * order does not exist, clearing the POST fence, or authorizing a refund.
 */
export const recordPrintFulfillmentReconciliationPending = mutation({
	args: {
		orderId: v.id("orders"),
		externalId: v.string(),
		reason: printFulfillmentInconclusiveClassValidator,
		webhookSecret: v.string(),
	},
	returns: v.union(
		v.object({ kind: v.literal("pending"), attempts: v.number() }),
		v.object({
			kind: v.literal("reconciliation_blocked"),
			reconciliationClass: v.literal("client_error"),
			escalationReason: v.optional(printFulfillmentInconclusiveClassValidator),
		}),
	),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!isStripeCheckoutSessionId(args.externalId)) {
			throw new Error("Invalid print reconciliation identity");
		}
		const order = await ctx.db.get(args.orderId);
		if (!order || order.stripeSessionId !== args.externalId) {
			throw new Error("Print fulfillment identity does not match order");
		}
		if (order.lumaprintsOrderNumber !== undefined || !hasUncertainPrintSubmission(order)) {
			throw new Error("Print fulfillment reconciliation claim is unavailable");
		}
		if (order.printFulfillmentResolution === "reconciliation_blocked") {
			return {
				kind: "reconciliation_blocked" as const,
				reconciliationClass: "client_error" as const,
				...(order.printFulfillmentReconciliationEscalationReason === undefined
					? {}
					: {
							escalationReason:
								order.printFulfillmentReconciliationEscalationReason,
						}),
			};
		}
		const now = Date.now();
		const firstAt = order.printFulfillmentReconciliationPendingFirstAt ?? now;
		const attempts = (order.printFulfillmentReconciliationPendingAttempts ?? 0) + 1;
		const classCounts = order.printFulfillmentReconciliationPendingClassCounts ?? {
			transport: 0,
			rate_or_server: 0,
			resource_bound: 0,
			client_exception: 0,
			result_not_observed: 0,
		};
		const nextClassCounts = {
			...classCounts,
			[args.reason]: classCounts[args.reason] + 1,
		};
		const shouldBlock = attempts >= PRINT_RECONCILIATION_PENDING_MAX_ATTEMPTS
			|| now - firstAt >= PRINT_RECONCILIATION_PENDING_MAX_AGE_MS;
		await ctx.db.patch(order._id, {
			printFulfillmentReconciliationPendingFirstAt: firstAt,
			printFulfillmentReconciliationPendingAttempts: attempts,
			printFulfillmentReconciliationLastAttemptAt: now,
			printFulfillmentReconciliationLastAttemptClass: args.reason,
			printFulfillmentReconciliationPendingClassCounts: nextClassCounts,
			...(shouldBlock
				? {
						printFulfillmentResolution: "reconciliation_blocked" as const,
						printFulfillmentReconciliationClass: "client_error" as const,
						printFulfillmentReconciliationBlockedAt: now,
						printFulfillmentReconciliationEscalationReason: args.reason,
						printFulfillmentReconciliationAlertRetryProtocol: "bounded_23h_v1" as const,
					}
				: {}),
		});
		return shouldBlock
			? {
					kind: "reconciliation_blocked" as const,
					reconciliationClass: "client_error" as const,
					escalationReason: args.reason,
				}
			: { kind: "pending" as const, attempts };
	},
});

/** Stop automatic GET retries after a deterministic reconciliation failure. */
export const blockPrintFulfillmentReconciliation = mutation({
	args: {
		orderId: v.id("orders"),
		externalId: v.string(),
		reconciliationClass: printFulfillmentReconciliationClassValidator,
		webhookSecret: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!isStripeCheckoutSessionId(args.externalId)) {
			throw new Error("Invalid print reconciliation identity");
		}
		const order = await ctx.db.get(args.orderId);
		if (!order || order.stripeSessionId !== args.externalId) {
			throw new Error("Print fulfillment identity does not match order");
		}
		if (order.lumaprintsOrderNumber !== undefined) return false;
		if (!hasUncertainPrintSubmission(order)) {
			throw new Error("Print fulfillment reconciliation claim is unavailable");
		}
		// First deterministic block wins. Keeping its class stable prevents a
		// retry with a different classification from describing a later alert
		// differently from the alert that was actually authorized.
		if (order.printFulfillmentResolution === "reconciliation_blocked") return false;
		await ctx.db.patch(order._id, {
			printFulfillmentResolution: "reconciliation_blocked",
			printFulfillmentReconciliationClass: args.reconciliationClass,
			printFulfillmentReconciliationBlockedAt: Date.now(),
			printFulfillmentReconciliationEscalationReason: undefined,
			printFulfillmentReconciliationAlertRetryProtocol: "bounded_23h_v1",
		});
		return true;
	},
});

/** Lease one operator alert for a durably blocked provider reconciliation. */
export const claimPrintFulfillmentReconciliationAlert = mutation({
	args: {
		orderId: v.id("orders"),
		externalId: v.string(),
		claimToken: v.string(),
		webhookSecret: v.string(),
	},
	returns: v.union(
		v.object({ kind: v.literal("claimed") }),
		v.object({ kind: v.literal("busy"), leaseExpiresAt: v.number() }),
		v.object({ kind: v.literal("unavailable") }),
	),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!isStripeCheckoutSessionId(args.externalId)) {
			throw new Error("Invalid print reconciliation identity");
		}
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid alert claim token");
		const order = await ctx.db.get(args.orderId);
		if (!order || order.stripeSessionId !== args.externalId) {
			throw new Error("Print fulfillment identity does not match order");
		}
		if (
			order.lumaprintsOrderNumber !== undefined
			|| !hasUncertainPrintSubmission(order)
			|| order.printFulfillmentResolution !== "reconciliation_blocked"
			|| order.printFulfillmentReconciliationAlertSentAt !== undefined
		) return { kind: "unavailable" as const };
		const firstAttemptAt = order.printFulfillmentReconciliationAlertClaimedAt;
		if (order.printFulfillmentReconciliationAlertDeliveryUncertainAt !== undefined) {
			return { kind: "unavailable" as const };
		}
		const now = Date.now();
		if (
			order.printFulfillmentReconciliationAlertClaimToken !== undefined
			&& order.printFulfillmentReconciliationAlertLeaseExpiresAt !== undefined
			&& order.printFulfillmentReconciliationAlertLeaseExpiresAt > now
		) {
			return {
				kind: "busy" as const,
				leaseExpiresAt: order.printFulfillmentReconciliationAlertLeaseExpiresAt,
			};
		}
		if (order.printFulfillmentReconciliationAlertRetryProtocol !== "bounded_23h_v1") {
			await ctx.db.patch(order._id, {
				printFulfillmentReconciliationAlertClaimToken: undefined,
				printFulfillmentReconciliationAlertLeaseExpiresAt: undefined,
				printFulfillmentReconciliationAlertDeliveryUncertainAt: now,
			});
			return { kind: "unavailable" as const };
		}
		if (firstAttemptAt !== undefined && now - firstAttemptAt >= EMAIL_AUTOMATIC_RETRY_WINDOW_MS) {
			await ctx.db.patch(order._id, {
				printFulfillmentReconciliationAlertClaimToken: undefined,
				printFulfillmentReconciliationAlertLeaseExpiresAt: undefined,
				printFulfillmentReconciliationAlertDeliveryUncertainAt: now,
			});
			return { kind: "unavailable" as const };
		}
		await ctx.db.patch(order._id, {
			printFulfillmentReconciliationAlertClaimedAt: firstAttemptAt ?? now,
			printFulfillmentReconciliationAlertClaimToken: args.claimToken,
			printFulfillmentReconciliationAlertLeaseExpiresAt:
				now + PRINT_RECONCILIATION_ALERT_LEASE_MS,
		});
		return { kind: "claimed" as const };
	},
});

/** Read reconciliation-alert uncertainty without widening the V2 claim result. */
export const isPrintFulfillmentReconciliationAlertDeliveryUncertain = mutation({
	args: {
		orderId: v.id("orders"),
		externalId: v.string(),
		webhookSecret: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!isStripeCheckoutSessionId(args.externalId)) {
			throw new Error("Invalid print reconciliation identity");
		}
		const order = await ctx.db.get(args.orderId);
		return order?.stripeSessionId === args.externalId
			&& order.printFulfillmentReconciliationAlertDeliveryUncertainAt !== undefined;
	},
});

/** Recheck a reconciliation-alert lease immediately before the email request. */
export const authorizePrintFulfillmentReconciliationAlertSend = mutation({
	args: {
		orderId: v.id("orders"),
		externalId: v.string(),
		claimToken: v.string(),
		webhookSecret: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!isStripeCheckoutSessionId(args.externalId)) {
			throw new Error("Invalid print reconciliation identity");
		}
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid alert claim token");
		const order = await ctx.db.get(args.orderId);
		if (
			!order
			|| order.stripeSessionId !== args.externalId
			|| order.lumaprintsOrderNumber !== undefined
			|| !hasUncertainPrintSubmission(order)
			|| order.printFulfillmentResolution !== "reconciliation_blocked"
			|| order.printFulfillmentReconciliationAlertRetryProtocol !== "bounded_23h_v1"
			|| order.printFulfillmentReconciliationAlertSentAt !== undefined
			|| order.printFulfillmentReconciliationAlertDeliveryUncertainAt !== undefined
			|| order.printFulfillmentReconciliationAlertClaimToken !== args.claimToken
		) return false;
		const now = Date.now();
		const firstAttemptAt = order.printFulfillmentReconciliationAlertClaimedAt;
		if (firstAttemptAt === undefined) return false;
		if (now - firstAttemptAt >= EMAIL_AUTOMATIC_RETRY_WINDOW_MS) {
			await ctx.db.patch(order._id, {
				printFulfillmentReconciliationAlertClaimToken: undefined,
				printFulfillmentReconciliationAlertLeaseExpiresAt: undefined,
				printFulfillmentReconciliationAlertDeliveryUncertainAt: now,
			});
			return false;
		}
		return order.printFulfillmentReconciliationAlertLeaseExpiresAt !== undefined
			&& order.printFulfillmentReconciliationAlertLeaseExpiresAt > now;
	},
});

/** Release only the caller's unsent reconciliation-alert lease. */
export const releasePrintFulfillmentReconciliationAlert = mutation({
	args: {
		orderId: v.id("orders"),
		externalId: v.string(),
		claimToken: v.string(),
		webhookSecret: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid alert claim token");
		const order = await ctx.db.get(args.orderId);
		if (
			!order
			|| order.stripeSessionId !== args.externalId
			|| order.printFulfillmentReconciliationAlertSentAt !== undefined
			|| order.printFulfillmentReconciliationAlertClaimToken !== args.claimToken
		) return false;
		await ctx.db.patch(order._id, {
			printFulfillmentReconciliationAlertClaimToken: undefined,
			printFulfillmentReconciliationAlertLeaseExpiresAt: undefined,
		});
		return true;
	},
});

/** Mark a successfully sent reconciliation alert terminally complete. */
export const completePrintFulfillmentReconciliationAlert = mutation({
	args: {
		orderId: v.id("orders"),
		externalId: v.string(),
		claimToken: v.string(),
		webhookSecret: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid alert claim token");
		const order = await ctx.db.get(args.orderId);
		if (!order || order.stripeSessionId !== args.externalId) return false;
		if (order.printFulfillmentReconciliationAlertSentAt !== undefined) return false;
		if (order.printFulfillmentReconciliationAlertClaimToken !== args.claimToken) return false;
		await ctx.db.patch(order._id, {
			printFulfillmentReconciliationAlertClaimToken: undefined,
			printFulfillmentReconciliationAlertLeaseExpiresAt: undefined,
			printFulfillmentReconciliationAlertSentAt: Date.now(),
		});
		return true;
	},
});

/** Lease the idempotent Stripe request for one automated fulfillment refund. */
export const claimAutomatedFulfillmentRefund = mutation({
	args: {
		orderId: v.id("orders"),
		claimToken: v.string(),
		fulfillmentError: v.string(),
		webhookSecret: v.string(),
	},
	returns: v.union(
		v.object({ kind: v.literal("claimed"), leaseExpiresAt: v.number() }),
		v.object({ kind: v.literal("busy"), leaseExpiresAt: v.number() }),
		v.object({ kind: v.literal("refunded"), stripeRefundId: v.string() }),
		v.object({ kind: v.literal("unavailable") }),
	),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid refund claim token");
		if (args.fulfillmentError.length < 1 || args.fulfillmentError.length > 1000) {
			throw new Error("Invalid durable fulfillment error");
		}
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new Error("Order not found");
		if (
			order.status === "fulfillment_error"
			&& order.fulfillmentRecoveryStatus === "refunded"
			&& order.stripeRefundId !== undefined
		) return { kind: "refunded" as const, stripeRefundId: order.stripeRefundId };
		const isFreshRecovery = order.status === "new"
			&& order.fulfillmentRecoveryStatus === undefined
			&& order.fulfillmentError === undefined
			&& order.stripeRefundId === undefined
			&& order.lumaprintsOrderNumber === undefined
			&& order.printFulfillmentClaim !== true
			&& order.printFulfillmentPhase === undefined
			&& order.printFulfillmentResolution === undefined;
		const isPendingRecovery = order.status === "fulfillment_error"
			&& (
				order.fulfillmentRecoveryStatus === undefined
				|| order.fulfillmentRecoveryStatus === "refund_pending"
			)
			&& order.stripeRefundId === undefined
			&& order.automatedRefundId === undefined
			&& order.lumaprintsOrderNumber === undefined
			&& order.printFulfillmentClaim !== true
			&& order.printFulfillmentPhase === undefined
			&& order.printFulfillmentResolution === undefined
			&& (
				order.fulfillmentError === undefined
				|| order.fulfillmentError === args.fulfillmentError
			);
		if (!isFreshRecovery && !isPendingRecovery) return { kind: "unavailable" as const };
		const now = Date.now();
		if (
			order.automatedRefundClaimToken !== undefined
			&& order.automatedRefundLeaseExpiresAt !== undefined
			&& order.automatedRefundLeaseExpiresAt > now
		) {
			return {
				kind: "busy" as const,
				leaseExpiresAt: order.automatedRefundLeaseExpiresAt,
			};
		}
		if (
			isPendingRecovery
			&& order.fulfillmentRecoveryStatus === "refund_pending"
			&& order.automatedRefundPreRequestProtocol !== "print_rejection_v1"
		) {
			await ctx.db.patch(order._id, {
				fulfillmentRecoveryStatus: "refund_attention",
				automatedRefundAttentionAt: now,
				automatedRefundAttentionReason: "request_outcome_unknown",
				automatedRefundFirstAttemptAt:
					order.automatedRefundFirstAttemptAt ?? order.automatedRefundClaimedAt ?? now,
				automatedRefundClaimedAt: undefined,
				automatedRefundClaimToken: undefined,
				automatedRefundLeaseExpiresAt: undefined,
				fulfillmentFailureNotificationProtocol: FULFILLMENT_NOTIFICATION_PROTOCOL,
				fulfillmentFailureNotificationRetryProtocol: "bounded_23h_v1",
			});
			return { kind: "unavailable" as const };
		}
		const leaseExpiresAt = now + AUTOMATED_REFUND_LEASE_MS;
		await ctx.db.patch(order._id, {
			status: "fulfillment_error",
			fulfillmentError: args.fulfillmentError,
			fulfillmentRecoveryStatus: "refund_pending",
			automatedRefundClaimedAt: now,
			automatedRefundClaimToken: args.claimToken,
			automatedRefundLeaseExpiresAt: leaseExpiresAt,
			automatedRefundAttempts: (order.automatedRefundAttempts ?? 0) + 1,
			automatedRefundFirstAttemptAt: order.automatedRefundFirstAttemptAt ?? now,
			automatedRefundLastAttemptAt: now,
			automatedRefundPreRequestProtocol: undefined,
		});
		return { kind: "claimed" as const, leaseExpiresAt };
	},
});

/** Lease-aware refund coordinator that resumes a stored provider refund by ID. */
export const claimAutomatedFulfillmentRefundV2 = mutation({
	args: {
		orderId: v.id("orders"),
		claimToken: v.string(),
		fulfillmentError: v.string(),
		webhookSecret: v.string(),
	},
	returns: v.union(
		v.object({
			kind: v.literal("claimed"),
			leaseExpiresAt: v.number(),
			stripeRefundId: v.optional(v.string()),
			refundStatus: v.optional(automatedRefundStatusValidator),
		}),
		v.object({ kind: v.literal("busy"), leaseExpiresAt: v.number() }),
		v.object({ kind: v.literal("refunded"), stripeRefundId: v.string() }),
		v.object({
			kind: v.literal("refund_failed"),
			stripeRefundId: v.string(),
			refundStatus: v.union(v.literal("failed"), v.literal("canceled")),
		}),
		v.object({
			kind: v.literal("refund_attention"),
			stripeRefundId: v.string(),
			refundStatus: v.union(v.literal("pending"), v.literal("requires_action")),
			attentionReason: v.union(
				v.literal("attempts_exhausted"),
				v.literal("age_exceeded"),
			),
		}),
		v.object({ kind: v.literal("unavailable") }),
	),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid refund claim token");
		if (args.fulfillmentError.length < 1 || args.fulfillmentError.length > 1000) {
			throw new Error("Invalid durable fulfillment error");
		}
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new Error("Order not found");
		if (
			order.status === "fulfillment_error"
			&& order.fulfillmentRecoveryStatus === "refunded"
			&& order.stripeRefundId !== undefined
			&& order.automatedRefundStatus === "succeeded"
		) return { kind: "refunded" as const, stripeRefundId: order.stripeRefundId };
		if (
			order.status === "fulfillment_error"
			&& order.fulfillmentRecoveryStatus === "refund_failed"
			&& order.automatedRefundId !== undefined
			&& (order.automatedRefundStatus === "failed"
				|| order.automatedRefundStatus === "canceled")
		) {
			return {
				kind: "refund_failed" as const,
				stripeRefundId: order.automatedRefundId,
				refundStatus: order.automatedRefundStatus,
			};
		}
		if (
			order.status === "fulfillment_error"
			&& order.fulfillmentRecoveryStatus === "refund_attention"
			&& order.automatedRefundId === undefined
			&& order.automatedRefundAttentionReason === "request_outcome_unknown"
		) return { kind: "unavailable" as const };
		if (
			order.status === "fulfillment_error"
			&& order.fulfillmentRecoveryStatus === "refund_attention"
			&& order.automatedRefundId !== undefined
			&& (order.automatedRefundStatus === "pending"
				|| order.automatedRefundStatus === "requires_action")
			&& (order.automatedRefundAttentionReason === "attempts_exhausted"
				|| order.automatedRefundAttentionReason === "age_exceeded")
		) {
			return {
				kind: "refund_attention" as const,
				stripeRefundId: order.automatedRefundId,
				refundStatus: order.automatedRefundStatus,
				attentionReason: order.automatedRefundAttentionReason,
			};
		}
		const isFreshRecovery = order.status === "new"
			&& order.fulfillmentRecoveryStatus === undefined
			&& order.fulfillmentError === undefined
			&& order.stripeRefundId === undefined
			&& order.automatedRefundId === undefined
			&& order.lumaprintsOrderNumber === undefined
			&& order.printFulfillmentClaim !== true
			&& order.printFulfillmentPhase === undefined
			&& order.printFulfillmentResolution === undefined;
		const isPendingRecovery = order.status === "fulfillment_error"
			&& order.fulfillmentRecoveryStatus === "refund_pending"
			&& order.stripeRefundId === undefined
			&& order.fulfillmentError === args.fulfillmentError
			&& (
				order.automatedRefundStatus === undefined
				|| order.automatedRefundStatus === "pending"
				|| order.automatedRefundStatus === "requires_action"
			);
		if (!isFreshRecovery && !isPendingRecovery) return { kind: "unavailable" as const };
		const now = Date.now();
		if (
			order.automatedRefundClaimToken !== undefined
			&& order.automatedRefundLeaseExpiresAt !== undefined
			&& order.automatedRefundLeaseExpiresAt > now
		) {
			return {
				kind: "busy" as const,
				leaseExpiresAt: order.automatedRefundLeaseExpiresAt,
			};
		}
		const firstAttemptAt =
			order.automatedRefundFirstAttemptAt ?? order.automatedRefundClaimedAt ?? now;
		const pendingAttentionReason: AutomatedRefundAttentionReason | undefined =
			order.automatedRefundId !== undefined
			&& (order.automatedRefundStatus === "pending"
				|| order.automatedRefundStatus === "requires_action")
				? now - firstAttemptAt >= AUTOMATED_REFUND_PENDING_MAX_AGE_MS
					? "age_exceeded"
					: (order.automatedRefundAttempts ?? 0) >= AUTOMATED_REFUND_PENDING_MAX_ATTEMPTS
						? "attempts_exhausted"
						: undefined
				: undefined;
		if (
			pendingAttentionReason !== undefined
			&& order.automatedRefundId !== undefined
			&& (order.automatedRefundStatus === "pending"
				|| order.automatedRefundStatus === "requires_action")
		) {
			await ctx.db.patch(order._id, {
				fulfillmentRecoveryStatus: "refund_attention",
				automatedRefundAttentionAt: now,
				automatedRefundAttentionReason: pendingAttentionReason,
				automatedRefundClaimedAt: undefined,
				automatedRefundClaimToken: undefined,
				automatedRefundLeaseExpiresAt: undefined,
				fulfillmentFailureNotificationProtocol: FULFILLMENT_NOTIFICATION_PROTOCOL,
				fulfillmentFailureNotificationRetryProtocol: "bounded_23h_v1",
			});
			return {
				kind: "refund_attention" as const,
				stripeRefundId: order.automatedRefundId,
				refundStatus: order.automatedRefundStatus,
				attentionReason: pendingAttentionReason,
			};
		}
		if (
			isPendingRecovery
			&& order.automatedRefundId === undefined
			&& order.automatedRefundPreRequestProtocol !== "print_rejection_v1"
		) {
			await ctx.db.patch(order._id, {
				fulfillmentRecoveryStatus: "refund_attention",
				automatedRefundAttentionAt: now,
				automatedRefundAttentionReason: "request_outcome_unknown",
				automatedRefundFirstAttemptAt: firstAttemptAt,
				automatedRefundClaimedAt: undefined,
				automatedRefundClaimToken: undefined,
				automatedRefundLeaseExpiresAt: undefined,
				fulfillmentFailureNotificationProtocol: FULFILLMENT_NOTIFICATION_PROTOCOL,
				fulfillmentFailureNotificationRetryProtocol: "bounded_23h_v1",
			});
			return { kind: "unavailable" as const };
		}
		const leaseExpiresAt = now + AUTOMATED_REFUND_LEASE_MS;
		await ctx.db.patch(order._id, {
			status: "fulfillment_error",
			fulfillmentError: args.fulfillmentError,
			fulfillmentRecoveryStatus: "refund_pending",
			automatedRefundClaimedAt: now,
			automatedRefundClaimToken: args.claimToken,
			automatedRefundLeaseExpiresAt: leaseExpiresAt,
			automatedRefundAttempts: (order.automatedRefundAttempts ?? 0) + 1,
			automatedRefundFirstAttemptAt: firstAttemptAt,
			automatedRefundLastAttemptAt: now,
			automatedRefundPreRequestProtocol: undefined,
		});
		return {
			kind: "claimed" as const,
			leaseExpiresAt,
			...(order.automatedRefundId === undefined
				? {}
				: { stripeRefundId: order.automatedRefundId }),
			...(order.automatedRefundStatus === undefined
				? {}
				: { refundStatus: order.automatedRefundStatus }),
		};
	},
});

/** Fence a refund request whose provider outcome cannot be proved. */
export const markAutomatedFulfillmentRefundRequestUncertain = mutation({
	args: {
		orderId: v.id("orders"),
		claimToken: v.string(),
		webhookSecret: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid refund claim token");
		const order = await ctx.db.get(args.orderId);
		if (
			!order
			|| order.fulfillmentRecoveryStatus !== "refund_pending"
			|| order.stripeRefundId !== undefined
			|| order.automatedRefundId !== undefined
			|| order.automatedRefundClaimToken !== args.claimToken
		) return false;
		const now = Date.now();
		await ctx.db.patch(order._id, {
			fulfillmentRecoveryStatus: "refund_attention",
			automatedRefundAttentionAt: now,
			automatedRefundAttentionReason: "request_outcome_unknown",
			automatedRefundFirstAttemptAt:
				order.automatedRefundFirstAttemptAt ?? order.automatedRefundClaimedAt ?? now,
			automatedRefundClaimedAt: undefined,
			automatedRefundClaimToken: undefined,
			automatedRefundLeaseExpiresAt: undefined,
			fulfillmentFailureNotificationProtocol: FULFILLMENT_NOTIFICATION_PROTOCOL,
			fulfillmentFailureNotificationRetryProtocol: "bounded_23h_v1",
		});
		return true;
	},
});

/** Read the durable no-ID refund fence without widening the V2 claim contract. */
export const isAutomatedFulfillmentRefundRequestUncertain = mutation({
	args: {
		orderId: v.id("orders"),
		webhookSecret: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const order = await ctx.db.get(args.orderId);
		return order?.status === "fulfillment_error"
			&& order.fulfillmentRecoveryStatus === "refund_attention"
			&& order.stripeRefundId === undefined
			&& order.automatedRefundId === undefined
			&& order.automatedRefundAttentionReason === "request_outcome_unknown";
	},
});

/** Release only the caller's unfinished automated-refund lease. */
export const releaseAutomatedFulfillmentRefund = mutation({
	args: {
		orderId: v.id("orders"),
		claimToken: v.string(),
		webhookSecret: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid refund claim token");
		const order = await ctx.db.get(args.orderId);
		if (
			!order
			|| order.fulfillmentRecoveryStatus !== "refund_pending"
			|| order.stripeRefundId !== undefined
			|| order.automatedRefundClaimToken !== args.claimToken
		) return false;
		if (order.automatedRefundId === undefined) {
			const now = Date.now();
			await ctx.db.patch(order._id, {
				fulfillmentRecoveryStatus: "refund_attention",
				automatedRefundAttentionAt: now,
				automatedRefundAttentionReason: "request_outcome_unknown",
				automatedRefundFirstAttemptAt:
					order.automatedRefundFirstAttemptAt ?? order.automatedRefundClaimedAt ?? now,
				automatedRefundClaimedAt: undefined,
				automatedRefundClaimToken: undefined,
				automatedRefundLeaseExpiresAt: undefined,
				fulfillmentFailureNotificationProtocol: FULFILLMENT_NOTIFICATION_PROTOCOL,
				fulfillmentFailureNotificationRetryProtocol: "bounded_23h_v1",
			});
			return true;
		}
		await ctx.db.patch(order._id, {
			automatedRefundClaimedAt: undefined,
			automatedRefundClaimToken: undefined,
			automatedRefundLeaseExpiresAt: undefined,
		});
		return true;
	},
});

/** Store a Stripe refund result only for the current automated-refund owner. */
export const completeAutomatedFulfillmentRefund = mutation({
	args: {
		orderId: v.id("orders"),
		claimToken: v.string(),
		stripeRefundId: v.string(),
		webhookSecret: v.string(),
	},
	returns: v.union(
		v.object({ kind: v.literal("completed") }),
		v.object({ kind: v.literal("replayed") }),
	),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid refund claim token");
		if (!STRIPE_REFUND_ID.test(args.stripeRefundId)) throw new Error("Invalid Stripe refund ID");
		throw new Error("Automated refund status requires the versioned completion protocol");
	},
});

function automatedRefundProjection(order: Doc<"orders">, status: AutomatedRefundStatus) {
	const common = {
		orderId: order._id,
		orderNumber: order.orderNumber,
		customerEmail: order.customerEmail,
		total: order.total,
		errorSummary: order.fulfillmentError ?? "Permanent fulfillment failure",
	};
	if (status === "succeeded" && order.stripeRefundId !== undefined) {
		return { kind: "succeeded" as const, ...common, stripeRefundId: order.stripeRefundId };
	}
	if (
		(status === "failed" || status === "canceled")
		&& order.automatedRefundId !== undefined
	) {
		return {
			kind: "refund_failed" as const,
			...common,
			stripeRefundId: order.automatedRefundId,
			refundStatus: status,
		};
	}
	if (
		(status === "pending" || status === "requires_action")
		&& order.fulfillmentRecoveryStatus === "refund_attention"
		&& order.automatedRefundId !== undefined
		&& (order.automatedRefundAttentionReason === "attempts_exhausted"
			|| order.automatedRefundAttentionReason === "age_exceeded")
	) {
		return {
			kind: "refund_attention" as const,
			...common,
			stripeRefundId: order.automatedRefundId,
			refundStatus: status,
			attentionReason: order.automatedRefundAttentionReason,
		};
	}
	return { kind: "pending" as const, refundStatus: status };
}

async function applyAutomatedRefundStatus(
	ctx: MutationCtx,
	order: Doc<"orders">,
	stripeRefundId: string,
	refundStatus: AutomatedRefundStatus,
) {
	const isExactTerminalOrAttentionReplay = order.automatedRefundId === stripeRefundId
		&& order.automatedRefundStatus === refundStatus
		&& (
			refundStatus === "succeeded"
				&& order.fulfillmentRecoveryStatus === "refunded"
				&& order.stripeRefundId === stripeRefundId
			|| (refundStatus === "failed" || refundStatus === "canceled")
				&& order.fulfillmentRecoveryStatus === "refund_failed"
			|| (refundStatus === "pending" || refundStatus === "requires_action")
				&& order.fulfillmentRecoveryStatus === "refund_attention"
				&& (order.automatedRefundAttentionReason === "attempts_exhausted"
					|| order.automatedRefundAttentionReason === "age_exceeded")
		);
	if (isExactTerminalOrAttentionReplay) {
		return automatedRefundProjection(order, refundStatus);
	}
	const continuesTrustedRefund = order.fulfillmentRecoveryStatus === "refund_attention"
		&& order.automatedRefundId === undefined
		&& order.automatedRefundAttentionReason === "request_outcome_unknown"
		|| (order.fulfillmentRecoveryStatus === "refund_pending"
				|| order.fulfillmentRecoveryStatus === "refund_attention")
			&& order.automatedRefundId === stripeRefundId
			&& (order.automatedRefundStatus === "pending"
				|| order.automatedRefundStatus === "requires_action");
	if (
		order.status !== "fulfillment_error"
		|| order.fulfillmentError === undefined
		|| !continuesTrustedRefund && (
			order.lumaprintsOrderNumber !== undefined
			|| order.printFulfillmentClaim === true
			|| order.printFulfillmentPhase !== undefined
			|| order.printFulfillmentResolution !== undefined
		)
		|| order.stripeRefundId !== undefined && order.stripeRefundId !== stripeRefundId
		|| order.automatedRefundId !== undefined && order.automatedRefundId !== stripeRefundId
	) throw new Error("Automated refund claim is unavailable");
	if (order.automatedRefundStatus === "succeeded") {
		throw new Error("Automated refund status cannot regress");
	}
	if (
		(order.automatedRefundStatus === "failed" || order.automatedRefundStatus === "canceled")
		&& order.automatedRefundStatus !== refundStatus
	) throw new Error("Automated refund status cannot regress");

	const suppressesLegacySuccessNotifications =
		order.legacyAutomatedRefundNotificationsSuppressed === true
		|| (
			order.fulfillmentFailureNotificationProtocol === undefined
			&& order.fulfillmentRecoveryStatus === "refunded"
			&& order.stripeRefundId === stripeRefundId
		);
	const now = Date.now();
	const pendingAttentionReason: AutomatedRefundAttentionReason | undefined =
		refundStatus === "pending" || refundStatus === "requires_action"
			? order.fulfillmentRecoveryStatus === "refund_attention"
				&& (order.automatedRefundAttentionReason === "attempts_exhausted"
					|| order.automatedRefundAttentionReason === "age_exceeded")
				? order.automatedRefundAttentionReason
				: order.automatedRefundFirstAttemptAt !== undefined
					&& now - order.automatedRefundFirstAttemptAt >= AUTOMATED_REFUND_PENDING_MAX_AGE_MS
					? "age_exceeded"
					: (order.automatedRefundAttempts ?? 0) >= AUTOMATED_REFUND_PENDING_MAX_ATTEMPTS
						? "attempts_exhausted"
						: undefined
			: undefined;
	const nextStripeRefundId = refundStatus === "succeeded" ? stripeRefundId : undefined;
	const nextRecoveryStatus = refundStatus === "succeeded"
		? "refunded" as const
		: refundStatus === "failed" || refundStatus === "canceled"
			? "refund_failed" as const
			: pendingAttentionReason !== undefined
				? "refund_attention" as const
				: "refund_pending" as const;
	const authorizesNotificationProtocol = refundStatus === "failed"
		|| refundStatus === "canceled"
		|| pendingAttentionReason !== undefined
		|| refundStatus === "succeeded" && !suppressesLegacySuccessNotifications;
	const notificationWasAlreadyEligible =
		order.fulfillmentFailureNotificationProtocol === FULFILLMENT_NOTIFICATION_PROTOCOL
		&& (
			(refundStatus === "failed" || refundStatus === "canceled")
				&& order.fulfillmentRecoveryStatus === "refund_failed"
				&& order.automatedRefundId === stripeRefundId
				&& order.automatedRefundStatus === refundStatus
			|| pendingAttentionReason !== undefined
				&& order.fulfillmentRecoveryStatus === "refund_attention"
				&& order.automatedRefundId === stripeRefundId
				&& (order.automatedRefundStatus === "pending"
					|| order.automatedRefundStatus === "requires_action")
				&& order.automatedRefundAttentionReason === pendingAttentionReason
		);
	await ctx.db.patch(order._id, {
		automatedRefundId: stripeRefundId,
		automatedRefundStatus: refundStatus,
		stripeRefundId: nextStripeRefundId,
		fulfillmentRecoveryStatus: nextRecoveryStatus,
		automatedRefundClaimedAt: undefined,
		automatedRefundClaimToken: undefined,
		automatedRefundLeaseExpiresAt: undefined,
		...(pendingAttentionReason === undefined
			? {
					automatedRefundAttentionAt: undefined,
					automatedRefundAttentionReason: undefined,
				}
			: {
					automatedRefundAttentionAt: order.automatedRefundAttentionAt ?? now,
					automatedRefundAttentionReason: pendingAttentionReason,
				}),
		...(suppressesLegacySuccessNotifications
			? { legacyAutomatedRefundNotificationsSuppressed: true as const }
			: {}),
		...(authorizesNotificationProtocol
			? {
					fulfillmentFailureNotificationProtocol: FULFILLMENT_NOTIFICATION_PROTOCOL,
					...(!notificationWasAlreadyEligible
						? { fulfillmentFailureNotificationRetryProtocol: "bounded_23h_v1" as const }
						: {}),
				}
			: {}),
	});
	return automatedRefundProjection({
		...order,
		automatedRefundId: stripeRefundId,
		automatedRefundStatus: refundStatus,
		stripeRefundId: nextStripeRefundId,
		fulfillmentRecoveryStatus: nextRecoveryStatus,
		...(pendingAttentionReason === undefined
			? {
					automatedRefundAttentionAt: undefined,
					automatedRefundAttentionReason: undefined,
				}
			: {
					automatedRefundAttentionAt: order.automatedRefundAttentionAt ?? now,
					automatedRefundAttentionReason: pendingAttentionReason,
				}),
		...(suppressesLegacySuccessNotifications
			? { legacyAutomatedRefundNotificationsSuppressed: true as const }
			: {}),
		...(authorizesNotificationProtocol
			? { fulfillmentFailureNotificationProtocol: FULFILLMENT_NOTIFICATION_PROTOCOL }
			: {}),
	}, refundStatus);
}

/** Persist the exact provider refund status for the current lease owner. */
export const recordAutomatedFulfillmentRefund = mutation({
	args: {
		orderId: v.id("orders"),
		claimToken: v.string(),
		stripeRefundId: v.string(),
		stripeRefundStatus: automatedRefundStatusValidator,
		webhookSecret: v.string(),
	},
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid refund claim token");
		if (!STRIPE_REFUND_ID.test(args.stripeRefundId)) throw new Error("Invalid Stripe refund ID");
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new Error("Order not found");
		if (
			order.automatedRefundId === args.stripeRefundId
			&& order.automatedRefundStatus === args.stripeRefundStatus
			&& (
				order.fulfillmentRecoveryStatus === "refunded"
				|| order.fulfillmentRecoveryStatus === "refund_failed"
				|| order.fulfillmentRecoveryStatus === "refund_attention"
			)
		) return automatedRefundProjection(order, args.stripeRefundStatus);
		if (
			order.fulfillmentRecoveryStatus !== "refund_pending"
			|| order.automatedRefundClaimToken !== args.claimToken
		) throw new Error("Automated refund claim is unavailable");
		return await applyAutomatedRefundStatus(
			ctx,
			order,
			args.stripeRefundId,
			args.stripeRefundStatus,
		);
	},
});

/** Project a signed automated refund update independently of a host lease. */
export const reconcileAutomatedFulfillmentRefund = mutation({
	args: {
		webhookSecret: v.string(),
		stripeEventId: v.string(),
		stripeRefundId: v.string(),
		stripeRefundStatus: automatedRefundStatusValidator,
		stripeSessionId: v.string(),
		stripePaymentIntentId: v.string(),
		stripeConnectedAccountId: v.optional(v.string()),
		stripeTenantMetadataSiteUrl: v.optional(v.string()),
		siteUrl: v.string(),
		metadataOrderNumber: v.string(),
		automationTag: v.literal("fulfillment_recovery_v1"),
		refundAmount: v.number(),
		sessionAmountTotal: v.number(),
		refundCurrency: v.literal("usd"),
		sessionCurrency: v.literal("usd"),
		eventLivemode: v.boolean(),
		sessionLivemode: v.boolean(),
	},
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const validIdentity = STRIPE_EVENT_ID.test(args.stripeEventId)
			&& STRIPE_REFUND_ID.test(args.stripeRefundId)
			&& STRIPE_PAYMENT_INTENT_ID.test(args.stripePaymentIntentId)
			&& isStripeCheckoutSessionId(args.stripeSessionId)
			&& (args.stripeConnectedAccountId === undefined
				|| isStripeConnectedAccountId(args.stripeConnectedAccountId))
			&& args.automationTag === REFUND_AUTOMATION_TAG
			&& args.metadataOrderNumber.length > 0
			&& args.metadataOrderNumber.length <= 64
			&& Number.isSafeInteger(args.refundAmount)
			&& Number.isSafeInteger(args.sessionAmountTotal)
			&& args.refundAmount > 0
			&& args.refundAmount === args.sessionAmountTotal
			&& args.refundCurrency === args.sessionCurrency
			&& args.eventLivemode === args.sessionLivemode;
		if (!validIdentity) return { kind: "rejected" as const, reason: "identity_conflict" as const };
		if (args.stripeConnectedAccountId !== undefined) {
			const clients = await ctx.db.query("platformClients")
				.withIndex("by_stripeConnectedAccountId", (q) => q
					.eq("stripeConnectedAccountId", args.stripeConnectedAccountId))
				.take(2);
			if (clients.length !== 1 || clients[0].siteUrl !== args.siteUrl) {
				return { kind: "rejected" as const, reason: "identity_conflict" as const };
			}
		}
		const matches = await ctx.db.query("orders")
			.withIndex("by_stripeSessionId", (q) => q.eq("stripeSessionId", args.stripeSessionId))
			.take(2);
		if (matches.length !== 1) {
			return { kind: "rejected" as const, reason: "identity_conflict" as const };
		}
		const order = matches[0];
		if (
			order.siteUrl !== args.siteUrl
			|| order.orderNumber !== args.metadataOrderNumber
			|| order.total !== args.refundAmount
			|| order.stripePaymentIntentId !== args.stripePaymentIntentId
			|| order.stripeConnectedAccountId !== undefined
				&& order.stripeConnectedAccountId !== args.stripeConnectedAccountId
			|| args.stripeTenantMetadataSiteUrl !== undefined
				&& args.stripeTenantMetadataSiteUrl !== order.siteUrl
		) return { kind: "rejected" as const, reason: "identity_conflict" as const };
		try {
			return await applyAutomatedRefundStatus(
				ctx,
				order,
				args.stripeRefundId,
				args.stripeRefundStatus,
			);
		} catch (cause) {
			if (
				cause instanceof Error
				&& (
					cause.message === "Automated refund claim is unavailable"
					|| cause.message === "Automated refund status cannot regress"
				)
			) return { kind: "rejected" as const, reason: "state_conflict" as const };
			throw cause;
		}
	},
});

/** Claim one best-effort failure notification after an automated refund is durable. */
export const claimFulfillmentFailureNotification = mutation({
	args: {
		orderId: v.id("orders"),
		audience: v.union(v.literal("admin"), v.literal("customer")),
		webhookSecret: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		// Kept byte-compatible for rollout, but deliberately inert. Rows written by
		// this legacy at-most-once protocol must never authorize a new send.
		return false;
	},
});

type RefundNotificationAudience =
	| "admin"
	| "customer"
	| "refund_failure"
	| "refund_attention";

function refundNotificationFields(audience: RefundNotificationAudience) {
	if (audience === "admin") {
		return {
			claimedAt: "fulfillmentFailureAdminNotificationClaimedAt" as const,
			claimToken: "fulfillmentFailureAdminNotificationClaimToken" as const,
			leaseExpiresAt: "fulfillmentFailureAdminNotificationLeaseExpiresAt" as const,
			sentAt: "fulfillmentFailureAdminNotificationSentAt" as const,
			uncertainAt: "fulfillmentFailureAdminNotificationDeliveryUncertainAt" as const,
		};
	}
	if (audience === "customer") {
		return {
			claimedAt: "fulfillmentFailureCustomerNotificationClaimedAt" as const,
			claimToken: "fulfillmentFailureCustomerNotificationClaimToken" as const,
			leaseExpiresAt: "fulfillmentFailureCustomerNotificationLeaseExpiresAt" as const,
			sentAt: "fulfillmentFailureCustomerNotificationSentAt" as const,
			uncertainAt: "fulfillmentFailureCustomerNotificationDeliveryUncertainAt" as const,
		};
	}
	if (audience === "refund_failure") {
		return {
			claimedAt: "automatedRefundFailureNotificationClaimedAt" as const,
			claimToken: "automatedRefundFailureNotificationClaimToken" as const,
			leaseExpiresAt: "automatedRefundFailureNotificationLeaseExpiresAt" as const,
			sentAt: "automatedRefundFailureNotificationSentAt" as const,
			uncertainAt: "automatedRefundFailureNotificationDeliveryUncertainAt" as const,
		};
	}
	return {
		claimedAt: "automatedRefundAttentionNotificationClaimedAt" as const,
		claimToken: "automatedRefundAttentionNotificationClaimToken" as const,
		leaseExpiresAt: "automatedRefundAttentionNotificationLeaseExpiresAt" as const,
		sentAt: "automatedRefundAttentionNotificationSentAt" as const,
		uncertainAt: "automatedRefundAttentionNotificationDeliveryUncertainAt" as const,
	};
}

function canNotifyAutomatedRefund(order: Doc<"orders">, audience: RefundNotificationAudience) {
	if (
		order.status !== "fulfillment_error"
		|| order.fulfillmentFailureNotificationProtocol !== FULFILLMENT_NOTIFICATION_PROTOCOL
	) return false;
	if (audience === "refund_failure") {
		return order.fulfillmentRecoveryStatus === "refund_failed"
			&& order.automatedRefundId !== undefined
			&& (order.automatedRefundStatus === "failed"
				|| order.automatedRefundStatus === "canceled")
			&& order.fulfillmentFailureNotificationProtocol === FULFILLMENT_NOTIFICATION_PROTOCOL;
	}
	if (audience === "refund_attention") {
		return order.fulfillmentRecoveryStatus === "refund_attention"
			&& (
				(order.automatedRefundId === undefined
					&& order.automatedRefundAttentionReason === "request_outcome_unknown")
				|| (
					order.automatedRefundId !== undefined
					&& (order.automatedRefundStatus === "pending"
						|| order.automatedRefundStatus === "requires_action")
					&& (order.automatedRefundAttentionReason === "attempts_exhausted"
						|| order.automatedRefundAttentionReason === "age_exceeded")
				)
			);
	}
	return order.fulfillmentRecoveryStatus === "refunded"
		&& order.stripeRefundId !== undefined
		&& order.automatedRefundId === order.stripeRefundId
		&& order.automatedRefundStatus === "succeeded"
		&& order.legacyAutomatedRefundNotificationsSuppressed !== true;
}

const fulfillmentFailureNotificationClaimArgs = {
	orderId: v.id("orders"),
	audience: v.union(
		v.literal("admin"),
		v.literal("customer"),
		v.literal("refund_failure"),
		v.literal("refund_attention"),
	),
	claimToken: v.string(),
	webhookSecret: v.string(),
};
const fulfillmentFailureNotificationClaimResult = v.union(
	v.object({ kind: v.literal("claimed") }),
	v.object({ kind: v.literal("busy"), leaseExpiresAt: v.number() }),
	v.object({ kind: v.literal("unavailable") }),
);

async function claimAutomatedRefundNotification(
	ctx: MutationCtx,
	args: {
		orderId: Id<"orders">;
		audience: RefundNotificationAudience;
		claimToken: string;
		webhookSecret: string;
	},
	supportsOrderIdentity: boolean,
) {
	if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid notification claim token");
	const order = await ctx.db.get(args.orderId);
	if (!order || !canNotifyAutomatedRefund(order, args.audience)) {
		return { kind: "unavailable" as const };
	}
	if (
		args.audience === "refund_attention"
		&& order.automatedRefundAttentionNotificationKeyProtocol === "order_identity_v1"
		&& !supportsOrderIdentity
	) return { kind: "unavailable" as const };
	const fields = refundNotificationFields(args.audience);
	if (order[fields.sentAt] !== undefined) return { kind: "unavailable" as const };
	const firstAttemptAt = order[fields.claimedAt];
	const deliveryUncertainAt = order[fields.uncertainAt];
	if (deliveryUncertainAt !== undefined) return { kind: "unavailable" as const };
	const now = Date.now();
	const existingClaimToken = order[fields.claimToken];
	const existingLeaseExpiresAt = order[fields.leaseExpiresAt];
	if (
		existingClaimToken !== undefined
		&& existingLeaseExpiresAt !== undefined
		&& existingLeaseExpiresAt > now
	) return { kind: "busy" as const, leaseExpiresAt: existingLeaseExpiresAt };
	if (order.fulfillmentFailureNotificationRetryProtocol !== "bounded_23h_v1") {
		await ctx.db.patch(order._id, {
			[fields.claimToken]: undefined,
			[fields.leaseExpiresAt]: undefined,
			[fields.uncertainAt]: now,
		});
		return { kind: "unavailable" as const };
	}
	if (firstAttemptAt !== undefined && now - firstAttemptAt >= EMAIL_AUTOMATIC_RETRY_WINDOW_MS) {
		await ctx.db.patch(order._id, {
			[fields.claimToken]: undefined,
			[fields.leaseExpiresAt]: undefined,
			[fields.uncertainAt]: now,
		});
		return { kind: "unavailable" as const };
	}
	await ctx.db.patch(order._id, {
		[fields.claimedAt]: firstAttemptAt ?? now,
		[fields.claimToken]: args.claimToken,
		[fields.leaseExpiresAt]: now + FULFILLMENT_NOTIFICATION_LEASE_MS,
	});
	return { kind: "claimed" as const };
}

/** Lease one retry-safe automated-refund notification for baseline hosts. */
export const claimFulfillmentFailureNotificationV2 = mutation({
	args: fulfillmentFailureNotificationClaimArgs,
	returns: fulfillmentFailureNotificationClaimResult,
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		return await claimAutomatedRefundNotification(ctx, args, false);
	},
});

/** Lease a notification with support for the order-scoped attention key. */
export const claimFulfillmentFailureNotificationV3 = mutation({
	args: fulfillmentFailureNotificationClaimArgs,
	returns: fulfillmentFailureNotificationClaimResult,
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		return await claimAutomatedRefundNotification(ctx, args, true);
	},
});

/** Read notification uncertainty without widening the V2 claim result. */
export const isFulfillmentFailureNotificationDeliveryUncertain = mutation({
	args: {
		orderId: v.id("orders"),
		audience: v.union(
			v.literal("admin"),
			v.literal("customer"),
			v.literal("refund_failure"),
			v.literal("refund_attention"),
		),
		webhookSecret: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const order = await ctx.db.get(args.orderId);
		if (!order) return false;
		const fields = refundNotificationFields(args.audience);
		return order[fields.uncertainAt] !== undefined;
	},
});

/** Recheck a notification lease immediately before the email request. */
export const authorizeFulfillmentFailureNotificationSendV2 = mutation({
	args: {
		orderId: v.id("orders"),
		audience: v.union(
			v.literal("admin"),
			v.literal("customer"),
			v.literal("refund_failure"),
			v.literal("refund_attention"),
		),
		claimToken: v.string(),
		webhookSecret: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid notification claim token");
		const order = await ctx.db.get(args.orderId);
		if (!order || !canNotifyAutomatedRefund(order, args.audience)) return false;
		const fields = refundNotificationFields(args.audience);
		if (
			order.fulfillmentFailureNotificationRetryProtocol !== "bounded_23h_v1"
			|| order[fields.sentAt] !== undefined
			|| order[fields.uncertainAt] !== undefined
			|| order[fields.claimToken] !== args.claimToken
		) return false;
		const now = Date.now();
		const firstAttemptAt = order[fields.claimedAt];
		if (firstAttemptAt === undefined) return false;
		if (now - firstAttemptAt >= EMAIL_AUTOMATIC_RETRY_WINDOW_MS) {
			await ctx.db.patch(order._id, {
				[fields.claimToken]: undefined,
				[fields.leaseExpiresAt]: undefined,
				[fields.uncertainAt]: now,
			});
			return false;
		}
		const leaseExpiresAt = order[fields.leaseExpiresAt];
		if (leaseExpiresAt === undefined || leaseExpiresAt <= now) return false;
		if (
			args.audience === "refund_attention"
			&& order.automatedRefundAttentionNotificationKeyProtocol !== "order_identity_v1"
		) {
			const isFirstProtocolLease =
				firstAttemptAt === leaseExpiresAt - FULFILLMENT_NOTIFICATION_LEASE_MS;
			if (!isFirstProtocolLease) {
				await ctx.db.patch(order._id, {
					[fields.claimToken]: undefined,
					[fields.leaseExpiresAt]: undefined,
					[fields.uncertainAt]: now,
				});
				return false;
			}
			await ctx.db.patch(order._id, {
				automatedRefundAttentionNotificationKeyProtocol: "order_identity_v1",
			});
		}
		return true;
	},
});

/** Release only the caller's unsent automated-refund notification lease. */
export const releaseFulfillmentFailureNotificationV2 = mutation({
	args: {
		orderId: v.id("orders"),
			audience: v.union(
			v.literal("admin"),
			v.literal("customer"),
				v.literal("refund_failure"),
				v.literal("refund_attention"),
		),
		claimToken: v.string(),
		webhookSecret: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid notification claim token");
		const order = await ctx.db.get(args.orderId);
		if (!order) return false;
		const fields = refundNotificationFields(args.audience);
		if (order[fields.sentAt] !== undefined || order[fields.claimToken] !== args.claimToken) {
			return false;
		}
		await ctx.db.patch(order._id, {
			[fields.claimToken]: undefined,
			[fields.leaseExpiresAt]: undefined,
		});
		return true;
	},
});

/** Mark one accepted automated-refund notification durably sent. */
export const completeFulfillmentFailureNotificationV2 = mutation({
	args: {
		orderId: v.id("orders"),
			audience: v.union(
			v.literal("admin"),
			v.literal("customer"),
				v.literal("refund_failure"),
				v.literal("refund_attention"),
		),
		claimToken: v.string(),
		webhookSecret: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid notification claim token");
		const order = await ctx.db.get(args.orderId);
		if (!order || !canNotifyAutomatedRefund(order, args.audience)) return false;
		const fields = refundNotificationFields(args.audience);
		if (order[fields.sentAt] !== undefined || order[fields.claimToken] !== args.claimToken) {
			return false;
		}
		await ctx.db.patch(order._id, {
			[fields.claimToken]: undefined,
			[fields.leaseExpiresAt]: undefined,
			[fields.sentAt]: Date.now(),
		});
		return true;
	},
});

/** Atomically select the notification outcome for an order without print submission. */
export const claimNonPrintOrderOutcome = mutation({
	args: { orderId: v.id("orders"), webhookSecret: v.string() },
	returns: v.union(
		v.object({ kind: v.literal("success") }),
		v.object({ kind: v.literal("none") }),
		v.object({ kind: v.literal("manual_refunded"), stripeRefundId: v.string() }),
		v.object({ kind: v.literal("automated_refunded"), stripeRefundId: v.string() }),
	),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new Error("Order not found");
		if (
			order.status === "refunded"
			&& order.stripeRefundId
			&& order.fulfillmentRecoveryStatus === undefined
		) return { kind: "manual_refunded" as const, stripeRefundId: order.stripeRefundId };
		if (order.stripeRefundId) {
			return { kind: "automated_refunded" as const, stripeRefundId: order.stripeRefundId };
		}
		if (
			order.status !== "new"
			|| order.fulfillmentRecoveryStatus !== undefined
			|| order.lumaprintsOrderNumber !== undefined
			|| order.printFulfillmentClaim
			|| order.orderConfirmationClaimedAt !== undefined
		) return { kind: "none" as const };
		await ctx.db.patch(order._id, { orderConfirmationClaimedAt: Date.now() });
		return { kind: "success" as const };
	},
});

/** Claim one normal confirmation after a print provider result is durable. */
export const claimOrderConfirmation = mutation({
	args: { orderId: v.id("orders"), webhookSecret: v.string() },
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new Error("Order not found");
		if (
			order.status !== "new"
			|| order.lumaprintsOrderNumber === undefined
			|| !LUMAPRINTS_ORDER_NUMBER.test(order.lumaprintsOrderNumber)
			|| order.printFulfillmentClaim
			|| order.printFulfillmentPhase !== undefined
			|| order.printFulfillmentResolution !== "resolved"
			|| order.stripeRefundId !== undefined
			|| order.fulfillmentRecoveryStatus !== undefined
			|| order.orderConfirmationClaimedAt !== undefined
		) return false;
		const owner = await findGlobalLumaPrintsOrder(ctx, order.lumaprintsOrderNumber);
		if (!owner || owner._id !== order._id) return false;
		await ctx.db.patch(order._id, { orderConfirmationClaimedAt: Date.now() });
		return true;
	},
});

/**
 * Update an order. Called by the webhook (fee capture, LumaPrints number,
 * refund fields — with `webhookSecret`) and by the admin UI (tracking /
 * status overrides — with an authenticated session).
 *
 * Audit C4: the old version accepted any caller; now requires either the
 * shared webhook secret or an authenticated admin.
 */
export const updateStatus = mutation({
	args: {
		orderId: v.id("orders"),
		webhookSecret: v.optional(v.string()),
		status: v.optional(orderStatusValidator),
		notes: v.optional(v.string()),
		trackingNumber: v.optional(v.string()),
		trackingUrl: v.optional(v.string()),
		lumaprintsOrderNumber: v.optional(v.string()),
		stripeFees: v.optional(v.number()),
		stripePaymentIntentId: v.optional(v.string()),
		fulfillmentError: v.optional(v.string()),
		stripeRefundId: v.optional(v.string()),
		fulfillmentRecoveryStatus: v.optional(fulfillmentRecoveryStatusValidator),
	},
	handler: async (ctx, { orderId, webhookSecret, ...updates }) => {
		const auth = await requireWebhookCallerOrAuth(ctx, webhookSecret);
		const refundUpdate = updates.stripeRefundId !== undefined
			|| updates.fulfillmentRecoveryStatus !== undefined || updates.status === "refunded";
		const fulfillmentUpdate = refundUpdate
			|| updates.status !== undefined
			|| updates.lumaprintsOrderNumber !== undefined
			|| updates.trackingNumber !== undefined
			|| updates.trackingUrl !== undefined
			|| updates.stripePaymentIntentId !== undefined
			|| updates.stripeFees !== undefined
			|| updates.fulfillmentError !== undefined;
		if (auth.via === "auth") {
			await requireDocumentSiteAdmin(ctx, "orders", orderId);
			if (refundUpdate) throw new Error("Stripe refund facts require webhook authority");
		}
		const current = fulfillmentUpdate ? await ctx.db.get(orderId) : null;
		if (
			updates.lumaprintsOrderNumber !== undefined
			&& !LUMAPRINTS_ORDER_NUMBER.test(updates.lumaprintsOrderNumber)
		) throw new Error("Invalid LumaPrints order number");
		if (updates.stripeFees !== undefined && !isNonnegativeSafeInteger(updates.stripeFees)) {
			throw new Error("Stripe fees must be nonnegative safe-integer minor units");
		}
		if (
			updates.stripePaymentIntentId !== undefined
			&& !STRIPE_PAYMENT_INTENT_ID.test(updates.stripePaymentIntentId)
		) throw new Error("Invalid Stripe payment intent ID");
		const changesPaymentIntentBinding = updates.stripePaymentIntentId !== undefined
			&& updates.stripePaymentIntentId !== current?.stripePaymentIntentId;
		const hasFeeBindingOrLifecycle = current !== null && current !== undefined && (
			current.stripePaymentIntentId !== undefined
			|| current.stripeFees !== undefined
			|| current.stripeFeeCurrency !== undefined
			|| current.stripeFeeChargeId !== undefined
			|| current.stripeFeeBalanceTransactionId !== undefined
			|| current.stripeFeeProvenance !== undefined
			|| current.stripeFeeCaptureStatus !== undefined
			|| current.stripeFeeCaptureAttemptToken !== undefined
		);
		if (changesPaymentIntentBinding && hasFeeBindingOrLifecycle) {
			throw new Error("Stripe payment intent binding is immutable after fee tracking begins");
		}
		const hasExactBaselineCompletionPayload = updates.lumaprintsOrderNumber !== undefined
			&& Object.entries(updates).every(
				([key, value]) => value === undefined || key === "lumaprintsOrderNumber",
			);
		if (updates.lumaprintsOrderNumber !== undefined && auth.via === "auth") {
			throw new Error("LumaPrints order numbers require webhook authority");
		}
		if (updates.lumaprintsOrderNumber !== undefined && current?.printFulfillmentClaim) {
			if (
				!hasExactBaselineCompletionPayload
				|| !hasBaselinePrintCompletionClaim(current)
			) throw new Error("Fenced print fulfillment requires exact webhook completion");
			if (
				current.status !== "new"
				|| current.stripeRefundId !== undefined
				|| current.fulfillmentRecoveryStatus !== undefined
			) throw new Error("Refunded baseline completion requires GET reconciliation");
			await attachPrintFulfillmentResult(ctx, current, updates.lumaprintsOrderNumber, {
				reserveOrderConfirmation: true,
			});
			return null;
		}
		if (
			updates.lumaprintsOrderNumber !== undefined
			&& current?.printFulfillmentResolution === "resolved"
		) {
			if (current.lumaprintsOrderNumber !== updates.lumaprintsOrderNumber) {
				throw new Error("Print fulfillment result conflicts");
			}
			if (auth.via !== "auth" && hasExactBaselineCompletionPayload) {
				const owner = await findGlobalLumaPrintsOrder(ctx, updates.lumaprintsOrderNumber);
				if (!owner || owner._id !== current._id) {
					throw new Error("Print fulfillment result conflicts");
				}
				throw new Error("Resolved baseline print completion cannot be replayed");
			}
		}
		if (updates.lumaprintsOrderNumber !== undefined) {
			throw new Error("LumaPrints order number requires a claimed or resolved submission");
		}
		const isManualTerminal = current?.status === "refunded"
			&& current.stripeRefundId !== undefined
			&& current.fulfillmentRecoveryStatus === undefined;
		if (
			isManualTerminal
			&& (
				updates.status !== undefined && updates.status !== "refunded"
				|| updates.lumaprintsOrderNumber !== undefined
				|| updates.trackingNumber !== undefined
				|| updates.trackingUrl !== undefined
				|| updates.stripePaymentIntentId !== undefined
				|| updates.stripeFees !== undefined
				|| updates.fulfillmentError !== undefined
				|| updates.fulfillmentRecoveryStatus !== undefined
			)
		) throw new Error("Refunded order fulfillment is terminal");
		if (
			auth.via === "auth"
			&& current?.printFulfillmentClaim
			&& (updates.status !== undefined || updates.lumaprintsOrderNumber !== undefined)
		) throw new Error("Print fulfillment submission is in progress");
		if (refundUpdate && current?.printFulfillmentClaim && !current.lumaprintsOrderNumber) {
			throw new Error("Print fulfillment submission is in progress");
		}
		const patch: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(updates)) if (val !== undefined) patch[key] = val;
		if (updates.stripeFees !== undefined) {
			Object.assign(patch, {
				stripeFeeCurrency: undefined,
				stripeFeeChargeId: undefined,
				stripeFeeBalanceTransactionId: undefined,
				stripeFeeCapturedAt: undefined,
				stripeFeeProvenanceVersion: undefined,
				stripeFeeProvenance: "legacy_unverified",
				stripeFeeCaptureStatus: "legacy_unverified",
				stripeFeeCaptureNextAttemptAt: undefined,
				stripeFeeCaptureAttemptToken: undefined,
				stripeFeeCaptureError: undefined,
			});
		}
		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(orderId, patch);
		}
	},
});

/** Claim one best-effort customer payment-failure email attempt per signed event. */
export const claimPaymentFailureEmail = mutation({
	args: {
		stripeEventId: v.string(),
		stripeConnectedAccountId: v.optional(v.string()),
		webhookSecret: v.string(),
	},
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!STRIPE_EVENT_ID.test(args.stripeEventId)) throw new Error("Invalid Stripe event ID");
		if (
			args.stripeConnectedAccountId !== undefined &&
			!isStripeConnectedAccountId(args.stripeConnectedAccountId)
		)
			throw new Error("Invalid Stripe connected account ID");
		const accountScope = stripeAccountScope(args.stripeConnectedAccountId);
		const existing = await ctx.db
			.query("stripePaymentFailureEmailClaims")
			.withIndex("by_accountScope_and_stripeEventId", (q) =>
				q.eq("accountScope", accountScope).eq("stripeEventId", args.stripeEventId),
			)
			.unique();
		if (existing) return false;
		await ctx.db.insert("stripePaymentFailureEmailClaims", {
			accountScope,
			stripeEventId: args.stripeEventId,
			claimedAt: Date.now(),
		});
		return true;
	},
});

/**
 * @deprecated Compatibility export for authenticated site administrators only.
 * Hub shipment intake uses the provider-global V2 lease below.
 */
export const claimShipmentEmailNotification = mutation({
	args: {
		siteUrl: v.string(),
		lumaprintsOrderNumber: v.string(),
		webhookSecret: v.optional(v.string()),
		trackingNumber: v.optional(v.string()),
		trackingUrl: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ siteUrl, lumaprintsOrderNumber, webhookSecret: _deprecatedSecret, trackingNumber, trackingUrl },
	) => {
		await requireSiteAdmin(ctx, siteUrl);
		const matchingOrders = await ctx.db
			.query("orders")
			.withIndex("by_lumaprintsOrderNumber", (q) =>
				q.eq("siteUrl", siteUrl).eq("lumaprintsOrderNumber", lumaprintsOrderNumber),
			)
			.take(2);
		if (matchingOrders.length > 1) throw new Error("Duplicate LumaPrints order number");
		const order = matchingOrders[0];
		return order
			? await claimShipmentEmailForOrder(ctx, order, trackingNumber, trackingUrl)
			: null;
	},
});

/**
 * @deprecated Compatibility export for authenticated site administrators only.
 * Arbitrary legacy error text is accepted for call compatibility but never stored.
 */
export const recordShipmentEmailDelivery = mutation({
	args: {
		siteUrl: v.string(),
		lumaprintsOrderNumber: v.string(),
		webhookSecret: v.optional(v.string()),
		status: shipmentEmailDeliveryStatusValidator,
		error: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ siteUrl, lumaprintsOrderNumber, webhookSecret: _deprecatedSecret, status },
	) => {
		await requireSiteAdmin(ctx, siteUrl);
		const matchingOrders = await ctx.db
			.query("orders")
			.withIndex("by_lumaprintsOrderNumber", (q) =>
				q.eq("siteUrl", siteUrl).eq("lumaprintsOrderNumber", lumaprintsOrderNumber),
			)
			.take(2);
		if (matchingOrders.length > 1) throw new Error("Duplicate LumaPrints order number");
		const order = matchingOrders[0];
		return order ? await recordShipmentEmailForOrder(ctx, order, status) : null;
	},
});

/**
 * Lease the hub-owned shipment email side effect by provider-global order
 * number. A V2 row may be reclaimed after its lease expires; historical
 * shipped/claimed rows remain terminal because they lack V2 protocol evidence.
 */
export const claimShipmentEmailNotificationV2 = mutation({
	args: {
		lumaprintsOrderNumber: v.string(),
		claimToken: v.string(),
		webhookSecret: v.string(),
		trackingNumber: v.optional(v.string()),
		trackingUrl: v.optional(v.string()),
	},
	returns: v.union(
		v.object({
			kind: v.literal("claimed"),
			leaseExpiresAt: v.number(),
			order: v.object({
				_id: v.id("orders"),
				siteUrl: v.string(),
				orderNumber: v.string(),
				customerEmail: v.string(),
			}),
		}),
		v.object({ kind: v.literal("busy"), leaseExpiresAt: v.number() }),
		v.object({ kind: v.literal("completed") }),
		v.null(),
	),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!LUMAPRINTS_ORDER_NUMBER.test(args.lumaprintsOrderNumber)) {
			throw new Error("Invalid LumaPrints order number");
		}
		if (!CLAIM_TOKEN.test(args.claimToken)) {
			throw new Error("Invalid shipment email claim token");
		}
		const order = await findGlobalLumaPrintsOrder(ctx, args.lumaprintsOrderNumber);
		if (!order) return null;

		const trackingPatch = {
			...(args.trackingNumber === undefined ? {} : { trackingNumber: args.trackingNumber }),
			...(args.trackingUrl === undefined ? {} : { trackingUrl: args.trackingUrl }),
		};
		if (order.shipmentEmailNotificationProtocol !== SHIPMENT_EMAIL_NOTIFICATION_PROTOCOL) {
			if (
				order.shipmentEmailSentAt !== undefined
				|| !canClaimShipmentEmail(order.status)
			) {
				if (Object.keys(trackingPatch).length > 0) {
					await ctx.db.patch(order._id, trackingPatch);
				}
				return { kind: "completed" as const };
			}
		} else {
			if (order.shipmentEmailNotificationCompletedAt !== undefined) {
				if (Object.keys(trackingPatch).length > 0) {
					await ctx.db.patch(order._id, trackingPatch);
				}
				return { kind: "completed" as const };
			}
			if (order.status === "refunded" || order.status === "fulfillment_error") {
				if (Object.keys(trackingPatch).length > 0) {
					await ctx.db.patch(order._id, trackingPatch);
				}
				return { kind: "completed" as const };
			}
		}

		const firstAttemptAt = order.shipmentEmailNotificationClaimedAt;
		if (order.shipmentEmailDeliveryStatus === "uncertain") {
			if (Object.keys(trackingPatch).length > 0) {
				await ctx.db.patch(order._id, trackingPatch);
			}
			return { kind: "completed" as const };
		}
		const now = Date.now();
		if (
			order.shipmentEmailNotificationClaimToken !== undefined
			&& order.shipmentEmailNotificationLeaseExpiresAt !== undefined
			&& order.shipmentEmailNotificationLeaseExpiresAt > now
		) {
			return {
				kind: "busy" as const,
				leaseExpiresAt: order.shipmentEmailNotificationLeaseExpiresAt,
			};
		}
		if (
			order.shipmentEmailNotificationProtocol === SHIPMENT_EMAIL_NOTIFICATION_PROTOCOL
			&& order.shipmentEmailNotificationRetryProtocol !== "bounded_23h_v1"
		) {
			await ctx.db.patch(order._id, {
				...trackingPatch,
				shipmentEmailNotificationClaimToken: undefined,
				shipmentEmailNotificationLeaseExpiresAt: undefined,
				shipmentEmailDeliveryStatus: "uncertain",
				shipmentEmailDeliveryAttemptedAt: now,
				shipmentEmailDeliveryError: "completion_checkpoint_unconfirmed",
			});
			return { kind: "completed" as const };
		}
		if (firstAttemptAt !== undefined && now - firstAttemptAt >= EMAIL_AUTOMATIC_RETRY_WINDOW_MS) {
			await ctx.db.patch(order._id, {
				...trackingPatch,
				shipmentEmailNotificationClaimToken: undefined,
				shipmentEmailNotificationLeaseExpiresAt: undefined,
				shipmentEmailDeliveryStatus: "uncertain",
				shipmentEmailDeliveryAttemptedAt: now,
				shipmentEmailDeliveryError: "completion_checkpoint_unconfirmed",
			});
			return { kind: "completed" as const };
		}
		const leaseExpiresAt = now + SHIPMENT_EMAIL_NOTIFICATION_LEASE_MS;
		await ctx.db.patch(order._id, {
			...trackingPatch,
			status: canClaimShipmentEmail(order.status) ? "shipped" : order.status,
			shipmentEmailNotificationProtocol: SHIPMENT_EMAIL_NOTIFICATION_PROTOCOL,
			shipmentEmailNotificationRetryProtocol: "bounded_23h_v1",
			shipmentEmailNotificationClaimedAt: firstAttemptAt ?? now,
			shipmentEmailNotificationClaimToken: args.claimToken,
			shipmentEmailNotificationLeaseExpiresAt: leaseExpiresAt,
			shipmentEmailDeliveryStatus: "pending",
			shipmentEmailDeliveryError: undefined,
		});
		return {
			kind: "claimed" as const,
			leaseExpiresAt,
			order: {
				_id: order._id,
				siteUrl: order.siteUrl,
				orderNumber: order.orderNumber,
				customerEmail: order.customerEmail,
			},
		};
	},
});

/** Read shipment-email uncertainty without widening the V2 claim result. */
export const isShipmentEmailNotificationDeliveryUncertain = mutation({
	args: {
		lumaprintsOrderNumber: v.string(),
		webhookSecret: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!LUMAPRINTS_ORDER_NUMBER.test(args.lumaprintsOrderNumber)) {
			throw new Error("Invalid LumaPrints order number");
		}
		const order = await findGlobalLumaPrintsOrder(ctx, args.lumaprintsOrderNumber);
		return order?.shipmentEmailDeliveryStatus === "uncertain";
	},
});

/** Recheck a shipment-email lease immediately before the email request. */
export const authorizeShipmentEmailNotificationSendV2 = mutation({
	args: {
		orderId: v.id("orders"),
		lumaprintsOrderNumber: v.string(),
		claimToken: v.string(),
		webhookSecret: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!LUMAPRINTS_ORDER_NUMBER.test(args.lumaprintsOrderNumber)) {
			throw new Error("Invalid LumaPrints order number");
		}
		if (!CLAIM_TOKEN.test(args.claimToken)) {
			throw new Error("Invalid shipment email claim token");
		}
		const order = await ctx.db.get(args.orderId);
		if (
			!order
			|| order.lumaprintsOrderNumber !== args.lumaprintsOrderNumber
			|| order.shipmentEmailNotificationProtocol !== SHIPMENT_EMAIL_NOTIFICATION_PROTOCOL
			|| order.shipmentEmailNotificationRetryProtocol !== "bounded_23h_v1"
			|| order.shipmentEmailNotificationCompletedAt !== undefined
			|| order.shipmentEmailDeliveryStatus === "uncertain"
			|| order.status === "refunded"
			|| order.status === "fulfillment_error"
			|| order.shipmentEmailNotificationClaimToken !== args.claimToken
		) return false;
		const now = Date.now();
		const firstAttemptAt = order.shipmentEmailNotificationClaimedAt;
		if (firstAttemptAt === undefined) return false;
		if (now - firstAttemptAt >= EMAIL_AUTOMATIC_RETRY_WINDOW_MS) {
			await ctx.db.patch(order._id, {
				shipmentEmailNotificationClaimedAt: firstAttemptAt,
				shipmentEmailNotificationClaimToken: undefined,
				shipmentEmailNotificationLeaseExpiresAt: undefined,
				shipmentEmailDeliveryStatus: "uncertain",
				shipmentEmailDeliveryAttemptedAt: now,
				shipmentEmailDeliveryError: "completion_checkpoint_unconfirmed",
			});
			return false;
		}
		return order.shipmentEmailNotificationLeaseExpiresAt !== undefined
			&& order.shipmentEmailNotificationLeaseExpiresAt > now;
	},
});

/** Release only the caller's unsent V2 shipment-email lease. */
export const releaseShipmentEmailNotificationV2 = mutation({
	args: {
		orderId: v.id("orders"),
		lumaprintsOrderNumber: v.string(),
		claimToken: v.string(),
		failureCode: shipmentEmailDeliveryFailureCodeValidator,
		webhookSecret: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!LUMAPRINTS_ORDER_NUMBER.test(args.lumaprintsOrderNumber)) {
			throw new Error("Invalid LumaPrints order number");
		}
		if (!CLAIM_TOKEN.test(args.claimToken)) {
			throw new Error("Invalid shipment email claim token");
		}
		const order = await ctx.db.get(args.orderId);
		if (
			!order
			|| order.lumaprintsOrderNumber !== args.lumaprintsOrderNumber
			|| order.shipmentEmailNotificationProtocol !== SHIPMENT_EMAIL_NOTIFICATION_PROTOCOL
			|| order.shipmentEmailNotificationCompletedAt !== undefined
			|| order.shipmentEmailNotificationClaimToken !== args.claimToken
		) return false;
		await ctx.db.patch(order._id, {
			shipmentEmailNotificationClaimToken: undefined,
			shipmentEmailNotificationLeaseExpiresAt: undefined,
			shipmentEmailDeliveryStatus: "failed",
			shipmentEmailDeliveryAttemptedAt: Date.now(),
			shipmentEmailDeliveryError: args.failureCode,
		});
		return true;
	},
});

/** Complete only the caller's successfully sent V2 shipment-email lease. */
export const completeShipmentEmailNotificationV2 = mutation({
	args: {
		orderId: v.id("orders"),
		lumaprintsOrderNumber: v.string(),
		claimToken: v.string(),
		deliveryStatus: v.union(v.literal("sent"), v.literal("skipped")),
		webhookSecret: v.string(),
	},
	returns: v.boolean(),
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!LUMAPRINTS_ORDER_NUMBER.test(args.lumaprintsOrderNumber)) {
			throw new Error("Invalid LumaPrints order number");
		}
		if (!CLAIM_TOKEN.test(args.claimToken)) {
			throw new Error("Invalid shipment email claim token");
		}
		const order = await ctx.db.get(args.orderId);
		if (
			!order
			|| order.lumaprintsOrderNumber !== args.lumaprintsOrderNumber
			|| order.shipmentEmailNotificationProtocol !== SHIPMENT_EMAIL_NOTIFICATION_PROTOCOL
			|| order.shipmentEmailNotificationCompletedAt !== undefined
			|| order.shipmentEmailNotificationClaimToken !== args.claimToken
		) return false;
		const now = Date.now();
		await ctx.db.patch(order._id, {
			shipmentEmailNotificationClaimToken: undefined,
			shipmentEmailNotificationLeaseExpiresAt: undefined,
			shipmentEmailNotificationCompletedAt: now,
			shipmentEmailSentAt: args.deliveryStatus === "sent" ? now : undefined,
			shipmentEmailDeliveryStatus: args.deliveryStatus,
			shipmentEmailDeliveryAttemptedAt: now,
			shipmentEmailDeliveryError: undefined,
		});
		return true;
	},
});

async function lookupCustomerOrder(
	ctx: QueryCtx,
	{
		siteUrl,
		email,
		orderNumber,
	}: { siteUrl: string; email: string; orderNumber: string },
) {
	const matchingOrders = await ctx.db
		.query("orders")
		.withIndex("by_orderNumber", (q) =>
			q.eq("siteUrl", siteUrl).eq("orderNumber", orderNumber),
		)
		.take(2);
	if (matchingOrders.length > 1) {
		throw new Error("Duplicate order number for tenant");
	}

	const order = matchingOrders[0];
	if (!order || order.customerEmail.toLowerCase() !== email.toLowerCase()) {
		return null;
	}

	return {
		orderNumber: order.orderNumber,
		status: order.status,
		items: order.items,
		total: order.total,
		trackingNumber: order.trackingNumber,
		trackingUrl: order.trackingUrl,
	};
}

/** Hub-only customer order lookup. Never distribute its capability to a spoke. */
export const lookupForCustomer = query({
	args: {
		siteUrl: v.string(),
		email: v.string(),
		orderNumber: v.string(),
		lookupSecret: v.string(),
	},
	handler: async (ctx, { siteUrl, email, orderNumber, lookupSecret }) => {
		requireOrderLookupCaller(lookupSecret);
		return await lookupCustomerOrder(ctx, { siteUrl, email, orderNumber });
	},
});

/** @deprecated Authenticated-admin-only site-scoped shipment lookup compatibility export. */
export const getByLumaprintsOrderNumber = query({
	args: {
		siteUrl: v.string(),
		lumaprintsOrderNumber: v.string(),
		webhookSecret: v.optional(v.string()),
	},
	handler: async (ctx, { siteUrl, lumaprintsOrderNumber, webhookSecret: _deprecatedSecret }) => {
		await requireSiteAdmin(ctx, siteUrl);
		if (!LUMAPRINTS_ORDER_NUMBER.test(lumaprintsOrderNumber)) return null;
		const matchingOrders = await ctx.db
			.query("orders")
			.withIndex("by_lumaprintsOrderNumber", (q) =>
				q.eq("siteUrl", siteUrl).eq("lumaprintsOrderNumber", lumaprintsOrderNumber),
			)
			.take(2);
		if (matchingOrders.length > 1) throw new Error("Duplicate LumaPrints order number");
		const order = matchingOrders[0];
		return order
			? {
					_id: order._id,
					orderNumber: order.orderNumber,
					status: order.status,
					customerEmail: order.customerEmail,
					trackingNumber: order.trackingNumber,
					trackingUrl: order.trackingUrl,
				}
			: null;
	},
});

export const getStats = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl);
		const rowsWithSentinel = await ctx.db
			.query("orders")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(AGGREGATE_SCAN_LIMIT + 1);
		const { orders, isTruncated } = resolveBoundedOrderStatsScan(
			rowsWithSentinel,
			AGGREGATE_SCAN_LIMIT,
		);

		const now = new Date();
		const todayStart = new Date(
			now.getFullYear(),
			now.getMonth(),
			now.getDate(),
		);
		const weekStart = new Date(todayStart);
		weekStart.setDate(todayStart.getDate() - todayStart.getDay());
		const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

		let todayRevenue = 0;
		let weekRevenue = 0;
		let monthRevenue = 0;
		let allTimeRevenue = 0;
		const grossPaymentsByCurrency = new Map<string, {
			todayMinorUnits: number;
			weekMinorUnits: number;
			monthMinorUnits: number;
			allTimeMinorUnits: number;
		}>();
		const grossPaymentOrderCounts = new Map<string, number>();
		const invalidAggregateCurrencies = new Set<string>();
		let unknownCurrencyOrderCount = 0;
		let invalidGrossAmountOrderCount = 0;

		// Build daily revenue map for last 30 days
		const dailyRevenueMap = new Map<string, number>();
		const dailyGrossPaymentsByCurrency = new Map<string, Map<string, number>>();
		for (let i = 29; i >= 0; i--) {
			const d = new Date(todayStart);
			d.setDate(d.getDate() - i);
			dailyRevenueMap.set(d.toISOString().split("T")[0], 0);
		}

		for (const order of orders) {
			const total = order.total;
			allTimeRevenue += total;

			const orderDate = new Date(order._creationTime);
			if (orderDate >= todayStart) todayRevenue += total;
			if (orderDate >= weekStart) weekRevenue += total;
			if (orderDate >= monthStart) monthRevenue += total;

			if (!isStripeCurrency(order.stripePaymentCurrency)) {
				unknownCurrencyOrderCount += 1;
			} else if (!isNonnegativeSafeInteger(total)) {
				invalidGrossAmountOrderCount += 1;
			} else if (invalidAggregateCurrencies.has(order.stripePaymentCurrency)) {
				invalidGrossAmountOrderCount += 1;
			} else {
				const grouped = grossPaymentsByCurrency.get(order.stripePaymentCurrency) ?? {
					todayMinorUnits: 0,
					weekMinorUnits: 0,
					monthMinorUnits: 0,
					allTimeMinorUnits: 0,
				};
				const next = {
					allTimeMinorUnits: grouped.allTimeMinorUnits + total,
					todayMinorUnits: grouped.todayMinorUnits
						+ (orderDate >= todayStart ? total : 0),
					weekMinorUnits: grouped.weekMinorUnits
						+ (orderDate >= weekStart ? total : 0),
					monthMinorUnits: grouped.monthMinorUnits
						+ (orderDate >= monthStart ? total : 0),
				};
				if (Object.values(next).every(isNonnegativeSafeInteger)) {
					grossPaymentsByCurrency.set(order.stripePaymentCurrency, next);
					grossPaymentOrderCounts.set(
						order.stripePaymentCurrency,
						(grossPaymentOrderCounts.get(order.stripePaymentCurrency) ?? 0) + 1,
					);
				} else {
					invalidGrossAmountOrderCount +=
						(grossPaymentOrderCounts.get(order.stripePaymentCurrency) ?? 0) + 1;
					grossPaymentsByCurrency.delete(order.stripePaymentCurrency);
					grossPaymentOrderCounts.delete(order.stripePaymentCurrency);
					invalidAggregateCurrencies.add(order.stripePaymentCurrency);
				}
			}

			const dateKey = orderDate.toISOString().split("T")[0];
			if (dailyRevenueMap.has(dateKey)) {
				dailyRevenueMap.set(
					dateKey,
					(dailyRevenueMap.get(dateKey) || 0) + total,
				);
			}
			if (
				dailyRevenueMap.has(dateKey)
				&& isStripeCurrency(order.stripePaymentCurrency)
				&& isNonnegativeSafeInteger(total)
			) {
				const dailyForCurrency = dailyGrossPaymentsByCurrency.get(
					order.stripePaymentCurrency,
				) ?? new Map<string, number>();
				dailyForCurrency.set(dateKey, (dailyForCurrency.get(dateKey) ?? 0) + total);
				dailyGrossPaymentsByCurrency.set(order.stripePaymentCurrency, dailyForCurrency);
			}
		}

		const dailyRevenue = Array.from(dailyRevenueMap.entries()).map(
			([date, amount]) => ({ date, amount }),
		);
		const currencies = [...grossPaymentsByCurrency.keys()].sort();
		const grossPayments = currencies.map((currency) => ({
			currency,
			orderCount: grossPaymentOrderCounts.get(currency) ?? 0,
			...grossPaymentsByCurrency.get(currency)!,
		}));
		const dailyGrossPayments = currencies.flatMap((currency) =>
			[...dailyRevenueMap.keys()].map((date) => ({
				date,
				currency,
				amountMinorUnits: dailyGrossPaymentsByCurrency.get(currency)?.get(date) ?? 0,
			})),
		);
		const legacyRevenueCurrency = currencies.length === 1
			&& unknownCurrencyOrderCount === 0
			&& invalidGrossAmountOrderCount === 0
			? currencies[0]
			: undefined;

		const recentOrders = orders.slice(0, 10).map((order) => ({
			_id: order._id,
			orderNumber: order.orderNumber,
			createdAt: new Date(order._creationTime).toISOString(),
			customerEmail: order.customerEmail,
			customerName: order.customerName || "",
			total: order.total,
			stripePaymentCurrency: order.stripePaymentCurrency,
			stripeFees: order.stripeFees,
			stripeFeeCurrency: order.stripeFeeCurrency,
			stripeFeeChargeId: order.stripeFeeChargeId,
			stripeFeeBalanceTransactionId: order.stripeFeeBalanceTransactionId,
			stripeFeeCapturedAt: order.stripeFeeCapturedAt,
			stripeFeeProvenanceVersion: order.stripeFeeProvenanceVersion,
			stripeFeeProvenance: order.stripeFeeProvenance,
			stripeFeeCaptureStatus: order.stripeFeeCaptureStatus,
			stripeFeeCaptureAttempts: order.stripeFeeCaptureAttempts,
			stripeFeeCaptureLastAttemptAt: order.stripeFeeCaptureLastAttemptAt,
			stripeFeeCaptureNextAttemptAt: order.stripeFeeCaptureNextAttemptAt,
			stripeFeeCaptureError: order.stripeFeeCaptureError,
			status: order.status,
		}));

		return {
			stats: {
				todayRevenue,
				weekRevenue,
				monthRevenue,
				// Legacy field names are preserved for compatible clients. Consumers
				// must use isTruncated before presenting these values as complete.
				allTimeRevenue,
				totalOrders: orders.length,
				isTruncated,
				scanLimit: AGGREGATE_SCAN_LIMIT,
				legacyRevenueCurrency,
				legacyRevenueCurrencyUnsafe: legacyRevenueCurrency === undefined,
			},
			dailyRevenue,
			grossPayments,
			dailyGrossPayments,
			unknownCurrencyOrderCount,
			invalidGrossAmountOrderCount,
			recentOrders,
		};
	},
});

export const getNextOrderNumber = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl);
		return generateNextOrderNumber(ctx, siteUrl);
	},
});
