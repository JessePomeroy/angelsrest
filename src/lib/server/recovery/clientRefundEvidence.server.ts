import { randomUUID } from "node:crypto";
import type { ConvexHttpClient } from "convex/browser";
import type Stripe from "stripe";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import {
	readCheckoutTenantIdMarker,
	readCheckoutTenantMarker,
} from "$lib/server/checkoutSnapshotConsumer";
import { getWebhookSecret } from "$lib/server/webhookSecret";

export const CLIENT_REFUND_READ_OPTIONS = { timeout: 10_000, maxNetworkRetries: 0 } as const;

/** Backend-first adoption: hosting a new consumer does not enable its protocol. */
export function isClientRefundEvidenceEnabled() {
	return env.CLIENT_REFUND_EVIDENCE_ENABLED === "true";
}
function isRefundStatus(
	value: unknown,
): value is "pending" | "requires_action" | "succeeded" | "failed" | "canceled" {
	return (
		value === "pending" ||
		value === "requires_action" ||
		value === "succeeded" ||
		value === "failed" ||
		value === "canceled"
	);
}

export class ClientRefundEvidenceError extends Error {}

function objectId(value: string | { id: string } | null) {
	return typeof value === "string" ? value : value?.id;
}

/** Observe current provider truth before the existing whole-order recovery path. */
async function recordClientRefundObservation({
	stripe,
	convex,
	eventId,
	accountId,
	eventLivemode,
	refund,
	session,
}: {
	stripe: Stripe;
	convex: ConvexHttpClient;
	eventId: string;
	accountId: string | undefined;
	eventLivemode: boolean;
	refund: Stripe.Refund;
	session: Stripe.Checkout.Session;
}): Promise<Stripe.Refund | null> {
	const tenantId = readCheckoutTenantIdMarker(session.metadata);
	if (!isClientRefundEvidenceEnabled() || !accountId) return null;
	const paymentIntentId = objectId(refund.payment_intent);
	if (!paymentIntentId) throw new ClientRefundEvidenceError("Refund payment identity is missing");
	const webhookSecret = getWebhookSecret();
	const claimToken = randomUUID();
	const claim = await convex.mutation(api.orders.beginClientRefundObservation, {
		webhookSecret,
		claimToken,
		stripeEventId: eventId,
		stripeSessionId: session.id,
		stripeConnectedAccountId: accountId,
		stripePaymentIntentId: paymentIntentId,
		stripeRefundId: refund.id,
	});
	if (claim.kind === "legacy") return null;
	if (claim.kind === "busy")
		throw new ClientRefundEvidenceError("Refund observation is already in progress");
	let issue: "provider_unavailable" | "evidence_mismatch" = "provider_unavailable";
	function mismatch(): never {
		issue = "evidence_mismatch";
		throw new ClientRefundEvidenceError("Refund evidence does not match its original checkout");
	}
	try {
		const context = claim.context;
		if (
			context.tenantId !== tenantId ||
			session.metadata?.type === "invoice_payment" ||
			context.siteUrl !== readCheckoutTenantMarker(session.metadata) ||
			context.stripeConnectedAccountId !== accountId ||
			context.stripeLivemode !== eventLivemode ||
			session.object !== "checkout.session" ||
			session.currency !== context.currency ||
			session.mode !== "payment" ||
			session.status !== "complete" ||
			session.payment_status !== "paid" ||
			session.livemode !== context.stripeLivemode ||
			session.amount_subtotal !== context.subtotalCents ||
			!Number.isSafeInteger(session.amount_total) ||
			session.amount_total === null ||
			session.amount_total <= 0 ||
			(context.totalCents !== undefined && context.totalCents !== session.amount_total) ||
			objectId(session.payment_intent) !== paymentIntentId
		)
			mismatch();
		const scoped = {
			...CLIENT_REFUND_READ_OPTIONS,
			stripeAccount: context.stripeConnectedAccountId,
		};
		const [platform, balance, current] = await Promise.all([
			stripe.accounts.retrieve(CLIENT_REFUND_READ_OPTIONS),
			stripe.balance.retrieve(CLIENT_REFUND_READ_OPTIONS),
			stripe.refunds.retrieve(refund.id, scoped),
		]);
		if (
			platform.object !== "account" ||
			platform.id !== context.stripePlatformAccountId ||
			balance.object !== "balance" ||
			balance.livemode !== context.stripeLivemode ||
			current.object !== "refund" ||
			current.id !== refund.id ||
			current.amount !== refund.amount ||
			!Number.isSafeInteger(current.amount) ||
			current.amount <= 0 ||
			current.amount > session.amount_total ||
			current.currency !== context.currency ||
			objectId(current.payment_intent) !== paymentIntentId ||
			objectId(current.charge) !== objectId(refund.charge) ||
			!isRefundStatus(current.status)
		)
			mismatch();
		const chargeId = objectId(current.charge);
		if (!chargeId || !/^ch_[A-Za-z0-9]{8,120}$/.test(chargeId)) mismatch();
		const charge = await stripe.charges.retrieve(chargeId, scoped);
		if (
			charge.object !== "charge" ||
			charge.id !== chargeId ||
			objectId(charge.payment_intent) !== paymentIntentId ||
			charge.amount !== session.amount_total ||
			charge.amount_captured !== session.amount_total ||
			charge.paid !== true ||
			charge.captured !== true ||
			charge.status !== "succeeded" ||
			charge.currency !== context.currency ||
			charge.livemode !== context.stripeLivemode
		)
			mismatch();
		const stored = await convex.mutation(api.orders.finishClientRefundObservation, {
			webhookSecret,
			claimToken,
			evidenceId: claim.evidenceId,
			observation: {
				amountCents: current.amount,
				totalCents: session.amount_total,
				subtotalCents: context.subtotalCents,
				currency: context.currency,
				stripeChargeId: chargeId,
				status: current.status,
			},
		});
		if (!stored) throw new ClientRefundEvidenceError("Refund observation claim expired");
		return current;
	} catch (cause) {
		await convex.mutation(api.orders.failClientRefundObservation, {
			webhookSecret,
			claimToken,
			evidenceId: claim.evidenceId,
			issue,
		});
		if (cause instanceof ClientRefundEvidenceError) throw cause;
		throw new ClientRefundEvidenceError("Refund provider observation is unavailable");
	}
}

/** All observation failures retry without suggesting manual fulfillment of a refunded order. */
export async function observeClientRefund(
	args: Parameters<typeof recordClientRefundObservation>[0],
) {
	try {
		return await recordClientRefundObservation(args);
	} catch (cause) {
		if (cause instanceof ClientRefundEvidenceError) throw cause;
		// This also covers uncertain begin/failure persistence; the durable lease expires independently.
		throw new ClientRefundEvidenceError("Refund observation is unavailable");
	}
}
