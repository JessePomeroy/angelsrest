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
 * +120s). Every attempt is checkpointed before Stripe is called. A successful
 * read becomes `captured`; attempt 3 becomes durable `failed` state instead of
 * leaving an ambiguous undefined fee forever.
 *
 * `"use node"` is required because the Stripe SDK reaches for Node's
 * crypto/http internals, which aren't available in Convex's V8 runtime.
 */

import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
	FEE_CAPTURE_MAX_ATTEMPTS,
	extractStripeProcessingFeeMinorUnits,
	getFeeCaptureRetryDelayMs,
	isNonnegativeSafeInteger,
	isStripeCurrency,
	normalizeCommerceTenantSiteUrl,
	type StripeFeeCaptureError,
} from "./helpers/stripeFeeCapture";
import { purposeScopedServerRolesAreDisjoint } from "./helpers/serverSecrets";

const STRIPE_API_VERSION = "2026-01-28.clover" as const;
const PAYMENT_INTENT_PENDING_STATUSES = new Set<Stripe.PaymentIntent.Status>([
	"processing",
	"requires_action",
	"requires_capture",
	"requires_confirmation",
]);

/**
 * Record Stripe's provider-reported fee for a single order; this never captures
 * a PaymentIntent or creates a charge. Idempotent: short-circuits if
 * fees are already set or if the PI isn't available. Reschedules itself
 * up to `attempt: 3` when the balance_transaction hasn't finalized yet.
 */
