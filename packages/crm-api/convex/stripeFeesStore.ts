/**
 * V8-runtime helpers for the `stripeFees` action (audit H5). Separated from
 * `stripeFees.ts` because that file uses `"use node"` to access the Stripe
 * SDK's Node internals — and Convex requires queries/mutations to run in
 * the V8 runtime. This file is V8-only; it owns the DB side of the
 * fee-capture flow.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

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
			stripeFees: order.stripeFees,
		};
	},
});

/**
 * Patch the order with the resolved fees.
 */
export const setFees = internalMutation({
	args: { orderId: v.id("orders"), stripeFees: v.number() },
	handler: async (ctx, { orderId, stripeFees }) => {
		await ctx.db.patch(orderId, { stripeFees });
	},
});
