"use node";
/**
 * Stripe fee capture (audit H5).
 *
 * The Stripe balance_transaction (which carries the actual processing fees)
 * isn't available the instant `checkout.session.completed` fires — Stripe
 * finalizes it a second or two later. The webhook used to sleep 3 seconds
 * on the hot path waiting for this, which:
 *
 *   - added 3s of latency to every checkout webhook
 *   - risked Vercel function timeouts under load
 *   - made Stripe retries expensive (each retry sleeps again)
 *
 * Now `orders.create` schedules `captureFeesForOrder` to run after 15s.
 * The action fetches the PI, reads the fee, and patches the order. The
 * webhook returns 200 immediately. If the fee still isn't available on
 * the first attempt, the action reschedules itself up to 3 times (at +60s,
 * +120s). If it never lands, the `stripeFees` field simply stays undefined
 * and manual reconciliation is the same workflow it always was.
 *
 * `"use node"` is required because the Stripe SDK reaches for Node's
 * crypto/http internals, which aren't available in Convex's V8 runtime.
 */

import Stripe from "stripe";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

/**
 * Capture Stripe fees for a single order. Idempotent: short-circuits if
 * fees are already set or if the PI isn't available. Reschedules itself
 * up to `attempt: 3` when the balance_transaction hasn't finalized yet.
 */
export const captureFeesForOrder = internalAction({
	args: { orderId: v.id("orders"), attempt: v.optional(v.number()) },
	handler: async (ctx, { orderId, attempt = 1 }) => {
		if (attempt > 3) return;
		const order = await ctx.runQuery(internal.stripeFeesStore.getOrderForFees, {
			orderId,
		});
		if (!order) return;
		if (order.stripeFees !== undefined) return;
		if (!order.stripePaymentIntentId) return;

		const stripeKey = process.env.STRIPE_SECRET_KEY;
		if (!stripeKey) {
			console.error(
				"[stripeFees] STRIPE_SECRET_KEY not set on Convex deployment; cannot capture fees for order",
				order.orderNumber,
			);
			return;
		}

		const stripe = new Stripe(stripeKey);
		try {
			const pi = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId, {
				expand: ["latest_charge.balance_transaction"],
			});
			const charge = pi.latest_charge;
			const balanceTxn =
				typeof charge === "object" && charge !== null ? charge.balance_transaction : undefined;
			const fees =
				typeof balanceTxn === "object" && balanceTxn !== null ? balanceTxn.fee : undefined;
			if (fees && fees > 0) {
				await ctx.runMutation(internal.stripeFeesStore.setFees, {
					orderId,
					stripeFees: fees,
				});
				console.log(
					`[stripeFees] captured ${fees} cents for order ${order.orderNumber} on attempt ${attempt}`,
				);
				return;
			}
			console.warn(
				`[stripeFees] no fees yet for order ${order.orderNumber} (attempt ${attempt})`,
			);
		} catch (err) {
			console.error(
				`[stripeFees] Stripe API call failed for order ${order.orderNumber} (attempt ${attempt})`,
				err,
			);
		}
		if (attempt < 3) {
			await ctx.scheduler.runAfter(
				60_000,
				internal.stripeFees.captureFeesForOrder,
				{ orderId, attempt: attempt + 1 },
			);
		}
	},
});
