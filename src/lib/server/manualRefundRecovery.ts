import type { ConvexHttpClient } from "convex/browser";
import type Stripe from "stripe";
import {
	type ManualRefundReconciliationResult,
	reconcileSucceededManualRefund,
} from "$lib/server/manualRefundReconciliation";
import { manualRefundRecoveryManifest } from "$lib/server/manualRefundRecoveryManifest";

export interface ManualRefundRecoveryFailureObservations {
	observedAt: number;
	failedChecks: string[];
}

export class ManualRefundRecoveryEvidenceError extends Error {
	constructor(
		message: string,
		readonly observations?: ManualRefundRecoveryFailureObservations,
	) {
		super(message);
	}
}

function providerId(value: string | { id: string } | null | undefined) {
	return typeof value === "string" ? value : value?.id;
}

function hasMetadataKey(metadata: Stripe.Metadata | null | undefined, key: string) {
	return metadata != null && Object.hasOwn(metadata, key);
}

export async function recoverManualRefundFromProvider(adapters: {
	stripe: Stripe;
	convex: ConvexHttpClient;
}): Promise<
	ManualRefundReconciliationResult & {
		providerFailureObservations?: ManualRefundRecoveryFailureObservations;
	}
> {
	const manifest = manualRefundRecoveryManifest;
	const requestOptions = { stripeContext: manifest.stripeContext };
	const [event, currentRefund, paymentIntent] = await Promise.all([
		adapters.stripe.events.retrieve(manifest.stripeEventId, {}, requestOptions),
		adapters.stripe.refunds.retrieve(manifest.stripeRefundId, {}, requestOptions),
		adapters.stripe.paymentIntents.retrieve(manifest.stripePaymentIntentId, {}, requestOptions),
	]);
	const observedAt = Date.now();
	const failedChecks: string[] = [];
	const check = (matches: boolean, name: string) => {
		if (!matches) failedChecks.push(name);
	};

	check(event.id === manifest.stripeEventId, "event.id");
	check(event.type === manifest.stripeEventType, "event.type");
	check(event.api_version === manifest.stripeEventApiVersion, "event.api_version");
	check(event.livemode === manifest.livemode, "event.livemode");
	check(event.account === undefined, "event.account");
	check(event.context === manifest.stripeContext, "event.context");
	check(event.data.object.object === "refund", "event.object");
	const eventRefund = event.data.object as Stripe.Refund;
	check(eventRefund.id === manifest.stripeRefundId, "event_refund.id");
	check(eventRefund.status === "succeeded", "event_refund.status");
	check(eventRefund.amount === manifest.amount, "event_refund.amount");
	check(eventRefund.currency === manifest.currency, "event_refund.currency");
	check(providerId(eventRefund.charge) === manifest.stripeChargeId, "event_refund.charge");
	check(
		providerId(eventRefund.payment_intent) === manifest.stripePaymentIntentId,
		"event_refund.payment_intent",
	);
	check(!hasMetadataKey(eventRefund.metadata, "automated"), "event_refund.automated_metadata");

	check(currentRefund.id === manifest.stripeRefundId, "current_refund.id");
	check(currentRefund.status === "succeeded", "current_refund.status");
	check(currentRefund.amount === manifest.amount, "current_refund.amount");
	check(currentRefund.currency === manifest.currency, "current_refund.currency");
	check(providerId(currentRefund.charge) === manifest.stripeChargeId, "current_refund.charge");
	check(
		providerId(currentRefund.payment_intent) === manifest.stripePaymentIntentId,
		"current_refund.payment_intent",
	);
	check(!hasMetadataKey(currentRefund.metadata, "automated"), "current_refund.automated_metadata");
	check(
		!hasMetadataKey(currentRefund.metadata, manifest.recoveryAuditMetadataKey),
		"current_refund.recovery_audit_metadata",
	);

	check(paymentIntent.id === manifest.stripePaymentIntentId, "payment_intent.id");
	check(paymentIntent.status === "succeeded", "payment_intent.status");
	check(paymentIntent.amount === manifest.amount, "payment_intent.amount");
	check(paymentIntent.amount_received === manifest.amount, "payment_intent.amount_received");
	check(paymentIntent.currency === manifest.currency, "payment_intent.currency");
	check(paymentIntent.livemode === manifest.livemode, "payment_intent.livemode");
	check(
		providerId(paymentIntent.latest_charge) === manifest.stripeChargeId,
		"payment_intent.latest_charge",
	);

	if (failedChecks.length > 0) {
		throw new ManualRefundRecoveryEvidenceError("Manual refund recovery evidence did not match", {
			observedAt,
			failedChecks,
		});
	}

	const result = await reconcileSucceededManualRefund(
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
			providerEvidence: {
				verifiedAt: observedAt,
				currentRefundStatus: "succeeded",
				currentRefundHasAutomatedMetadata: false,
				currentRefundHasRecoveryAuditMetadata: false,
				paymentIntentStatus: "succeeded",
				paymentIntentAmount: paymentIntent.amount,
				paymentIntentAmountReceived: paymentIntent.amount_received,
				paymentIntentCurrency: "usd",
				paymentIntentLivemode: true,
				paymentIntentLatestChargeId: manifest.stripeChargeId,
			},
		},
	);
	return result.kind === "ignored"
		? {
				...result,
				providerFailureObservations: {
					observedAt,
					failedChecks: ["session.reconciliation"],
				},
			}
		: result;
}
