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
	canonicalReservationSnapshotDigest,
	checkoutSnapshotValidator,
	isBoundedStripeExpiration,
	isStripeCheckoutSessionId,
	isStripeConnectedAccountId,
	parseReservationCandidate,
	reservedCheckoutSnapshotValidator,
	reservationHandleHash,
	stripeAccountScope,
} from "./helpers/checkoutSnapshot";
import { AGGREGATE_SCAN_LIMIT, BULK_SCAN_LIMIT } from "./helpers/limits";
import { getNextOrderNumber as generateNextOrderNumber } from "./helpers/numbering";
import { resolveBoundedOrderStatsScan } from "./helpers/orderStats";
import { FEE_CAPTURE_INITIAL_DELAY_MS } from "./helpers/stripeFeeCapture";
import { historicalReservationCloseoutEvidence } from "./historicalReservationCloseoutEvidence";

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

const fulfillmentRecoveryStatusValidator = v.union(
	v.literal("refund_pending"),
	v.literal("refunded"),
);

const manualRefundRecoveryProviderEvidenceValidator = v.object({
	verifiedAt: v.number(),
	currentRefundStatus: v.literal("succeeded"),
	currentRefundHasAutomatedMetadata: v.literal(false),
	currentRefundHasRecoveryAuditMetadata: v.literal(false),
	paymentIntentStatus: v.literal("succeeded"),
	paymentIntentAmount: v.number(),
	paymentIntentAmountReceived: v.number(),
	paymentIntentCurrency: v.literal("usd"),
	paymentIntentLivemode: v.literal(true),
	paymentIntentLatestChargeId: v.string(),
	sessionMode: v.literal("payment"),
	sessionStatus: v.literal("complete"),
	sessionPaymentStatus: v.literal("paid"),
});

const manualRefundReconciliationResultValidator = v.union(
	v.object({ kind: v.literal("reconciled") }),
	v.object({ kind: v.literal("replayed") }),
	v.object({ kind: v.literal("pending_order") }),
	v.object({
		kind: v.literal("rejected"),
		reason: v.union(v.literal("identity_conflict"), v.literal("state_conflict")),
	}),
);

type ManualRefundReconciliationResult =
	| { kind: "reconciled" }
	| { kind: "replayed" }
	| { kind: "pending_order" }
	| { kind: "rejected"; reason: "identity_conflict" | "state_conflict" };

const STRIPE_EVENT_ID = /^evt_[A-Za-z0-9]{8,120}$/;
const STRIPE_REFUND_ID = /^re_[A-Za-z0-9]{8,120}$/;
const STRIPE_PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9]{8,120}$/;
const STRIPE_CHARGE_ID = /^ch_[A-Za-z0-9]{8,120}$/;
const MANUAL_REFUND_RECOVERY_ID = /^[a-z0-9][a-z0-9_-]{7,127}$/;
const STRIPE_EVENT_API_VERSION = "2026-01-28.clover";
const MANUAL_REFUND_RECOVERY_MANIFEST = {
	recoveryId: "angelsrest-refund-event-selection-gap-v1",
	manifestVersion: 1,
	convexUrl: "https://loyal-swan-967.convex.cloud",
	siteUrl: "angelsrest.online",
	stripeContext: "acct_1SzVXnEdZA9bU4XS",
	stripeEventId: "evt_3TzgMtEdZA9bU4XS1UakYelP",
	stripeEventType: "refund.updated",
	stripeEventApiVersion: STRIPE_EVENT_API_VERSION,
	stripeRefundId: "re_3TzgMtEdZA9bU4XS18G1xdUE",
	stripeChargeId: "ch_3TzgMtEdZA9bU4XS16dVR60J",
	stripePaymentIntentId: "pi_3TzgMtEdZA9bU4XS1mivC9KA",
	stripeSessionId: "cs_live_a1F5xkFjDxDIQ3Qjikpdo3Oo4OEwwM2jfpiAP589tBByIWZ5iDBLIBzlL0",
	stripeTenantMetadataSiteUrl: "angelsrest.online",
	amount: 1500,
	currency: "usd",
	livemode: true,
} as const;
const CHECKOUT_RESERVATION_CLOSEOUT_MANIFEST = {
	closeoutId: "angelsrest-historical-reservation-closeout-v1",
	convexUrl: MANUAL_REFUND_RECOVERY_MANIFEST.convexUrl,
	siteUrl: MANUAL_REFUND_RECOVERY_MANIFEST.siteUrl,
	recoveryId: MANUAL_REFUND_RECOVERY_MANIFEST.recoveryId,
} as const;

const MANUAL_REFUND_RECOVERY_FAILED_CHECKS = new Set([
	"event.id",
	"event.type",
	"event.api_version",
	"event.livemode",
	"event.account",
	"event.context",
	"event.object",
	"event_refund.id",
	"event_refund.status",
	"event_refund.amount",
	"event_refund.currency",
	"event_refund.charge",
	"event_refund.payment_intent",
	"event_refund.automated_metadata",
	"current_refund.id",
	"current_refund.status",
	"current_refund.amount",
	"current_refund.currency",
	"current_refund.charge",
	"current_refund.payment_intent",
	"current_refund.automated_metadata",
	"current_refund.recovery_audit_metadata",
	"payment_intent.id",
	"payment_intent.status",
	"payment_intent.amount",
	"payment_intent.amount_received",
	"payment_intent.currency",
	"payment_intent.livemode",
	"payment_intent.latest_charge",
	"session.reconciliation",
]);

function assertCheckoutReservationCloseoutEnabled() {
	if (
		process.env.CHECKOUT_RESERVATION_CLOSEOUT_ID
			!== CHECKOUT_RESERVATION_CLOSEOUT_MANIFEST.closeoutId
		|| process.env.CONVEX_CLOUD_URL !== CHECKOUT_RESERVATION_CLOSEOUT_MANIFEST.convexUrl
	) throw new Error("Checkout reservation closeout is disabled");
}

function assertManualRefundRecoveryEnabled() {
	if (
		process.env.STRIPE_REFUND_RECOVERY_ID !== MANUAL_REFUND_RECOVERY_MANIFEST.recoveryId
		|| process.env.CONVEX_CLOUD_URL !== MANUAL_REFUND_RECOVERY_MANIFEST.convexUrl
	) throw new Error("Manual refund recovery is disabled");
}