export const captureFeesForOrder = internalAction({
	args: { orderId: v.id("orders"), attempt: v.optional(v.number()) },
	handler: async (ctx, { orderId, attempt = 1 }) => {
		if (!Number.isInteger(attempt) || attempt < 1 || attempt > FEE_CAPTURE_MAX_ATTEMPTS) return;
		const order = await ctx.runQuery(internal.stripeFeesStore.getOrderForFees, {
			orderId,
		});
		if (!order) return;
		if (order.stripeFees !== undefined) return;
		const attemptToken = randomUUID();
		const started = await ctx.runMutation(internal.stripeFeesStore.beginAttempt, {
			orderId,
			attempt,
			attemptToken,
		});
		if (!started) return;
		const recordRecoverableFailure = async (error: StripeFeeCaptureError) => {
			const retryDelayMs = getFeeCaptureRetryDelayMs(attempt);
			if (retryDelayMs !== null) {
				await ctx.runMutation(internal.stripeFeesStore.recordRetry, {
					orderId,
					attempt,
					attemptToken,
					error,
				});
				return;
			}
			await ctx.runMutation(internal.stripeFeesStore.recordFailure, {
				orderId,
				attempt,
				attemptToken,
				error,
			});
		};
		if (!purposeScopedServerRolesAreDisjoint()) {
			console.error("stripe_fee_capture.authority_configuration_invalid");
			await recordRecoverableFailure("authority_configuration_invalid");
			return;
		}
		if (!order.stripePaymentIntentId) {
			await ctx.runMutation(internal.stripeFeesStore.recordFailure, {
				orderId,
				attempt,
				attemptToken,
				error: "payment_intent_missing",
			});
			return;
		}
		const orderTenantSiteUrl = normalizeCommerceTenantSiteUrl(order.siteUrl);
		if (
			!order.stripePaymentIntentId.startsWith("pi_")
			|| order.stripePaymentIntentId.length <= 3
			|| !isStripeCurrency(order.stripePaymentCurrency)
			|| typeof order.stripePaymentLivemode !== "boolean"
			|| !isNonnegativeSafeInteger(order.total)
			|| orderTenantSiteUrl === null
		) {
			await ctx.runMutation(internal.stripeFeesStore.recordFailure, {
				orderId, attempt, attemptToken, error: "payment_projection_invalid",
			});
			console.error("stripe_fee_capture.payment_projection_invalid");
			return;
		}

		const stripeKey = process.env.STRIPE_SECRET_KEY;
		if (!stripeKey) {
			console.error("stripe_fee_capture.stripe_secret_key_missing");
			await ctx.runMutation(internal.stripeFeesStore.recordFailure, {
				orderId,
				attempt,
				attemptToken,
				error: "stripe_secret_key_missing",
			});
			return;
		}

		const stripe = new Stripe(stripeKey, { apiVersion: STRIPE_API_VERSION });
		let failureCode: StripeFeeCaptureError = "balance_transaction_not_ready";
		try {
			const pi = await stripe.paymentIntents.retrieve(
				order.stripePaymentIntentId,
				{ expand: ["latest_charge.balance_transaction"] },
				order.stripeConnectedAccountId
					? { stripeAccount: order.stripeConnectedAccountId }
					: undefined,
			);
			const paymentTenantSiteUrl = normalizeCommerceTenantSiteUrl(
				pi.metadata?.commerceTenantSiteUrl,
			);
			if (
				pi.object !== "payment_intent"
				|| pi.id !== order.stripePaymentIntentId
				|| pi.amount !== order.total
				|| pi.currency !== order.stripePaymentCurrency
				|| pi.livemode !== order.stripePaymentLivemode
				|| paymentTenantSiteUrl === null
				|| paymentTenantSiteUrl !== orderTenantSiteUrl
			) {
				await ctx.runMutation(internal.stripeFeesStore.recordFailure, {
					orderId, attempt, attemptToken, error: "payment_projection_invalid",
				});
				console.error("stripe_fee_capture.payment_projection_invalid");
				return;
			}
			if (pi.status !== "succeeded") {
				if (PAYMENT_INTENT_PENDING_STATUSES.has(pi.status)) {
					console.warn("stripe_fee_capture.payment_not_ready");
					await recordRecoverableFailure("payment_not_ready");
					return;
				}
				await ctx.runMutation(internal.stripeFeesStore.recordFailure, {
					orderId, attempt, attemptToken, error: "payment_projection_invalid",
				});
				console.error("stripe_fee_capture.payment_projection_invalid");
				return;
			}
			if (pi.amount_received !== order.total) {
				await ctx.runMutation(internal.stripeFeesStore.recordFailure, {
					orderId, attempt, attemptToken, error: "payment_projection_invalid",
				});
				console.error("stripe_fee_capture.payment_projection_invalid");
				return;
			}
			const charge = pi.latest_charge;
			if (
				typeof charge !== "object"
				|| charge === null
				|| charge.object !== "charge"
				|| !charge.id.startsWith("ch_")
				|| (typeof charge.payment_intent === "string"
					? charge.payment_intent
					: charge.payment_intent?.id) !== order.stripePaymentIntentId
				|| charge.amount !== order.total
				|| charge.amount_captured !== order.total
				|| charge.paid !== true
				|| charge.captured !== true
				|| charge.currency !== order.stripePaymentCurrency
				|| charge.livemode !== order.stripePaymentLivemode
			) {
				await ctx.runMutation(internal.stripeFeesStore.recordFailure, {
					orderId, attempt, attemptToken, error: "provider_object_mismatch",
				});
				console.error("stripe_fee_capture.provider_object_mismatch");
				return;
			}
			const balanceTxn = charge.balance_transaction;
			const processingFeeMinorUnits =
				typeof balanceTxn === "object" && balanceTxn !== null
					? extractStripeProcessingFeeMinorUnits(balanceTxn)
					: null;
			const balanceSource = typeof balanceTxn === "object" && balanceTxn !== null
				? balanceTxn.source : undefined;
			const balanceSourceId = typeof balanceSource === "string" ? balanceSource : balanceSource?.id;
			if (
				typeof balanceTxn === "object"
				&& balanceTxn !== null
				&& balanceTxn.object === "balance_transaction"
				&& balanceTxn.id.startsWith("txn_")
				&& balanceTxn.type === "charge"
				&& balanceTxn.reporting_category === "charge"
				&& balanceSourceId === charge.id
				&& isStripeCurrency(balanceTxn.currency)
				&& isNonnegativeSafeInteger(balanceTxn.amount)
				&& (balanceTxn.currency !== charge.currency || balanceTxn.amount === charge.amount)
				&& isNonnegativeSafeInteger(balanceTxn.fee)
				&& Number.isSafeInteger(balanceTxn.net)
				&& balanceTxn.net === balanceTxn.amount - balanceTxn.fee
				&& (balanceTxn.status === "pending" || balanceTxn.status === "available")
			) {
				if (processingFeeMinorUnits === null) {
					console.warn("stripe_fee_capture.fee_breakdown_not_ready");
					await recordRecoverableFailure("fee_breakdown_not_ready");
					return;
				}
				const stored = await ctx.runMutation(internal.stripeFeesStore.setFees, {
					orderId,
					stripeFees: processingFeeMinorUnits,
					stripeFeeCurrency: balanceTxn.currency,
					stripeFeeChargeId: charge.id,
					stripeFeeBalanceTransactionId: balanceTxn.id,
					attempt,
					attemptToken,
				});
				if (stored) {
					console.log("stripe_fee_capture.captured");
				}
				return;
			}
			if (balanceTxn !== null && balanceTxn !== undefined && typeof balanceTxn === "object") {
				await ctx.runMutation(internal.stripeFeesStore.recordFailure, {
					orderId, attempt, attemptToken, error: "provider_object_mismatch",
				});
				console.error("stripe_fee_capture.provider_object_mismatch");
				return;
			}
			console.warn("stripe_fee_capture.balance_transaction_not_ready");
		} catch {
			failureCode = "stripe_api_error";
			console.error("stripe_fee_capture.stripe_api_error");
		}
		await recordRecoverableFailure(failureCode);
	},
});

