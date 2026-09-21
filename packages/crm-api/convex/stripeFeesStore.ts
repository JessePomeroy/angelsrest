/**
 * V8-runtime helpers for the `stripeFees` action (audit H5). Separated from
 * `stripeFees.ts` because that file uses `"use node"` to access the Stripe
 * SDK's Node internals — and Convex requires queries/mutations to run in
 * the V8 runtime. This file is V8-only; it owns the DB side of the
 * fee-capture flow.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { requireDocumentSiteAdmin } from "./authHelpers";
import {
	APPLICATION_FEE_INITIAL_DELAY_MS, APPLICATION_FEE_LEASE_MS, APPLICATION_FEE_MAX_ATTEMPTS,
	APPLICATION_FEE_RETRY_DELAYS, applicationFeeErrorValidator, applicationFeeMatchesExpectation,
	applicationFeeObservationValidator, validApplicationFeeObservation, type ApplicationFeeError,
} from "./helpers/applicationFeeVerification";
import {
	FEE_CAPTURE_MAX_ATTEMPTS,
	FEE_CAPTURE_PROVENANCE_VERSION,
	FEE_CAPTURE_RETRY_DELAY_MS,
	getFeeCaptureRetryDelayMs,
	isNonnegativeSafeInteger,
	isStripeCurrency,
	stripeFeeCaptureErrorValidator,
	type StripeFeeCaptureError,
} from "./helpers/stripeFeeCapture";

function isManualRefundTerminal(order: Doc<"orders">) {
	return order.status === "refunded"
		&& order.stripeRefundId !== undefined
		&& order.fulfillmentRecoveryStatus === undefined;
}

function feeCaptureClosed(order: Doc<"orders">) {
	return isManualRefundTerminal(order)
		|| order.stripeFees !== undefined
		|| order.stripeFeeCaptureStatus === "captured"
		|| order.stripeFeeCaptureStatus === "failed"
		|| order.stripeFeeCaptureStatus === "canceled"
		|| order.stripeFeeCaptureStatus === "legacy_unverified";
}

/**
 * Return the fields the fee-capture action needs. Null if the order no longer
 * exists or fee capture is terminal.
 */
export const getOrderForFees = internalQuery({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }) => {
		const order = await ctx.db.get(orderId);
		if (!order || feeCaptureClosed(order)) return null;
		return {
			_id: order._id,
			siteUrl: order.siteUrl,
			stripePaymentIntentId: order.stripePaymentIntentId,
			stripeConnectedAccountId: order.stripeConnectedAccountId,
			stripePaymentCurrency: order.stripePaymentCurrency,
			stripePaymentLivemode: order.stripePaymentLivemode,
			total: order.total,
			stripeFees: order.stripeFees,
			stripeFeeCaptureStatus: order.stripeFeeCaptureStatus,
			stripeFeeCaptureAttempts: order.stripeFeeCaptureAttempts,
		};
	},
});

/**
 * Checkpoint an attempt before crossing the Stripe boundary. Terminal orders
 * cannot regress to pending if a duplicate scheduled action arrives later.
 */
export const beginAttempt = internalMutation({
	args: { orderId: v.id("orders"), attempt: v.number(), attemptToken: v.string() },
	handler: async (ctx, { orderId, attempt, attemptToken }) => {
		const order = await ctx.db.get(orderId);
		if (
			!order
			|| feeCaptureClosed(order)
			|| !Number.isInteger(attempt)
			|| attempt < 1
			|| attempt > FEE_CAPTURE_MAX_ATTEMPTS
			|| attempt !== (order.stripeFeeCaptureAttempts ?? 0) + 1
			|| order.stripeFeeCaptureAttemptToken !== undefined
		) return false;
		const timeoutAt = Date.now() + FEE_CAPTURE_RETRY_DELAY_MS;
		await ctx.db.patch(orderId, {
			stripeFeeCaptureStatus: "pending",
			stripeFeeCaptureAttempts: Math.max(order.stripeFeeCaptureAttempts ?? 0, attempt),
			stripeFeeCaptureLastAttemptAt: Date.now(),
			stripeFeeCaptureNextAttemptAt: timeoutAt,
			stripeFeeCaptureAttemptToken: attemptToken,
			stripeFeeCaptureError: undefined,
		});
		await ctx.scheduler.runAfter(
			FEE_CAPTURE_RETRY_DELAY_MS,
			internal.stripeFeesStore.expireAttempt,
			{ orderId, attempt, attemptToken },
		);
		return true;
	},
});