function isExactManualRefundRecoveryManifest(args: {
	recoveryId: string;
	manifestVersion: number;
	siteUrl: string;
	stripeContext: string;
	stripeEventId: string;
	stripeEventType: "refund.updated";
	stripeEventApiVersion: string;
	stripeRefundId: string;
	stripeChargeId: string;
	stripePaymentIntentId: string;
	stripeSessionId: string;
	stripeTenantMetadataSiteUrl: string;
	amount: number;
	currency: "usd";
	livemode: boolean;
}) {
	const manifest = MANUAL_REFUND_RECOVERY_MANIFEST;
	return args.recoveryId === manifest.recoveryId
		&& args.manifestVersion === manifest.manifestVersion
		&& args.siteUrl === manifest.siteUrl
		&& args.stripeContext === manifest.stripeContext
		&& args.stripeEventId === manifest.stripeEventId
		&& args.stripeEventType === manifest.stripeEventType
		&& args.stripeEventApiVersion === manifest.stripeEventApiVersion
		&& args.stripeRefundId === manifest.stripeRefundId
		&& args.stripeChargeId === manifest.stripeChargeId
		&& args.stripePaymentIntentId === manifest.stripePaymentIntentId
		&& args.stripeSessionId === manifest.stripeSessionId
		&& args.stripeTenantMetadataSiteUrl === manifest.stripeTenantMetadataSiteUrl
		&& args.amount === manifest.amount
		&& args.currency === manifest.currency
		&& args.livemode === manifest.livemode;
}
const CLAIM_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PRINT_PREPARATION_LEASE_MS = 15 * 60 * 1000;

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

async function claimShipmentEmailForOrder(
	ctx: MutationCtx,
	order: Doc<"orders">,
	trackingNumber?: string,
	trackingUrl?: string,
) {
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
	const patch: Record<string, unknown> = {
		shipmentEmailDeliveryStatus: status,
		shipmentEmailDeliveryAttemptedAt: Date.now(),
	};
	if (status === "failed") patch.shipmentEmailDeliveryError = normalizeDeliveryError(error);
	else patch.shipmentEmailDeliveryError = undefined;

	await ctx.db.patch(order._id, patch);
	return {
		recorded: true,
		order: { _id: order._id, siteUrl: order.siteUrl, orderNumber: order.orderNumber },
	};
}

function truncateDeliveryError(error: string) {
	return error.length > 1000 ? `${error.slice(0, 997)}...` : error;
}