/** Paid-safe, identity-fenced cleanup for one bound checkout snapshot reservation. */
export const reconcileCheckoutSnapshotReservation = internalAction({
	args: {
		reservationId: v.id("checkoutSnapshotReservations"),
		boundAt: v.number(),
		attempt: v.number(),
	},
	handler: async (ctx, args) => {
		if (!Number.isInteger(args.attempt) || args.attempt < 0 || args.attempt > 3) return;
		const row: { stripeSessionId: string; stripeConnectedAccountId?: string } | null =
			await ctx.runQuery(internal.orders.getCheckoutSnapshotForReconciliation, {
				reservationId: args.reservationId, boundAt: args.boundAt, attempt: args.attempt,
			});
		if (!row) return;
		let paid = false;
		let expiredUnpaid = false;
		let providerSessionVerified = false;
		const stripeKey = process.env.STRIPE_SECRET_KEY;
		if (stripeKey && purposeScopedServerRolesAreDisjoint()) {
			try {
				const session = await new Stripe(stripeKey, {
					apiVersion: STRIPE_API_VERSION,
				}).checkout.sessions.retrieve(
					row.stripeSessionId, {}, row.stripeConnectedAccountId
						? { stripeAccount: row.stripeConnectedAccountId } : undefined,
				);
				providerSessionVerified = true;
				paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
				expiredUnpaid = session.status === "expired" && session.payment_status === "unpaid";
			} catch {
				// Provider uncertainty retains the row and follows the bounded retry ladder below.
			}
		}
		if (expiredUnpaid) {
			await ctx.runMutation(internal.orders.deleteExpiredUnpaidCheckoutSnapshot, {
				reservationId: args.reservationId, boundAt: args.boundAt, attempt: args.attempt,
			});
			return;
		}
		const retained: { alert: boolean } = await ctx.runMutation(
			internal.orders.retainCheckoutSnapshot,
			{
				reservationId: args.reservationId, boundAt: args.boundAt, attempt: args.attempt,
				paid, providerSessionVerified,
			},
		);
		if (retained.alert) {
			console.error(paid
				? "checkout_snapshot_reservation.paid_without_order"
				: "checkout_snapshot_reservation.reconciliation_uncertain");
		}
	},
});

/**
 * Paid-safe reconciliation for the universal R4 admission protocol. Linked
 * snapshot state is updated by the same mutation, so each attempt performs at
 * most one provider read and unknown provider state remains durable.
 */
export const reconcileCheckoutSessionAdmission = internalAction({
	args: {
		admissionId: v.id("checkoutSessionAdmissions"),
		boundAt: v.number(),
		attempt: v.number(),
	},
	handler: async (ctx, args) => {
		if (!Number.isInteger(args.attempt) || args.attempt < 0 || args.attempt > 3) return;
		const row: { stripeSessionId: string; stripeConnectedAccountId?: string } | null =
			await ctx.runQuery(internal.commerceClosure.getCheckoutAdmissionForReconciliation, {
				admissionId: args.admissionId,
				boundAt: args.boundAt,
				attempt: args.attempt,
			});
		if (!row) return;
		let paid = false;
		let expiredUnpaid = false;
		let providerSessionVerified = false;
		const stripeKey = process.env.STRIPE_SECRET_KEY;
		if (stripeKey && purposeScopedServerRolesAreDisjoint()) {
			try {
				const session = await new Stripe(stripeKey, {
					apiVersion: STRIPE_API_VERSION,
				}).checkout.sessions.retrieve(
					row.stripeSessionId,
					{},
					row.stripeConnectedAccountId
						? { stripeAccount: row.stripeConnectedAccountId }
						: undefined,
				);
				providerSessionVerified = true;
				paid = session.payment_status === "paid"
					|| session.payment_status === "no_payment_required";
				expiredUnpaid = session.status === "expired"
					&& session.payment_status === "unpaid";
			} catch {
				// Provider uncertainty follows the bounded retry ladder and remains durable.
			}
		}
		const result: { alert: "paid_without_order" | "reconciliation_uncertain" | null } =
			await ctx.runMutation(
				internal.commerceClosure.recordCheckoutAdmissionReconciliation,
				{
					admissionId: args.admissionId,
					boundAt: args.boundAt,
					attempt: args.attempt,
					paid,
					expiredUnpaid,
					providerSessionVerified,
				},
			);
		if (result.alert === "paid_without_order") {
			console.error("checkout_session_admission.paid_without_order");
		} else if (result.alert === "reconciliation_uncertain") {
			console.error("checkout_session_admission.reconciliation_uncertain");
		}
	},
});
