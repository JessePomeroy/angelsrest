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
import { internalMutation, internalQuery } from "./_generated/server";
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