function normalizeDeliveryError(error: string | undefined) {
	return truncateDeliveryError(error || "Shipment email delivery failed without error detail");
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

function routingConflict(): never {
	throw new Error("Checkout routing facts conflict");
}

export const reserveCheckoutSnapshot = internalMutation({
	args: {
		siteUrl: v.string(), handleHash: v.string(), snapshotDigest: v.string(),
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
		const existing = await ctx.db.query("checkoutSnapshotReservations")
			.withIndex("by_siteUrl_and_handleHash", (q) => q.eq("siteUrl", args.siteUrl).eq("handleHash", args.handleHash)).unique();
		const accountScope = stripeAccountScope(args.stripeConnectedAccountId);
		if (existing) {
			const replayed = existing.snapshotDigest === args.snapshotDigest
				&& JSON.stringify(existing.snapshot) === JSON.stringify(args.snapshot)
				&& existing.accountScope === accountScope
				&& existing.stripeConnectedAccountId === args.stripeConnectedAccountId;
			return { outcome: replayed ? "replayed" as const : "conflict" as const };
		}
		const createdAt = Date.now();
		const unboundPurgeAt = createdAt + UNBOUND_RETENTION_MS;
		const reservationId = await ctx.db.insert("checkoutSnapshotReservations", {
			state: "reserved", siteUrl: args.siteUrl, handleHash: args.handleHash,
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
		siteUrl: v.string(), handleHash: v.string(), stripeConnectedAccountId: v.optional(v.string()),
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
		const row = await ctx.db.query("checkoutSnapshotReservations")
			.withIndex("by_siteUrl_and_handleHash", (q) => q.eq("siteUrl", args.siteUrl).eq("handleHash", args.handleHash)).unique();
		if (!row) return { outcome: "not_found" as const };
		const accountScope = stripeAccountScope(args.stripeConnectedAccountId);
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
) {
	const handle = parseReservationCandidate(candidate);
	if (!handle) throw new Error("Invalid checkout snapshot reservation");
	const handleHash = await reservationHandleHash(siteUrl, handle);
	const row = await ctx.db.query("checkoutSnapshotReservations")
		.withIndex("by_siteUrl_and_handleHash", (q) => q.eq("siteUrl", siteUrl).eq("handleHash", handleHash)).unique();
	if (!row || row.state !== "bound" || row.accountScope !== stripeAccountScope(stripeConnectedAccountId)
		|| row.stripeSessionId !== stripeSessionId || row.snapshot.items.length !== itemCount) {
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
		return row?.state === "bound" && row.boundAt === args.boundAt
			&& row.reconciliationAttempt === args.attempt && row.reconciliationAlertedAt === undefined
			&& row.reconciliationNextAt !== undefined && Date.now() >= row.reconciliationNextAt ? {
				stripeSessionId: row.stripeSessionId!, stripeConnectedAccountId: row.stripeConnectedAccountId,
			} : null;
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
		checkoutSnapshot: v.optional(checkoutSnapshotValidator),
		// Unknown by design: an existing paid order must win before a malformed V2 candidate is interpreted.
		checkoutSnapshotReservation: v.optional(v.any()),
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
		const { webhookSecret: _discard, checkoutSnapshotReservation, ...rest } = args;
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
				checkoutSnapshot: existing.checkoutSnapshot,
			};
		}

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

		let orderInput = rest;
		if (checkoutSnapshotReservation !== undefined) {
			if (rest.checkoutSnapshot !== undefined) throw new Error("Checkout snapshot input is ambiguous");
			const checkoutSnapshot = await consumeReservation(
				ctx, args.siteUrl, args.stripeSessionId, args.stripeConnectedAccountId,
				args.items.length, checkoutSnapshotReservation as unknown,
			);
			orderInput = {
				...rest,
				checkoutSnapshot,
				fulfillmentType: checkoutSnapshot.items.every(
					({ productKind }) => productKind === "digital_download",
				) ? "digital" : rest.fulfillmentType,
			};
		}

		// Use provided order number or generate one atomically
		const orderNumber = args.orderNumber || (await generateNextOrderNumber(ctx, args.siteUrl));

		const isManuallyRefunded = refundIntent !== null;
		const feeCaptureScheduledAt = !isManuallyRefunded && orderInput.stripePaymentIntentId
			? Date.now() + FEE_CAPTURE_INITIAL_DELAY_MS
			: undefined;
		const _id = await ctx.db.insert("orders", {
			...orderInput,
			orderNumber,
			status: isManuallyRefunded ? "refunded" : "new",
			stripeRefundId: refundIntent?.stripeRefundId,
			stripeFeeCaptureStatus: isManuallyRefunded && orderInput.stripePaymentIntentId
				? "canceled"
				: feeCaptureScheduledAt !== undefined ? "pending" : undefined,
			stripeFeeCaptureAttempts: orderInput.stripePaymentIntentId ? 0 : undefined,
			stripeFeeCaptureNextAttemptAt: feeCaptureScheduledAt,
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
			stripeFeeCaptureStatus: isManuallyRefunded && orderInput.stripePaymentIntentId
				? ("canceled" as const)
				: feeCaptureScheduledAt !== undefined ? ("pending" as const) : undefined,
			stripeFeeCaptureAttempts: orderInput.stripePaymentIntentId ? 0 : undefined,
			stripeFeeCaptureLastAttemptAt: undefined,
			stripeFeeCaptureNextAttemptAt: feeCaptureScheduledAt,
			stripeFeeCaptureError: undefined,
			fulfillmentError: undefined,
			stripeRefundId: refundIntent?.stripeRefundId,
			fulfillmentRecoveryStatus: undefined,
			checkoutSnapshot: orderInput.checkoutSnapshot,
		};
	},
});

/** Authenticated-site-admin plus webhook-secret one-use recovery claim. */
export const claimManualRefundRecovery = mutation({
	args: {
		webhookSecret: v.string(),
		recoveryId: v.string(),
		manifestVersion: v.number(),
		siteUrl: v.string(),
		stripeContext: v.string(),
		stripeEventId: v.string(),
		stripeEventType: v.literal("refund.updated"),
		stripeEventApiVersion: v.string(),
		stripeRefundId: v.string(),
		stripeChargeId: v.string(),
		stripePaymentIntentId: v.string(),
		stripeSessionId: v.string(),
		stripeTenantMetadataSiteUrl: v.string(),
		amount: v.number(),
		currency: v.literal("usd"),
		livemode: v.boolean(),
	},
	returns: v.object({ claimed: v.boolean() }),
	handler: async (ctx, args) => {
		assertManualRefundRecoveryEnabled();
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const { identity } = await requireSiteAdmin(ctx, args.siteUrl);
		if (
			!isExactManualRefundRecoveryManifest(args)
			|| !MANUAL_REFUND_RECOVERY_ID.test(args.recoveryId)
			|| args.manifestVersion !== 1
			|| args.siteUrl.length === 0
			|| args.siteUrl.length > 253
			|| !isStripeConnectedAccountId(args.stripeContext)
			|| !STRIPE_EVENT_ID.test(args.stripeEventId)
			|| args.stripeEventApiVersion !== STRIPE_EVENT_API_VERSION
			|| !STRIPE_REFUND_ID.test(args.stripeRefundId)
			|| !STRIPE_CHARGE_ID.test(args.stripeChargeId)
			|| !STRIPE_PAYMENT_INTENT_ID.test(args.stripePaymentIntentId)
			|| !isStripeCheckoutSessionId(args.stripeSessionId)
			|| args.stripeTenantMetadataSiteUrl !== args.siteUrl
			|| !Number.isSafeInteger(args.amount)
			|| args.amount <= 0
			|| !args.livemode
		) throw new Error("Invalid manual refund recovery claim");

		const existing = await ctx.db.query("manualRefundRecoveries")
			.withIndex("by_recoveryId", (q) => q.eq("recoveryId", args.recoveryId))
			.unique();
		if (existing) return { claimed: false };
		const { webhookSecret: _discard, ...evidence } = args;
		await ctx.db.insert("manualRefundRecoveries", {
			...evidence,
			state: "claimed",
			claimedByTokenIdentifier: identity.tokenIdentifier,
			claimedAt: Date.now(),
		});
		return { claimed: true };
	},
});

/** Record a provider/evidence failure without making the one-use claim reusable. */
export const failManualRefundRecovery = mutation({
	args: {
		webhookSecret: v.string(),
		recoveryId: v.string(),
		siteUrl: v.string(),
		resultReason: v.string(),
		failureStage: v.union(v.literal("provider_evidence"), v.literal("execution")),
		providerFailureObservations: v.optional(v.object({
			observedAt: v.number(),
			failedChecks: v.array(v.string()),
		})),
	},
	returns: v.object({ completed: v.boolean() }),
	handler: async (ctx, args) => {
		assertManualRefundRecoveryEnabled();
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const { identity } = await requireSiteAdmin(ctx, args.siteUrl);
		if (
			args.recoveryId !== MANUAL_REFUND_RECOVERY_MANIFEST.recoveryId
			|| args.siteUrl !== MANUAL_REFUND_RECOVERY_MANIFEST.siteUrl
			|| !MANUAL_REFUND_RECOVERY_ID.test(args.recoveryId)
			|| args.resultReason.length === 0
			|| args.resultReason.length > 160
		) throw new Error("Invalid manual refund recovery failure");
		const recovery = await ctx.db.query("manualRefundRecoveries")
			.withIndex("by_recoveryId", (q) => q.eq("recoveryId", args.recoveryId))
			.unique();
		if (
			!recovery
			|| recovery.siteUrl !== args.siteUrl
			|| recovery.state !== "claimed"
			|| recovery.claimedByTokenIdentifier !== identity.tokenIdentifier
		) return { completed: false };
		const observations = args.providerFailureObservations;
		if (
			observations
			&& (
				!Number.isSafeInteger(observations.observedAt)
				|| observations.observedAt < recovery.claimedAt
				|| observations.observedAt > Date.now() + 300_000
				|| observations.failedChecks.length === 0
				|| observations.failedChecks.length > MANUAL_REFUND_RECOVERY_FAILED_CHECKS.size
				|| observations.failedChecks.some(
					(check) => !MANUAL_REFUND_RECOVERY_FAILED_CHECKS.has(check),
				)
			)
		) throw new Error("Invalid manual refund recovery observations");
		await ctx.db.patch(recovery._id, {
			state: "completed",
			completedAt: Date.now(),
			resultKind: "failed",
			resultReason: args.resultReason,
			failureStage: args.failureStage,
			providerFailureObservations: observations,
		});
		return { completed: true };
	},
});

/**
 * Stripe-webhook-only projection for one full, succeeded manual refund.
 * The signed hub handler verifies provider evidence before this transaction.
 */
export const reconcileSucceededManualRefund = mutation({
	args: {
		webhookSecret: v.string(),
		refundRecoveryId: v.optional(v.string()),
		refundRecoveryManifestVersion: v.optional(v.number()),
		refundRecoveryStripeContext: v.optional(v.string()),
		refundRecoveryEventApiVersion: v.optional(v.string()),
		refundRecoveryProviderEvidence: v.optional(manualRefundRecoveryProviderEvidenceValidator),
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
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const recoveryId = args.refundRecoveryId;
		let recoveryActorTokenIdentifier: string | undefined;
		if (recoveryId !== undefined) {
			assertManualRefundRecoveryEnabled();
			const { identity } = await requireSiteAdmin(ctx, args.siteUrl);
			recoveryActorTokenIdentifier = identity.tokenIdentifier;
		}
		if (
			recoveryId === undefined
			&& (
				args.refundRecoveryManifestVersion !== undefined
				|| args.refundRecoveryStripeContext !== undefined
				|| args.refundRecoveryEventApiVersion !== undefined
				|| args.refundRecoveryProviderEvidence !== undefined
			)
		) throw new Error("Manual refund recovery evidence is incomplete");
		const recovery = recoveryId === undefined
			? null
			: await ctx.db.query("manualRefundRecoveries")
				.withIndex("by_recoveryId", (q) => q.eq("recoveryId", recoveryId))
				.unique();
		if (
			recoveryId !== undefined
			&& (
				recoveryId !== MANUAL_REFUND_RECOVERY_MANIFEST.recoveryId
				|| !MANUAL_REFUND_RECOVERY_ID.test(recoveryId)
				|| !recovery
				|| recovery.state !== "claimed"
				|| recovery.claimedByTokenIdentifier !== recoveryActorTokenIdentifier
				|| recovery.manifestVersion !== args.refundRecoveryManifestVersion
				|| recovery.siteUrl !== args.siteUrl
				|| recovery.stripeContext !== args.refundRecoveryStripeContext
				|| recovery.stripeEventId !== args.stripeEventId
				|| recovery.stripeEventApiVersion !== args.refundRecoveryEventApiVersion
				|| recovery.stripeRefundId !== args.stripeRefundId
				|| recovery.stripeChargeId !== args.stripeChargeId
				|| recovery.stripePaymentIntentId !== args.stripePaymentIntentId
				|| recovery.stripeSessionId !== args.stripeSessionId
				|| !args.refundRecoveryProviderEvidence
				|| args.refundRecoveryProviderEvidence.verifiedAt < recovery.claimedAt
				|| args.refundRecoveryProviderEvidence.verifiedAt > Date.now() + 300_000
				|| args.refundRecoveryProviderEvidence.paymentIntentAmount !== recovery.amount
				|| args.refundRecoveryProviderEvidence.paymentIntentAmountReceived !== recovery.amount
				|| args.refundRecoveryProviderEvidence.paymentIntentLatestChargeId !== recovery.stripeChargeId
				|| recovery.stripeTenantMetadataSiteUrl !== args.stripeTenantMetadataSiteUrl
				|| recovery.amount !== args.refundAmount
				|| recovery.currency !== args.refundCurrency
				|| recovery.livemode !== args.eventLivemode
				|| args.stripeConnectedAccountId !== undefined
			)
		) throw new Error("Manual refund recovery claim is unavailable");
		const completeRecovery = async <Result extends ManualRefundReconciliationResult>(
			result: Result,
		) => {
			if (recovery) {
				await ctx.db.patch(recovery._id, {
					state: "completed",
					completedAt: Date.now(),
					providerEvidence: args.refundRecoveryProviderEvidence,
					resultKind: result.kind,
					resultReason: result.kind === "rejected" ? result.reason : undefined,
				});
			}
			return result;
		};
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
			return await completeRecovery({ kind: "rejected", reason: "identity_conflict" });
		}
		if (args.stripeConnectedAccountId !== undefined) {
			const clients = await ctx.db.query("platformClients")
				.withIndex("by_stripeConnectedAccountId", (q) => q
					.eq("stripeConnectedAccountId", args.stripeConnectedAccountId))
				.take(2);
			if (clients.length !== 1 || clients[0].siteUrl !== args.siteUrl) {
				return await completeRecovery({ kind: "rejected", reason: "identity_conflict" });
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
			return await completeRecovery({ kind: "rejected", reason: "identity_conflict" });
		}
		const byRefund = refundIntents[0];
		const bySession = sessionIntents[0];
		if (byRefund && bySession && byRefund._id !== bySession._id) {
			return await completeRecovery({ kind: "rejected", reason: "identity_conflict" });
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
		)) return await completeRecovery({ kind: "rejected", reason: "identity_conflict" });

		const matches = await ctx.db.query("orders")
			.withIndex("by_stripeSessionId", (q) => q.eq("stripeSessionId", args.stripeSessionId))
			.take(2);
		if (matches.length > 1) {
			return await completeRecovery({ kind: "rejected", reason: "identity_conflict" });
		}
		const order = matches[0];
		if (order && (
			order.siteUrl !== args.siteUrl
			|| args.stripeTenantMetadataSiteUrl !== undefined
				&& args.stripeTenantMetadataSiteUrl !== order.siteUrl
			|| order.total !== args.refundAmount
			|| order.stripePaymentIntentId !== undefined
				&& order.stripePaymentIntentId !== args.stripePaymentIntentId
		)) return await completeRecovery({ kind: "rejected", reason: "identity_conflict" });

		if (order?.stripeConnectedAccountId !== undefined) {
			if (
				args.stripeConnectedAccountId !== order.stripeConnectedAccountId
				|| !await connectedAccountMatchesSite(
					ctx, order.siteUrl, order.stripeConnectedAccountId,
				)
			) return await completeRecovery({ kind: "rejected", reason: "identity_conflict" });
		} else if (
			order
			&& args.stripeConnectedAccountId !== undefined
			&& !await connectedAccountMatchesSite(ctx, order.siteUrl, args.stripeConnectedAccountId)
		) return await completeRecovery({ kind: "rejected", reason: "identity_conflict" });

		if (recovery && !order) {
			return await completeRecovery({ kind: "rejected", reason: "state_conflict" });
		}
		const isManualTerminal = order?.status === "refunded"
			&& order.stripeRefundId === args.stripeRefundId
			&& order.lumaprintsOrderNumber === undefined
			&& !order.printFulfillmentClaim
			&& order.printFulfillmentPhase === undefined
			&& order.fulfillmentError === undefined
			&& order.fulfillmentRecoveryStatus === undefined;
		const canTakeOverPendingRecovery = order?.status === "fulfillment_error"
			&& order.fulfillmentRecoveryStatus === "refund_pending"
			&& order.stripeRefundId === undefined
			&& order.lumaprintsOrderNumber === undefined
			&& !order.printFulfillmentClaim;
		const isUnfulfilledNew = order?.status === "new"
			&& order.lumaprintsOrderNumber === undefined
			&& order.stripeRefundId === undefined
			&& order.fulfillmentError === undefined
			&& order.fulfillmentRecoveryStatus === undefined;
		if (recovery && !isManualTerminal && !isUnfulfilledNew && !canTakeOverPendingRecovery) {
			return await completeRecovery({ kind: "rejected", reason: "state_conflict" });
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
		if (!order) return await completeRecovery({ kind: "pending_order" });

		if (isManualTerminal) {
			if (intent.orderId === undefined) {
				await ctx.db.patch(intent._id, { orderId: order._id, consumedAt: Date.now() });
			}
			return await completeRecovery({ kind: "replayed" });
		}
		if (!isUnfulfilledNew && !canTakeOverPendingRecovery) {
			return await completeRecovery({ kind: "rejected", reason: "state_conflict" });
		}
		if (
			order.printFulfillmentClaim
			&& order.printFulfillmentPhase !== "preparing"
		) throw new Error("Print fulfillment submission is in progress");
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
			stripeFeeCaptureStatus: cancelsFeeCapture
				? "canceled"
				: order.stripeFeeCaptureStatus,
			stripeFeeCaptureNextAttemptAt: cancelsFeeCapture
				? undefined
				: order.stripeFeeCaptureNextAttemptAt,
			stripeFeeCaptureError: cancelsFeeCapture
				? undefined
				: order.stripeFeeCaptureError,
			printFulfillmentClaim: undefined,
			printFulfillmentClaimToken: undefined,
			printFulfillmentPhase: undefined,
			printFulfillmentClaimedAt: undefined,
			printFulfillmentLeaseExpiresAt: undefined,
		});
		await ctx.db.patch(intent._id, { orderId: order._id, consumedAt: Date.now() });
		return await completeRecovery({ kind: "reconciled" });
	},
});

/** Exact, one-use closeout for the accepted historical reservation incident. */
export const closeHistoricalCheckoutSnapshotReservation = mutation({
	args: {
		webhookSecret: v.string(),
		closeoutId: v.string(),
	},
	returns: v.union(
		v.object({ kind: v.literal("closed") }),
		v.object({ kind: v.literal("already_closed") }),
	),
	handler: async (ctx, args) => {
		assertCheckoutReservationCloseoutEnabled();
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		await requireSiteAdmin(ctx, CHECKOUT_RESERVATION_CLOSEOUT_MANIFEST.siteUrl);
		if (args.closeoutId !== CHECKOUT_RESERVATION_CLOSEOUT_MANIFEST.closeoutId) {
			throw new Error("Invalid checkout reservation closeout");
		}

		const existing = await ctx.db.query("checkoutSnapshotReservationCloseouts")
			.withIndex("by_closeoutId", (q) => q.eq("closeoutId", args.closeoutId))
			.unique();
		if (existing) {
			const reservation = await ctx.db.get(existing.reservationId);
			if (
				existing.recoveryId !== CHECKOUT_RESERVATION_CLOSEOUT_MANIFEST.recoveryId
				|| existing.reservationId !== historicalReservationCloseoutEvidence.reservationId
				|| existing.siteUrl !== CHECKOUT_RESERVATION_CLOSEOUT_MANIFEST.siteUrl
				|| existing.authorizationClass !== "site_admin"
				|| existing.resultKind !== "closed"
				|| reservation !== null
			) throw new Error("Checkout reservation closeout state conflicts");
			return { kind: "already_closed" as const };
		}

		const recovery = await ctx.db.query("manualRefundRecoveries")
			.withIndex("by_recoveryId", (q) => q.eq(
				"recoveryId",
				MANUAL_REFUND_RECOVERY_MANIFEST.recoveryId,
			))
			.unique();
		const providerEvidence = recovery?.state === "completed"
			? recovery.providerEvidence
			: undefined;
		if (
			!recovery
			|| recovery.state !== "completed"
			|| recovery.resultKind !== "reconciled"
			|| recovery.resultReason !== undefined
			|| recovery.failureStage !== undefined
			|| recovery.providerFailureObservations !== undefined
			|| recovery.manifestVersion !== MANUAL_REFUND_RECOVERY_MANIFEST.manifestVersion
			|| recovery.siteUrl !== MANUAL_REFUND_RECOVERY_MANIFEST.siteUrl
			|| recovery.stripeContext !== MANUAL_REFUND_RECOVERY_MANIFEST.stripeContext
			|| recovery.stripeEventId !== MANUAL_REFUND_RECOVERY_MANIFEST.stripeEventId
			|| recovery.stripeEventType !== MANUAL_REFUND_RECOVERY_MANIFEST.stripeEventType
			|| recovery.stripeEventApiVersion
				!== MANUAL_REFUND_RECOVERY_MANIFEST.stripeEventApiVersion
			|| recovery.stripeRefundId !== MANUAL_REFUND_RECOVERY_MANIFEST.stripeRefundId
			|| recovery.stripeChargeId !== MANUAL_REFUND_RECOVERY_MANIFEST.stripeChargeId
			|| recovery.stripePaymentIntentId
				!== MANUAL_REFUND_RECOVERY_MANIFEST.stripePaymentIntentId
			|| recovery.stripeSessionId !== MANUAL_REFUND_RECOVERY_MANIFEST.stripeSessionId
			|| recovery.stripeTenantMetadataSiteUrl
				!== MANUAL_REFUND_RECOVERY_MANIFEST.stripeTenantMetadataSiteUrl
			|| recovery.amount !== MANUAL_REFUND_RECOVERY_MANIFEST.amount
			|| recovery.currency !== MANUAL_REFUND_RECOVERY_MANIFEST.currency
			|| recovery.livemode !== MANUAL_REFUND_RECOVERY_MANIFEST.livemode
			|| !providerEvidence
			|| providerEvidence.currentRefundStatus !== "succeeded"
			|| providerEvidence.currentRefundHasAutomatedMetadata !== false
			|| providerEvidence.currentRefundHasRecoveryAuditMetadata !== false
			|| providerEvidence.paymentIntentStatus !== "succeeded"
			|| providerEvidence.paymentIntentAmount !== MANUAL_REFUND_RECOVERY_MANIFEST.amount
			|| providerEvidence.paymentIntentAmountReceived
				!== MANUAL_REFUND_RECOVERY_MANIFEST.amount
			|| providerEvidence.paymentIntentCurrency !== MANUAL_REFUND_RECOVERY_MANIFEST.currency
			|| providerEvidence.paymentIntentLivemode !== true
			|| providerEvidence.paymentIntentLatestChargeId
				!== MANUAL_REFUND_RECOVERY_MANIFEST.stripeChargeId
			|| providerEvidence.sessionMode !== "payment"
			|| providerEvidence.sessionStatus !== "complete"
			|| providerEvidence.sessionPaymentStatus !== "paid"
		) throw new Error("Checkout reservation closeout recovery evidence conflicts");

		const intents = await ctx.db.query("manualRefundIntents")
			.withIndex("by_stripeRefundId", (q) => q.eq(
				"stripeRefundId",
				MANUAL_REFUND_RECOVERY_MANIFEST.stripeRefundId,
			))
			.take(2);
		if (intents.length !== 1) {
			throw new Error("Checkout reservation closeout intent evidence conflicts");
		}
		const intent = intents[0];
		if (
			intent.accountScope !== "platform"
			|| intent.siteUrl !== MANUAL_REFUND_RECOVERY_MANIFEST.siteUrl
			|| intent.stripeEventId !== MANUAL_REFUND_RECOVERY_MANIFEST.stripeEventId
			|| intent.stripeRefundId !== MANUAL_REFUND_RECOVERY_MANIFEST.stripeRefundId
			|| intent.stripeChargeId !== MANUAL_REFUND_RECOVERY_MANIFEST.stripeChargeId
			|| intent.stripeSessionId !== MANUAL_REFUND_RECOVERY_MANIFEST.stripeSessionId
			|| intent.stripePaymentIntentId
				!== MANUAL_REFUND_RECOVERY_MANIFEST.stripePaymentIntentId
			|| intent.stripeConnectedAccountId !== undefined
			|| intent.stripeTenantMetadataSiteUrl
				!== MANUAL_REFUND_RECOVERY_MANIFEST.stripeTenantMetadataSiteUrl
			|| intent.amount !== MANUAL_REFUND_RECOVERY_MANIFEST.amount
			|| intent.currency !== MANUAL_REFUND_RECOVERY_MANIFEST.currency
			|| intent.livemode !== MANUAL_REFUND_RECOVERY_MANIFEST.livemode
			|| intent.orderId === undefined
			|| intent.consumedAt === undefined
		) throw new Error("Checkout reservation closeout intent evidence conflicts");

		const orders = await ctx.db.query("orders")
			.withIndex("by_stripeSessionId", (q) => q.eq(
				"stripeSessionId",
				MANUAL_REFUND_RECOVERY_MANIFEST.stripeSessionId,
			))
			.take(2);
		if (orders.length !== 1 || orders[0]._id !== intent.orderId) {
			throw new Error("Checkout reservation closeout order evidence conflicts");
		}
		const order = orders[0];
		if (
			order.siteUrl !== MANUAL_REFUND_RECOVERY_MANIFEST.siteUrl
			|| order.status !== "refunded"
			|| order.fulfillmentType !== "self"
			|| order.total !== MANUAL_REFUND_RECOVERY_MANIFEST.amount
			|| order.stripePaymentIntentId
				!== MANUAL_REFUND_RECOVERY_MANIFEST.stripePaymentIntentId
			|| order.stripeConnectedAccountId !== undefined
			|| order.stripeRefundId !== MANUAL_REFUND_RECOVERY_MANIFEST.stripeRefundId
			|| order.lumaprintsOrderNumber !== undefined
			|| order.fulfillmentError !== undefined
			|| order.fulfillmentRecoveryStatus !== undefined
			|| order.printFulfillmentClaim !== undefined
			|| order.printFulfillmentClaimToken !== undefined
			|| order.printFulfillmentPhase !== undefined
			|| order.printFulfillmentClaimedAt !== undefined
			|| order.printFulfillmentLeaseExpiresAt !== undefined
			|| order.trackingNumber !== undefined
			|| order.trackingUrl !== undefined
			|| order.orderConfirmationClaimedAt !== undefined
			|| order.shipmentEmailSentAt !== undefined
			|| order.shipmentEmailDeliveryStatus !== undefined
			|| order.shipmentEmailDeliveryAttemptedAt !== undefined
			|| order.shipmentEmailDeliveryError !== undefined
			|| order.stripeFees !== undefined
			|| order.stripeFeeCaptureStatus !== "failed"
			|| order.checkoutSnapshot !== undefined
		) throw new Error("Checkout reservation closeout order evidence conflicts");

		const reservations = await ctx.db.query("checkoutSnapshotReservations")
			.withIndex("by_accountScope_and_stripeSessionId", (q) => q
				.eq("accountScope", "platform")
				.eq("stripeSessionId", MANUAL_REFUND_RECOVERY_MANIFEST.stripeSessionId))
			.take(2);
		if (reservations.length !== 1) {
			throw new Error("Checkout reservation closeout reservation evidence conflicts");
		}
		const reservation = reservations[0];
		const reconciliationNextAt = reservation.reconciliationNextAt;
		const canonicalSnapshotDigest = await canonicalReservationSnapshotDigest(
			reservation.snapshot,
		);
		// Convex materializes the full document for this atomic transaction. The
		// code must not access, compare, copy, log, or persist the capability-derived
		// handle hash. The immutable ID and permitted evidence below pin the row.
		if (
			reservation._id !== historicalReservationCloseoutEvidence.reservationId
			|| reservation.state !== "bound"
			|| reservation.siteUrl !== MANUAL_REFUND_RECOVERY_MANIFEST.siteUrl
			|| reservation.accountScope !== "platform"
			|| reservation.stripeConnectedAccountId !== undefined
			|| reservation.stripeSessionId !== MANUAL_REFUND_RECOVERY_MANIFEST.stripeSessionId
			|| reservation.snapshotDigest !== historicalReservationCloseoutEvidence.snapshotDigest
			|| canonicalSnapshotDigest
				!== historicalReservationCloseoutEvidence.canonicalSnapshotDigest
			|| reservation.createdAt !== historicalReservationCloseoutEvidence.createdAt
			|| reservation.updatedAt !== historicalReservationCloseoutEvidence.updatedAt
			|| reservation.boundAt !== historicalReservationCloseoutEvidence.boundAt
			|| reservation.stripeExpiresAt
				!== historicalReservationCloseoutEvidence.stripeExpiresAt
			|| reservation.unboundPurgeAt !== historicalReservationCloseoutEvidence.unboundPurgeAt
			|| reservation.boundReconcileAt
				!== historicalReservationCloseoutEvidence.boundReconcileAt
			|| reservation.reconciliationAttempt !== 0
			|| reconciliationNextAt === undefined
			|| reconciliationNextAt !== reservation.boundReconcileAt
			|| reservation.reconciliationProviderVerifiedAt !== undefined
			|| reservation.reconciliationAlertedAt !== undefined
			|| Date.now() >= historicalReservationCloseoutEvidence.closeoutDeadline
		) throw new Error("Checkout reservation closeout reservation evidence conflicts");

		await ctx.db.insert("checkoutSnapshotReservationCloseouts", {
			closeoutId: CHECKOUT_RESERVATION_CLOSEOUT_MANIFEST.closeoutId,
			recoveryId: CHECKOUT_RESERVATION_CLOSEOUT_MANIFEST.recoveryId,
			reservationId: reservation._id,
			orderId: order._id,
			intentId: intent._id,
			siteUrl: CHECKOUT_RESERVATION_CLOSEOUT_MANIFEST.siteUrl,
			authorizationClass: "site_admin",
			resultKind: "closed",
			closedAt: Date.now(),
		});
		await ctx.db.delete(reservation._id);
		return { kind: "closed" as const };
	},
});

/** Server-only paid-download authority, called only after Stripe buyer authorization. */
export const resolvePaidDownloadOrder = query({
	args: { stripeSessionId: v.string(), webhookSecret: v.string() },
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!isStripeCheckoutSessionId(args.stripeSessionId)) return null;
		const order = await ctx.db.query("orders")
			.withIndex("by_stripeSessionId", (q) => q.eq("stripeSessionId", args.stripeSessionId)).unique();
		if (!order) return null;
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

/** Legacy V1 claim retained for a safe Convex-first rollout. */
export const claimPrintFulfillment = mutation({
	args: { orderId: v.id("orders"), webhookSecret: v.string() },
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new Error("Order not found");
		if (order.lumaprintsOrderNumber)
			return { kind: "fulfilled" as const, orderNumber: order.lumaprintsOrderNumber };
		if (
			order.status === "refunded"
			&& order.stripeRefundId
			&& order.fulfillmentRecoveryStatus === undefined
		) return { kind: "busy" as const };
		if (order.status === "refunded" || order.stripeRefundId)
			return { kind: "refunded" as const, stripeRefundId: order.stripeRefundId };
		if (order.fulfillmentRecoveryStatus) return { kind: "busy" as const };
		if (order.printFulfillmentClaim)
			return { kind: "reconcile" as const, externalId: order.stripeSessionId };
		await ctx.db.patch(args.orderId, { printFulfillmentClaim: true });
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
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		if (!CLAIM_TOKEN.test(args.claimToken)) throw new Error("Invalid print claim token");
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new Error("Order not found");
		if (order.lumaprintsOrderNumber)
			return { kind: "fulfilled" as const, orderNumber: order.lumaprintsOrderNumber };
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
		});
		return {
			kind: "claimed" as const,
			externalId: order.stripeSessionId,
			leaseExpiresAt,
		};
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
		await ctx.db.patch(order._id, {
			printFulfillmentPhase: "submitting",
			printFulfillmentLeaseExpiresAt: undefined,
		});
		return { kind: "submitting" as const, externalId: order.stripeSessionId };
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
		if (updates.lumaprintsOrderNumber) {
			patch.printFulfillmentClaim = undefined;
			patch.printFulfillmentClaimToken = undefined;
			patch.printFulfillmentPhase = undefined;
			patch.printFulfillmentClaimedAt = undefined;
			patch.printFulfillmentLeaseExpiresAt = undefined;
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
 * Atomically claim the one-time customer shipment email for a LumaPrints
 * shipment webhook.
 *
 * This intentionally combines lookup, tracking/status patch, and email-claim
 * into a single Convex transaction. Spokes can then send the email only when
 * `claimed` is true, avoiding duplicate emails from concurrent webhook
 * deliveries without pushing the actual Resend side effect into Convex.
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
		{ siteUrl, lumaprintsOrderNumber, webhookSecret, trackingNumber, trackingUrl },
	) => {
		const auth = await requireWebhookCallerOrAuth(ctx, webhookSecret);
		if (auth.via === "auth") {
			await requireSiteAdmin(ctx, siteUrl);
		}

		const matchingOrders = await ctx.db
			.query("orders")
			.withIndex("by_lumaprintsOrderNumber", (q) =>
				q.eq("siteUrl", siteUrl).eq("lumaprintsOrderNumber", lumaprintsOrderNumber),
			)
			.take(2);
		if (matchingOrders.length > 1) {
			throw new Error("Duplicate LumaPrints order number");
		}
		const order = matchingOrders[0];
		if (!order) return null;

		return await claimShipmentEmailForOrder(ctx, order, trackingNumber, trackingUrl);
	},
});

