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
import { AGGREGATE_SCAN_LIMIT, BULK_SCAN_LIMIT } from "./helpers/limits";
import { getNextOrderNumber as generateNextOrderNumber } from "./helpers/numbering";
import { resolveBoundedOrderStatsScan } from "./helpers/orderStats";
import { FEE_CAPTURE_INITIAL_DELAY_MS } from "./helpers/stripeFeeCapture";

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

		const feeCaptureScheduledAt = orderInput.stripePaymentIntentId
			? Date.now() + FEE_CAPTURE_INITIAL_DELAY_MS
			: undefined;
		const _id = await ctx.db.insert("orders", {
			...orderInput,
			orderNumber,
			status: "new",
			stripeFeeCaptureStatus: orderInput.stripePaymentIntentId ? "pending" : undefined,
			stripeFeeCaptureAttempts: orderInput.stripePaymentIntentId ? 0 : undefined,
			stripeFeeCaptureNextAttemptAt: feeCaptureScheduledAt,
		});

		// Schedule Stripe fee capture off the webhook hot path (audit H5).
		// Stripe's balance_transaction isn't populated the instant
		// checkout.session.completed fires, so we wait 15s then fetch.
		// The action is idempotent and reschedules itself up to 3 times if
		// the fee still isn't available — see convex/stripeFees.ts.
		if (orderInput.stripePaymentIntentId) {
			await ctx.scheduler.runAfter(
				FEE_CAPTURE_INITIAL_DELAY_MS,
				internal.stripeFees.captureFeesForOrder,
				{ orderId: _id },
			);
		}

		return {
			_id,
			orderNumber,
			alreadyExisted: false as const,
			lumaprintsOrderNumber: undefined,
			status: "new" as const,
			stripeFees: undefined,
			stripeFeeCaptureStatus: orderInput.stripePaymentIntentId ? ("pending" as const) : undefined,
			stripeFeeCaptureAttempts: orderInput.stripePaymentIntentId ? 0 : undefined,
			stripeFeeCaptureLastAttemptAt: undefined,
			stripeFeeCaptureNextAttemptAt: feeCaptureScheduledAt,
			stripeFeeCaptureError: undefined,
			fulfillmentError: undefined,
			stripeRefundId: undefined,
			fulfillmentRecoveryStatus: undefined,
			checkoutSnapshot: orderInput.checkoutSnapshot,
		};
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

export const claimPrintFulfillment = mutation({
	args: { orderId: v.id("orders"), webhookSecret: v.string() },
	handler: async (ctx, args) => {
		await requireWebhookCallerOrAuth(ctx, args.webhookSecret, { allowAuth: false });
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new Error("Order not found");
		if (order.lumaprintsOrderNumber)
			return { kind: "fulfilled" as const, orderNumber: order.lumaprintsOrderNumber };
		if (order.status === "refunded" || order.stripeRefundId)
			return { kind: "refunded" as const, stripeRefundId: order.stripeRefundId };
		if (order.fulfillmentRecoveryStatus) return { kind: "busy" as const };
		if (order.printFulfillmentClaim)
			return { kind: "reconcile" as const, externalId: order.stripeSessionId };
		await ctx.db.patch(args.orderId, { printFulfillmentClaim: true });
		return { kind: "claimed" as const, externalId: order.stripeSessionId };
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
		if (auth.via === "auth") await requireDocumentSiteAdmin(ctx, "orders", orderId);
		const refundUpdate = updates.stripeRefundId !== undefined
			|| updates.fulfillmentRecoveryStatus !== undefined || updates.status === "refunded";
		const current = refundUpdate ? await ctx.db.get(orderId) : null;
		if (refundUpdate && current?.printFulfillmentClaim && !current.lumaprintsOrderNumber) {
			throw new Error("Print fulfillment submission is in progress");
		}
		const patch: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(updates)) if (val !== undefined) patch[key] = val;
		if (updates.lumaprintsOrderNumber) patch.printFulfillmentClaim = undefined;
		if (Object.keys(patch).length > 0) {
			await ctx.db.patch(orderId, patch);
		}
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