type FeeCaptureRetry = {
	orderId: Id<"orders">;
	attempt: number;
	attemptToken: string;
	error: StripeFeeCaptureError;
};

/**
 * Record retry visibility and dispatch its successor in one mutation
 * transaction. If scheduling throws, Convex rolls back the order patch too.
 */
export async function recordFeeCaptureRetry(
	ctx: Pick<MutationCtx, "db" | "scheduler">,
	{ orderId, attempt, attemptToken, error }: FeeCaptureRetry,
	retryDelayMs: number,
) {
	const order = await ctx.db.get(orderId);
	if (
		!order
		|| feeCaptureClosed(order)
		|| order.stripeFeeCaptureAttempts !== attempt
		|| order.stripeFeeCaptureAttemptToken !== attemptToken
	) return false;
	const nextAttemptAt = Date.now() + retryDelayMs;
	await ctx.db.patch(orderId, {
		stripeFeeCaptureStatus: "pending",
		stripeFeeCaptureAttempts: Math.max(order.stripeFeeCaptureAttempts ?? 0, attempt),
		stripeFeeCaptureNextAttemptAt: nextAttemptAt,
		stripeFeeCaptureAttemptToken: undefined,
		stripeFeeCaptureError: error,
	});
	await ctx.scheduler.runAfter(
		retryDelayMs,
		internal.stripeFees.captureFeesForOrder,
		{ orderId, attempt: attempt + 1 },
	);
	return true;
}

export const recordRetry = internalMutation({
	args: {
		orderId: v.id("orders"),
		attempt: v.number(),
		attemptToken: v.string(),
		error: stripeFeeCaptureErrorValidator,
	},
	handler: async (ctx, args) => {
		const retryDelayMs = getFeeCaptureRetryDelayMs(args.attempt);
		if (retryDelayMs === null) return false;
		return await recordFeeCaptureRetry(ctx, args, retryDelayMs);
	},
});

/** Patch the order with the resolved fees and terminal captured state. */
export const setFees = internalMutation({
	args: {
		orderId: v.id("orders"),
		stripeFees: v.number(),
		stripeFeeCurrency: v.string(),
		stripeFeeChargeId: v.string(),
		stripeFeeBalanceTransactionId: v.string(),
		attempt: v.number(),
		attemptToken: v.string(),
	},
	handler: async (ctx, args) => {
		const {
			orderId, stripeFees, stripeFeeCurrency, stripeFeeChargeId,
			stripeFeeBalanceTransactionId, attempt, attemptToken,
		} = args;
		const order = await ctx.db.get(orderId);
		if (
			!order
			|| feeCaptureClosed(order)
			|| order.stripeFeeCaptureAttempts !== attempt
			|| order.stripeFeeCaptureAttemptToken !== attemptToken
			|| !isNonnegativeSafeInteger(stripeFees)
			|| !isStripeCurrency(stripeFeeCurrency)
			|| !stripeFeeChargeId.startsWith("ch_")
			|| stripeFeeChargeId.length <= 3
			|| !stripeFeeBalanceTransactionId.startsWith("txn_")
			|| stripeFeeBalanceTransactionId.length <= 4
		) return false;
		await ctx.db.patch(orderId, {
			stripeFees,
			stripeFeeCurrency,
			stripeFeeChargeId,
			stripeFeeBalanceTransactionId,
			stripeFeeCapturedAt: Date.now(),
			stripeFeeProvenanceVersion: FEE_CAPTURE_PROVENANCE_VERSION,
			stripeFeeProvenance: "provider_verified",
			stripeFeeCaptureStatus: "captured",
			stripeFeeCaptureAttempts: Math.max(order.stripeFeeCaptureAttempts ?? 0, attempt),
			stripeFeeCaptureLastAttemptAt: Date.now(),
			stripeFeeCaptureNextAttemptAt: undefined,
			stripeFeeCaptureAttemptToken: undefined,
			stripeFeeCaptureError: undefined,
		});
		return true;
	},
});