/** Hub-only shipment claim using LumaPrints' provider-global order number. */
export const claimShipmentEmailNotificationByOrderNumber = mutation({
	args: {
		lumaprintsOrderNumber: v.string(),
		webhookSecret: v.string(),
		trackingNumber: v.optional(v.string()),
		trackingUrl: v.optional(v.string()),
	},
	handler: async (ctx, { lumaprintsOrderNumber, webhookSecret, trackingNumber, trackingUrl }) => {
		await requireWebhookCallerOrAuth(ctx, webhookSecret, { allowAuth: false });
		const order = await findGlobalLumaPrintsOrder(ctx, lumaprintsOrderNumber);
		return order
			? await claimShipmentEmailForOrder(ctx, order, trackingNumber, trackingUrl)
			: null;
	},
});

/**
 * Record the result of the customer shipment email side effect after a
 * spoke attempts delivery. This is intentionally separate from the atomic
 * claim mutation because Convex cannot wrap the external Resend call in the
 * same transaction.
 */
export const recordShipmentEmailDelivery = mutation({
	args: {
		siteUrl: v.string(),
		lumaprintsOrderNumber: v.string(),
		webhookSecret: v.optional(v.string()),
		status: shipmentEmailDeliveryStatusValidator,
		error: v.optional(v.string()),
	},
	handler: async (ctx, { siteUrl, lumaprintsOrderNumber, webhookSecret, status, error }) => {
		const auth = await requireWebhookCallerOrAuth(ctx, webhookSecret);
		if (auth.via === "auth") {
			await requireSiteAdmin(ctx, siteUrl);
		}

		const matchingOrders = await ctx.db
			.query("orders")
			.withIndex("by_lumaprintsOrderNumber", (q) =>
				q.eq("siteUrl", siteUrl).eq("lumaprintsOrderNumber", lumaprintsOrderNumber),
			)
			.take(2);
		if (matchingOrders.length > 1) {
			throw new Error("Duplicate LumaPrints order number");
		}
		const order = matchingOrders[0];
		if (!order) return null;

		return await recordShipmentEmailForOrder(ctx, order, status, error);
	},
});

