import type Stripe from "stripe";
import {
	type ApplicationFeeError, type ApplicationFeeObservation, type ApplicationFeeOrder,
	providerId, validApplicationFeeContext,
} from "./applicationFeeVerification";
import { isNonnegativeSafeInteger as cents, normalizeCommerceTenantSiteUrl } from "./stripeFeeCapture";

export class ApplicationFeeReadError extends Error {
	constructor(readonly code: ApplicationFeeError) {
		super(code);
	}
}

function id(value: string | { id: string } | null | undefined) {
	return typeof value === "string" ? value : value?.id;
}

function mismatch(): never {
	throw new ApplicationFeeReadError("provider_object_mismatch");
}

/** Only retrieval APIs. Never chooses today's connection or creates provider objects. */
export async function readApplicationFee(stripe: Stripe, order: ApplicationFeeOrder): Promise<ApplicationFeeObservation> {
	const saved = order.checkoutFinancialSnapshot;
	if (!saved || !validApplicationFeeContext(order)) throw new ApplicationFeeReadError("original_context_invalid");
	const [platform, balance] = await Promise.all([stripe.accounts.retrieve(), stripe.balance.retrieve()]);
	if (platform.object !== "account" || platform.id !== saved.stripePlatformAccountId
		|| balance.object !== "balance" || balance.livemode !== saved.stripeLivemode) mismatch();
	const scope = { stripeAccount: saved.stripeConnectedAccountId };
	const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId, {}, scope);
	const tenantSite = normalizeCommerceTenantSiteUrl(order.siteUrl);
	if (!tenantSite || session.object !== "checkout.session" || session.id !== order.stripeSessionId
		|| session.mode !== "payment" || session.currency !== saved.currency
		|| session.livemode !== saved.stripeLivemode || session.amount_total !== order.total
		|| session.amount_subtotal !== saved.subtotalCents
		|| session.metadata?.commerceTenantId !== saved.tenantId
		|| normalizeCommerceTenantSiteUrl(session.metadata?.commerceTenantSiteUrl) !== tenantSite) mismatch();
	if (session.status !== "complete" || session.payment_status === "unpaid") {
		throw new ApplicationFeeReadError("payment_not_ready");
	}
	const base = { stripeSessionId: session.id, currency: saved.currency,
		subtotalCents: saved.subtotalCents, totalCents: order.total };
	if (order.total === 0 && order.stripePaymentIntentId === undefined) {
		if (session.payment_status !== "no_payment_required" || session.payment_intent !== null) mismatch();
		return { ...base, applicationFeeAmountCents: 0, applicationFeeRefundedCents: 0,
			payment: { kind: "no_payment_required" } };
	}
	if (session.payment_status !== "paid" || !order.stripePaymentIntentId
		|| id(session.payment_intent) !== order.stripePaymentIntentId) mismatch();
	const pi = await stripe.paymentIntents.retrieve(order.stripePaymentIntentId, { expand: ["latest_charge"] }, scope);
	if (pi.object !== "payment_intent" || pi.id !== order.stripePaymentIntentId
		|| pi.amount !== order.total || pi.currency !== saved.currency || pi.livemode !== saved.stripeLivemode
		|| pi.metadata?.commerceTenantId !== saved.tenantId
		|| normalizeCommerceTenantSiteUrl(pi.metadata?.commerceTenantSiteUrl) !== tenantSite) mismatch();
	if (pi.status !== "succeeded") {
		if (["processing", "requires_action", "requires_capture", "requires_confirmation"].includes(pi.status)) {
			throw new ApplicationFeeReadError("payment_not_ready");
		}
		mismatch();
	}
	if (pi.amount_received !== order.total) mismatch();
	const charge = pi.latest_charge;
	if (!charge || typeof charge !== "object" || charge.object !== "charge"
		|| !providerId(charge.id, "ch_") || id(charge.payment_intent) !== pi.id
		|| charge.amount !== order.total || charge.amount_captured !== order.total
		|| charge.paid !== true || charge.captured !== true || charge.status !== "succeeded"
		|| charge.currency !== saved.currency || charge.livemode !== saved.stripeLivemode
		|| !cents(charge.amount_refunded) || charge.amount_refunded > order.total) mismatch();
	// Null is Stripe's explicit absence; a missing/malformed field is not zero.
	const requested = pi.application_fee_amount === null ? 0 : pi.application_fee_amount;
	const chargeRequested = charge.application_fee_amount === null ? 0 : charge.application_fee_amount;
	if (!cents(requested) || requested > order.total || chargeRequested !== requested) mismatch();
	const payment = { kind: "paid" as const, stripePaymentIntentId: pi.id, stripeChargeId: charge.id,
		requestedApplicationFeeCents: requested, customerRefundedCents: charge.amount_refunded };
	if (charge.application_fee === null && requested === 0) {
		return { ...base, applicationFeeAmountCents: 0, applicationFeeRefundedCents: 0,
			payment: { ...payment, stripeApplicationFeeId: null } };
	}
	if (charge.application_fee === null) throw new ApplicationFeeReadError("fee_not_ready");
	const feeId = id(charge.application_fee);
	if (!providerId(feeId, "fee_")) mismatch();
	// Application fees belong to the verified platform, unlike the direct payment.
	const fee = await stripe.applicationFees.retrieve(feeId);
	if (fee.object !== "application_fee" || fee.id !== feeId
		|| id(fee.account) !== saved.stripeConnectedAccountId || id(fee.charge) !== charge.id
		|| fee.currency !== saved.currency || fee.livemode !== saved.stripeLivemode
		|| !providerId(id(fee.application), "ca_") || id(fee.application) !== id(charge.application)
		|| id(fee.application) !== id(pi.application) || fee.originating_transaction !== null
		|| !cents(fee.amount) || fee.amount > order.total
		|| !cents(fee.amount_refunded) || fee.amount_refunded > fee.amount
		|| fee.refunded !== (fee.amount_refunded === fee.amount)) mismatch();
	return { ...base, applicationFeeAmountCents: fee.amount, applicationFeeRefundedCents: fee.amount_refunded,
		payment: { ...payment, stripeApplicationFeeId: fee.id } };
}