export const recordFailure = internalMutation({
	args: {
		orderId: v.id("orders"),
		attempt: v.number(),
		attemptToken: v.string(),
		error: stripeFeeCaptureErrorValidator,
	},
	handler: async (ctx, { orderId, attempt, attemptToken, error }) => {
		const order = await ctx.db.get(orderId);
		if (
			!order
			|| feeCaptureClosed(order)
			|| order.stripeFeeCaptureAttempts !== attempt
			|| order.stripeFeeCaptureAttemptToken !== attemptToken
		) return false;
		await ctx.db.patch(orderId, {
			stripeFeeCaptureStatus: "failed",
			stripeFeeCaptureAttempts: Math.max(order.stripeFeeCaptureAttempts ?? 0, attempt),
			stripeFeeCaptureLastAttemptAt: Date.now(),
			stripeFeeCaptureNextAttemptAt: undefined,
			stripeFeeCaptureAttemptToken: undefined,
			stripeFeeCaptureError: error,
		});
		return true;
	},
});

/** Recover an action that stopped after its durable pre-provider checkpoint. */
export const expireAttempt = internalMutation({
	args: {
		orderId: v.id("orders"),
		attempt: v.number(),
		attemptToken: v.string(),
	},
	handler: async (ctx, { orderId, attempt, attemptToken }) => {
		const order = await ctx.db.get(orderId);
		if (
			!order
			|| feeCaptureClosed(order)
			|| order.stripeFeeCaptureAttempts !== attempt
			|| order.stripeFeeCaptureAttemptToken !== attemptToken
		) return false;
		if (attempt >= FEE_CAPTURE_MAX_ATTEMPTS) {
			await ctx.db.patch(orderId, {
				stripeFeeCaptureStatus: "failed",
				stripeFeeCaptureNextAttemptAt: undefined,
				stripeFeeCaptureAttemptToken: undefined,
				stripeFeeCaptureError: "stripe_api_error",
			});
			return true;
		}
		await ctx.db.patch(orderId, {
			stripeFeeCaptureNextAttemptAt: Date.now(),
			stripeFeeCaptureAttemptToken: undefined,
			stripeFeeCaptureError: "stripe_api_error",
		});
		await ctx.scheduler.runAfter(0, internal.stripeFees.captureFeesForOrder, {
			orderId,
			attempt: attempt + 1,
		});
		return true;
	},
});

// Application-fee verification has its own lifecycle. Fulfillment cancellation
// and processing-fee capture must not close this record of the original fee.
export async function scheduleApplicationFeeVerification(ctx: MutationCtx, orderId: Id<"orders">) {
	const order = await ctx.db.get(orderId);
	if (!order?.checkoutFinancialSnapshot) return;
	const existing = await ctx.db.query("orderApplicationFees")
		.withIndex("by_orderId", q => q.eq("orderId", orderId)).unique();
	if (existing) return;
	await ctx.db.insert("orderApplicationFees", {
		orderId, status: "pending", attempts: 0, nextAttemptAt: Date.now() + APPLICATION_FEE_INITIAL_DELAY_MS,
	});
	await ctx.scheduler.runAfter(APPLICATION_FEE_INITIAL_DELAY_MS,
		internal.stripeFees.verifyApplicationFeeForOrder, { orderId, attempt: 1 });
}

export const beginApplicationFeeAttempt = internalMutation({
	args: { orderId: v.id("orders"), attempt: v.number(), attemptToken: v.string() },
	handler: async (ctx, { orderId, attempt, attemptToken }) => {
		const row = await ctx.db.query("orderApplicationFees")
			.withIndex("by_orderId", q => q.eq("orderId", orderId)).unique();
		if (!row || row.status !== "pending" || row.attemptToken !== undefined
			|| !Number.isInteger(attempt) || attempt < 1 || attempt > APPLICATION_FEE_MAX_ATTEMPTS
			|| attempt !== row.attempts + 1 || row.nextAttemptAt === undefined || row.nextAttemptAt > Date.now()
			|| attemptToken.length < 16 || attemptToken.length > 100) return null;
		const order = await ctx.db.get(orderId);
		if (!order?.checkoutFinancialSnapshot) {
			await ctx.db.patch(row._id, { status: "attention", error: "original_context_invalid", nextAttemptAt: undefined });
			return null;
		}
		await ctx.db.patch(row._id, { attempts: attempt, attemptToken,
			leaseUntil: Date.now() + APPLICATION_FEE_LEASE_MS, nextAttemptAt: undefined });
		await ctx.scheduler.runAfter(APPLICATION_FEE_LEASE_MS,
			internal.stripeFeesStore.expireApplicationFeeAttempt, { orderId, attempt, attemptToken });
		return { siteUrl: order.siteUrl, tenantId: order.tenantId, stripeSessionId: order.stripeSessionId,
			stripePaymentIntentId: order.stripePaymentIntentId, stripeConnectedAccountId: order.stripeConnectedAccountId,
			stripePaymentCurrency: order.stripePaymentCurrency, stripePaymentLivemode: order.stripePaymentLivemode,
			total: order.total, checkoutFinancialSnapshot: order.checkoutFinancialSnapshot };
	},
});