/** Hub-only delivery checkpoint keyed by LumaPrints' provider-global number. */
export const recordShipmentEmailDeliveryByOrderNumber = mutation({
	args: {
		lumaprintsOrderNumber: v.string(),
		webhookSecret: v.string(),
		status: shipmentEmailDeliveryStatusValidator,
		error: v.optional(v.string()),
	},
	handler: async (ctx, { lumaprintsOrderNumber, webhookSecret, status, error }) => {
		await requireWebhookCallerOrAuth(ctx, webhookSecret, { allowAuth: false });
		const order = await findGlobalLumaPrintsOrder(ctx, lumaprintsOrderNumber);
		return order ? await recordShipmentEmailForOrder(ctx, order, status, error) : null;
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

/**
 * Look up an order by the LumaPrints order number assigned at fulfillment
 * submission. Used by the LumaPrints shipment webhook which only knows the
 * LP order number, not the Convex `_id`.
 *
 * Gated by `requireWebhookCallerOrAuth` so that:
 *   - The spoke's LumaPrints webhook can call it with `WEBHOOK_SECRET`
 *   - An authenticated admin can also call it (debugging, manual reruns)
 * but the query is not publicly invokable.
 *
 * Returns `null` if no matching order exists (stale webhook, typo, etc.) —
 * the caller should log + return 200 so LumaPrints doesn't retry forever.
 */
export const getByLumaprintsOrderNumber = query({
	args: {
		siteUrl: v.string(),
		lumaprintsOrderNumber: v.string(),
		webhookSecret: v.optional(v.string()),
	},
	handler: async (ctx, { siteUrl, lumaprintsOrderNumber, webhookSecret }) => {
		const auth = await requireWebhookCallerOrAuth(ctx, webhookSecret);
		if (auth.via === "auth") {
			await requireSiteAdmin(ctx, siteUrl);
		}
		const matchingOrders = await ctx.db
			.query("orders")
			.withIndex("by_lumaprintsOrderNumber", (q) =>
				q.eq("siteUrl", siteUrl).eq("lumaprintsOrderNumber", lumaprintsOrderNumber),
			)
			.take(2);
		if (matchingOrders.length > 1) {
			throw new Error("Duplicate LumaPrints order number");
		}
		const order = matchingOrders[0];
		if (!order) return null;
		return {
			_id: order._id,
			orderNumber: order.orderNumber,
			status: order.status,
			customerEmail: order.customerEmail,
			trackingNumber: order.trackingNumber,
			trackingUrl: order.trackingUrl,
		};
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

		// Build daily revenue map for last 30 days
		const dailyRevenueMap = new Map<string, number>();
		for (let i = 29; i >= 0; i--) {
			const d = new Date(todayStart);
			d.setDate(d.getDate() - i);
			dailyRevenueMap.set(d.toISOString().split("T")[0], 0);
		}

		for (const order of orders) {
			const total = order.total || 0;
			allTimeRevenue += total;

			const orderDate = new Date(order._creationTime);
			if (orderDate >= todayStart) todayRevenue += total;
			if (orderDate >= weekStart) weekRevenue += total;
			if (orderDate >= monthStart) monthRevenue += total;

			const dateKey = orderDate.toISOString().split("T")[0];
			if (dailyRevenueMap.has(dateKey)) {
				dailyRevenueMap.set(
					dateKey,
					(dailyRevenueMap.get(dateKey) || 0) + total,
				);
			}
		}

		const dailyRevenue = Array.from(dailyRevenueMap.entries()).map(
			([date, amount]) => ({ date, amount }),
		);

		const recentOrders = orders.slice(0, 10).map((order) => ({
			_id: order._id,
			orderNumber: order.orderNumber,
			createdAt: new Date(order._creationTime).toISOString(),
			customerEmail: order.customerEmail,
			customerName: order.customerName || "",
			total: order.total,
			stripeFees: order.stripeFees || 0,
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
			},
			dailyRevenue,
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
