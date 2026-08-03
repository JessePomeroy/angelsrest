import type { ConvexHttpClient } from "convex/browser";
import type Stripe from "stripe";
import {
	type ManualRefundReconciliationResult,
	reconcileSucceededManualRefund,
} from "$lib/server/manualRefundReconciliation";
import { manualRefundRecoveryManifest } from "$lib/server/manualRefundRecoveryManifest";

export class ManualRefundRecoveryEvidenceError extends Error {}

function providerId(value: string | { id: string } | null | undefined) {
	return typeof value === "string" ? value : value?.id;
}

function hasMetadataKey(metadata: Stripe.Metadata | null, key: string) {
	return metadata !== null && Object.hasOwn(metadata, key);
}

function evidenceError() {
	throw new ManualRefundRecoveryEvidenceError("Manual refund recovery evidence did not match");
}

export async function recoverManualRefundFromProvider(adapters: {
	stripe: Stripe;
	convex: ConvexHttpClient;
}): Promise<ManualRefundReconciliationResult> {
	const manifest = manualRefundRecoveryManifest;
	const requestOptions = { stripeContext: manifest.stripeContext };
	const [event, currentRefund, paymentIntent] = await Promise.all([
		adapters.stripe.events.retrieve(manifest.stripeEventId, {}, requestOptions),
		adapters.stripe.refunds.retrieve(manifest.stripeRefundId, {}, requestOptions),
		adapters.stripe.paymentIntents.retrieve(manifest.stripePaymentIntentId, {}, requestOptions),
	]);

	if (
		event.id !== manifest.stripeEventId ||
		event.type !== manifest.stripeEventType ||
		event.api_version !== manifest.stripeEventApiVersion ||
		event.livemode !== manifest.livemode ||
		event.account !== undefined ||
		event.context !== manifest.stripeContext ||
		event.data.object.object !== "refund"
	)
		evidenceError();
	const eventRefund = event.data.object as Stripe.Refund;
	if (
		eventRefund.id !== manifest.stripeRefundId ||
		eventRefund.status !== "succeeded" ||
		eventRefund.amount !== manifest.amount ||
		eventRefund.currency !== manifest.currency ||
		providerId(eventRefund.charge) !== manifest.stripeChargeId ||
		providerId(eventRefund.payment_intent) !== manifest.stripePaymentIntentId ||
		hasMetadataKey(eventRefund.metadata, "automated")
	)
		evidenceError();

	if (
		currentRefund.id !== manifest.stripeRefundId ||
		currentRefund.status !== "succeeded" ||
		currentRefund.amount !== manifest.amount ||
		currentRefund.currency !== manifest.currency ||
		providerId(currentRefund.charge) !== manifest.stripeChargeId ||
		providerId(currentRefund.payment_intent) !== manifest.stripePaymentIntentId ||
		hasMetadataKey(currentRefund.metadata, "automated") ||
		hasMetadataKey(currentRefund.metadata, manifest.recoveryAuditMetadataKey)
	)
		evidenceError();

	if (
		paymentIntent.id !== manifest.stripePaymentIntentId ||
		paymentIntent.status !== "succeeded" ||
		paymentIntent.amount !== manifest.amount ||
		paymentIntent.amount_received !== manifest.amount ||
		paymentIntent.currency !== manifest.currency ||
		paymentIntent.livemode !== manifest.livemode ||
		providerId(paymentIntent.latest_charge) !== manifest.stripeChargeId
	)
		evidenceError();

	return await reconcileSucceededManualRefund(
		event as Stripe.RefundUpdatedEvent,
		adapters,
		"your-account",
		{
			recoveryId: manifest.recoveryId,
			manifestVersion: manifest.manifestVersion,
			stripeContext: manifest.stripeContext,
			eventApiVersion: manifest.stripeEventApiVersion,
			expectedSessionId: manifest.stripeSessionId,
			verifiedRefund: currentRefund,
		},
	);
}
