import { type Infer, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { isStripeCheckoutSessionId, isStripeConnectedAccountId } from "./checkoutSnapshot";
import { calculatePrintFeeAmount, calculatePrintSubtotalCents } from "./printFeePolicy";
import { isNonnegativeSafeInteger as cents } from "./stripeFeeCapture";
import { isTenantId } from "./tenantContext";

export const APPLICATION_FEE_INITIAL_DELAY_MS = 15_000;
export const APPLICATION_FEE_LEASE_MS = 90_000;
export const APPLICATION_FEE_RETRY_DELAYS = [60_000, 300_000, 1_800_000] as const;
export const APPLICATION_FEE_MAX_ATTEMPTS = APPLICATION_FEE_RETRY_DELAYS.length + 1;

export const applicationFeeErrorValidator = v.union(
	v.literal("configuration_unavailable"), v.literal("original_context_invalid"),
	v.literal("provider_unavailable"), v.literal("provider_object_mismatch"),
	v.literal("payment_not_ready"), v.literal("fee_not_ready"),
	v.literal("attempt_expired"), v.literal("fee_amount_mismatch"),
);
export type ApplicationFeeError = Infer<typeof applicationFeeErrorValidator>;

/** Provider observations at one read, not an ongoing refund or payout ledger. */
export const applicationFeeObservationValidator = v.object({
	stripeSessionId: v.string(),
	currency: v.literal("usd"),
	subtotalCents: v.number(),
	totalCents: v.number(),
	applicationFeeAmountCents: v.number(),
	applicationFeeRefundedCents: v.number(),
	payment: v.union(
		v.object({ kind: v.literal("no_payment_required") }),
		v.object({
			kind: v.literal("paid"), stripePaymentIntentId: v.string(), stripeChargeId: v.string(),
			stripeApplicationFeeId: v.union(v.string(), v.null()),
			requestedApplicationFeeCents: v.number(), customerRefundedCents: v.number(),
		}),
	),
});
export type ApplicationFeeObservation = Infer<typeof applicationFeeObservationValidator>;
export type ApplicationFeeOrder = Pick<Doc<"orders">,
	"siteUrl" | "tenantId" | "stripeSessionId" | "stripePaymentIntentId" |
	"stripeConnectedAccountId" | "stripePaymentCurrency" | "stripePaymentLivemode" |
	"total" | "checkoutFinancialSnapshot">;

export function validApplicationFeeContext(order: ApplicationFeeOrder) {
	const saved = order.checkoutFinancialSnapshot;
	if (!saved || !isTenantId(saved.tenantId) || saved.tenantId !== order.tenantId
		|| !isStripeConnectedAccountId(saved.stripePlatformAccountId)
		|| !isStripeConnectedAccountId(saved.stripeConnectedAccountId)
		|| saved.stripePlatformAccountId === saved.stripeConnectedAccountId
		|| saved.stripeConnectedAccountId !== order.stripeConnectedAccountId
		|| saved.currency !== order.stripePaymentCurrency
		|| saved.stripeLivemode !== order.stripePaymentLivemode
		|| !isStripeCheckoutSessionId(order.stripeSessionId) || !cents(order.total)
		|| !cents(saved.subtotalCents) || !cents(saved.printSubtotalCents)
		|| saved.lines.length < 1 || saved.lines.length > 40
		|| saved.lines.some(line => !cents(line.unitPriceCents)
			|| !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20)
		|| (order.total > 0 && !providerId(order.stripePaymentIntentId, "pi_"))) return false;
	try {
		return saved.subtotalCents === saved.lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0)
			&& saved.printSubtotalCents === calculatePrintSubtotalCents(saved.lines)
			&& saved.applicationFeeAmountCents === calculatePrintFeeAmount(saved.printSubtotalCents);
	} catch {
		return false;
	}
}

export function providerId(value: unknown, prefix: string): value is string {
	return typeof value === "string" && value.startsWith(prefix)
		&& value.length > prefix.length && value.length <= 255 && /^[a-zA-Z0-9_]+$/.test(value);
}

export function validApplicationFeeObservation(order: ApplicationFeeOrder, observed: ApplicationFeeObservation) {
	if (!validApplicationFeeContext(order)
		|| observed.stripeSessionId !== order.stripeSessionId
		|| observed.currency !== order.stripePaymentCurrency
		|| observed.subtotalCents !== order.checkoutFinancialSnapshot?.subtotalCents
		|| observed.totalCents !== order.total
		|| !cents(observed.applicationFeeAmountCents) || observed.applicationFeeAmountCents > order.total
		|| !cents(observed.applicationFeeRefundedCents)
		|| observed.applicationFeeRefundedCents > observed.applicationFeeAmountCents) return false;
	const payment = observed.payment;
	if (payment.kind === "no_payment_required") {
		return order.total === 0 && order.stripePaymentIntentId === undefined
			&& observed.applicationFeeAmountCents === 0 && observed.applicationFeeRefundedCents === 0;
	}
	return payment.stripePaymentIntentId === order.stripePaymentIntentId
		&& providerId(payment.stripePaymentIntentId, "pi_") && providerId(payment.stripeChargeId, "ch_")
		&& cents(payment.requestedApplicationFeeCents) && payment.requestedApplicationFeeCents <= order.total
		&& cents(payment.customerRefundedCents) && payment.customerRefundedCents <= order.total
		&& (payment.stripeApplicationFeeId === null
			? payment.requestedApplicationFeeCents === 0 && observed.applicationFeeAmountCents === 0
			: providerId(payment.stripeApplicationFeeId, "fee_"));
}

export function applicationFeeMatchesExpectation(order: ApplicationFeeOrder, observed: ApplicationFeeObservation) {
	return observed.applicationFeeAmountCents === order.checkoutFinancialSnapshot?.applicationFeeAmountCents
		&& (observed.payment.kind === "no_payment_required"
			|| observed.payment.requestedApplicationFeeCents === observed.applicationFeeAmountCents);
}
