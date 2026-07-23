/**
 * V8-runtime helpers for the `stripeFees` action (audit H5). Separated from
 * `stripeFees.ts` because that file uses `"use node"` to access the Stripe
 * SDK's Node internals — and Convex requires queries/mutations to run in
 * the V8 runtime. This file is V8-only; it owns the DB side of the
 * fee-capture flow.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import {
	getFeeCaptureRetryDelayMs,
	stripeFeeCaptureErrorValidator,
	type StripeFeeCaptureError,
} from "./helpers/stripeFeeCapture";

/**
 * Return the fields the fee-capture action needs. Null if the order was
 * deleted between scheduling and run.
 */
export const getOrderForFees = internalQuery({
	args: { orderId: v.id("orders") },
	handler: async (ctx, { orderId }) => {
		const order = await ctx.db.get(orderId);
		if (!order) return null;
		return {
			_id: order._id,
			orderNumber: order.orderNumber,
			stripePaymentIntentId: order.stripePaymentIntentId,
			stripeConnectedAccountId: order.stripeConnectedAccountId,
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
	args: { orderId: v.id("orders"), attempt: v.number() },
	handler: async (ctx, { orderId, attempt }) => {
		const order = await ctx.db.get(orderId);
		if (!order) return false;
		if (order.stripeFees !== undefined) return false;
		if (
			order.stripeFeeCaptureStatus === "captured" ||
			order.stripeFeeCaptureStatus === "failed"
		) {
			return false;
		}
		await ctx.db.patch(orderId, {
			stripeFeeCaptureStatus: "pending",
			stripeFeeCaptureAttempts: Math.max(order.stripeFeeCaptureAttempts ?? 0, attempt),
			stripeFeeCaptureLastAttemptAt: Date.now(),
			stripeFeeCaptureNextAttemptAt: undefined,
			stripeFeeCaptureError: undefined,
		});
		return true;
	},
});

type FeeCaptureRetry = {
	orderId: Id<"orders">;
	attempt: number;
	error: StripeFeeCaptureError;
};

/**
 * Record retry visibility and dispatch its successor in one mutation
 * transaction. If scheduling throws, Convex rolls back the order patch too.
 */
export async function recordFeeCaptureRetry(
	ctx: Pick<MutationCtx, "db" | "scheduler">,
	{ orderId, attempt, error }: FeeCaptureRetry,
	retryDelayMs: number,
) {
	const order = await ctx.db.get(orderId);
	if (!order) return false;
	if (
		order.stripeFeeCaptureStatus === "captured" ||
		order.stripeFeeCaptureStatus === "failed"
	) {
		return false;
	}
	const nextAttemptAt = Date.now() + retryDelayMs;
	await ctx.db.patch(orderId, {
		stripeFeeCaptureStatus: "pending",
		stripeFeeCaptureAttempts: Math.max(order.stripeFeeCaptureAttempts ?? 0, attempt),
		stripeFeeCaptureNextAttemptAt: nextAttemptAt,
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
	args: { orderId: v.id("orders"), stripeFees: v.number(), attempt: v.number() },
	handler: async (ctx, { orderId, stripeFees, attempt }) => {
		const order = await ctx.db.get(orderId);
		if (!order) return false;
		await ctx.db.patch(orderId, {
			stripeFees,
			stripeFeeCaptureStatus: "captured",
			stripeFeeCaptureAttempts: Math.max(order.stripeFeeCaptureAttempts ?? 0, attempt),
			stripeFeeCaptureLastAttemptAt: Date.now(),
			stripeFeeCaptureNextAttemptAt: undefined,
			stripeFeeCaptureError: undefined,
		});
		return true;
	},
});

export const recordFailure = internalMutation({
	args: {
		orderId: v.id("orders"),
		attempt: v.number(),
		error: stripeFeeCaptureErrorValidator,
	},
	handler: async (ctx, { orderId, attempt, error }) => {
		const order = await ctx.db.get(orderId);
		if (!order) return false;
		if (order.stripeFees !== undefined || order.stripeFeeCaptureStatus === "captured") {
			return false;
		}
		await ctx.db.patch(orderId, {
			stripeFeeCaptureStatus: "failed",
			stripeFeeCaptureAttempts: Math.max(order.stripeFeeCaptureAttempts ?? 0, attempt),
			stripeFeeCaptureLastAttemptAt: Date.now(),
			stripeFeeCaptureNextAttemptAt: undefined,
			stripeFeeCaptureError: error,
		});
		return true;
	},
});