async function finishApplicationFeeFailure(ctx: MutationCtx, row: Doc<"orderApplicationFees">, error: ApplicationFeeError) {
	const retryable = ["provider_unavailable", "configuration_unavailable", "payment_not_ready", "fee_not_ready", "attempt_expired"].includes(error);
	const delay = retryable ? APPLICATION_FEE_RETRY_DELAYS[row.attempts - 1] : undefined;
	await ctx.db.patch(row._id, { error, attemptToken: undefined, leaseUntil: undefined,
		status: delay === undefined ? "attention" : "pending",
		nextAttemptAt: delay === undefined ? undefined : Date.now() + delay });
	if (delay !== undefined) await ctx.scheduler.runAfter(delay,
		internal.stripeFees.verifyApplicationFeeForOrder, { orderId: row.orderId, attempt: row.attempts + 1 });
}

export const finishApplicationFeeAttempt = internalMutation({
	args: { orderId: v.id("orders"), attempt: v.number(), attemptToken: v.string(),
		result: v.union(v.object({ observation: applicationFeeObservationValidator }),
			v.object({ error: applicationFeeErrorValidator })) },
	handler: async (ctx, { orderId, attempt, attemptToken, result }) => {
		const row = await ctx.db.query("orderApplicationFees")
			.withIndex("by_orderId", q => q.eq("orderId", orderId)).unique();
		if (!row || row.status !== "pending" || row.attempts !== attempt || row.attemptToken !== attemptToken
			|| row.leaseUntil === undefined || row.leaseUntil <= Date.now()) return false;
		if ("error" in result) {
			await finishApplicationFeeFailure(ctx, row, result.error);
			return true;
		}
		const order = await ctx.db.get(orderId);
		if (!order || !validApplicationFeeObservation(order, result.observation)) {
			await finishApplicationFeeFailure(ctx, row, "original_context_invalid");
			return false;
		}
		const matches = applicationFeeMatchesExpectation(order, result.observation);
		await ctx.db.patch(row._id, { status: matches ? "verified" : "attention",
			observation: result.observation, observedAt: Date.now(),
			error: matches ? undefined : "fee_amount_mismatch", attemptToken: undefined,
			leaseUntil: undefined, nextAttemptAt: undefined });
		return true;
	},
});

export const expireApplicationFeeAttempt = internalMutation({
	args: { orderId: v.id("orders"), attempt: v.number(), attemptToken: v.string() },
	handler: async (ctx, { orderId, attempt, attemptToken }) => {
		const row = await ctx.db.query("orderApplicationFees")
			.withIndex("by_orderId", q => q.eq("orderId", orderId)).unique();
		if (!row || row.status !== "pending" || row.attempts !== attempt || row.attemptToken !== attemptToken
			|| row.leaseUntil === undefined || row.leaseUntil > Date.now()) return false;
		await finishApplicationFeeFailure(ctx, row, "attempt_expired");
		return true;
	},
});

/** Tenant membership authorizes the saved order, never a browser-selected account. */
export const getApplicationFeeForOrder = query({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }) => {
		const order = await requireDocumentSiteAdmin(ctx, "orders", orderId);
		const expected = order.checkoutFinancialSnapshot ?? null;
		const row = await ctx.db.query("orderApplicationFees")
			.withIndex("by_orderId", q => q.eq("orderId", orderId)).unique();
		return { expected, status: row?.status ?? "unknown" as const,
			observation: row?.observation ?? null, observedAt: row?.observedAt ?? null,
			error: row?.error ?? null, nextAttemptAt: row?.nextAttemptAt ?? null };
	},
});
