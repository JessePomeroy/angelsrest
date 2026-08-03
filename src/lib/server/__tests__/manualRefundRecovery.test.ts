import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recoverManualRefundFromProvider } from "$lib/server/manualRefundRecovery";
import { manualRefundRecoveryManifest as manifest } from "$lib/server/manualRefundRecoveryManifest";
import { STRIPE_API_VERSION } from "$lib/server/stripeApiVersion";

const { reconcile } = vi.hoisted(() => ({ reconcile: vi.fn() }));

vi.mock("$lib/server/manualRefundReconciliation", () => ({
	reconcileSucceededManualRefund: reconcile,
}));

function refund(overrides: Partial<Stripe.Refund> = {}) {
	return {
		id: manifest.stripeRefundId,
		object: "refund",
		amount: manifest.amount,
		charge: manifest.stripeChargeId,
		currency: manifest.currency,
		metadata: {},
		payment_intent: manifest.stripePaymentIntentId,
		status: "succeeded",
		...overrides,
	} as Stripe.Refund;
}

function event(overrides: Record<string, unknown> = {}) {
	return {
		id: manifest.stripeEventId,
		object: "event",
		api_version: STRIPE_API_VERSION,
		context: manifest.stripeContext,
		data: { object: refund() },
		livemode: true,
		type: "refund.updated",
		...overrides,
	} as unknown as Stripe.Event;
}

function paymentIntent(overrides: Partial<Stripe.PaymentIntent> = {}) {
	return {
		id: manifest.stripePaymentIntentId,
		object: "payment_intent",
		amount: manifest.amount,
		amount_received: manifest.amount,
		currency: manifest.currency,
		latest_charge: manifest.stripeChargeId,
		livemode: true,
		status: "succeeded",
		...overrides,
	} as Stripe.PaymentIntent;
}

function adapters({
	eventValue = event(),
	refundValue = refund(),
	paymentIntentValue = paymentIntent(),
}: {
	eventValue?: Stripe.Event;
	refundValue?: Stripe.Refund;
	paymentIntentValue?: Stripe.PaymentIntent;
} = {}) {
	const retrieveEvent = vi.fn().mockResolvedValue(eventValue);
	const retrieveRefund = vi.fn().mockResolvedValue(refundValue);
	const retrievePaymentIntent = vi.fn().mockResolvedValue(paymentIntentValue);
	const stripe = {
		events: { retrieve: retrieveEvent },
		refunds: { retrieve: retrieveRefund },
		paymentIntents: { retrieve: retrievePaymentIntent },
	} as unknown as Stripe;
	const convex = { mutation: vi.fn() } as never;
	return { stripe, convex, retrieveEvent, retrieveRefund, retrievePaymentIntent };
}

describe("manual refund admin recovery provider evidence", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		reconcile.mockResolvedValue({ kind: "reconciled" });
	});

	it("retrieves exact provider evidence in platform context before reconciliation", async () => {
		const values = adapters();

		await expect(recoverManualRefundFromProvider(values)).resolves.toEqual({
			kind: "reconciled",
		});

		const requestOptions = { stripeContext: manifest.stripeContext };
		expect(values.retrieveEvent).toHaveBeenCalledWith(manifest.stripeEventId, {}, requestOptions);
		expect(values.retrieveRefund).toHaveBeenCalledWith(manifest.stripeRefundId, {}, requestOptions);
		expect(values.retrievePaymentIntent).toHaveBeenCalledWith(
			manifest.stripePaymentIntentId,
			{},
			requestOptions,
		);
		expect(reconcile).toHaveBeenCalledWith(
			expect.objectContaining({ id: manifest.stripeEventId }),
			expect.objectContaining({ stripe: values.stripe, convex: values.convex }),
			"your-account",
			expect.objectContaining({
				recoveryId: manifest.recoveryId,
				manifestVersion: manifest.manifestVersion,
				stripeContext: manifest.stripeContext,
				eventApiVersion: manifest.stripeEventApiVersion,
				expectedSessionId: manifest.stripeSessionId,
				verifiedRefund: expect.objectContaining({ id: manifest.stripeRefundId }),
			}),
		);
	});

	it("returns bounded observations when Session reconciliation rejects the evidence", async () => {
		reconcile.mockResolvedValue({ kind: "ignored", reason: "ambiguous_session" });

		await expect(recoverManualRefundFromProvider(adapters())).resolves.toMatchObject({
			kind: "ignored",
			reason: "ambiguous_session",
			providerFailureObservations: {
				observedAt: expect.any(Number),
				failedChecks: ["session.reconciliation"],
			},
		});
	});

	it.each([
		["event account", { eventValue: event({ account: manifest.stripeContext }) }, "event.account"],
		["event context", { eventValue: event({ context: "acct_wrongcontext1234" }) }, "event.context"],
		[
			"current automated metadata",
			{ refundValue: refund({ metadata: { automated: "fulfillment_recovery_v1" } }) },
			"current_refund.automated_metadata",
		],
		[
			"prior recovery marker",
			{ refundValue: refund({ metadata: { [manifest.recoveryAuditMetadataKey]: "present" } }) },
			"current_refund.recovery_audit_metadata",
		],
		[
			"PaymentIntent charge",
			{ paymentIntentValue: paymentIntent({ latest_charge: "ch_wrongcharge123456" }) },
			"payment_intent.latest_charge",
		],
	] as const)("rejects mismatched %s before reconciliation", async (_label, overrides, check) => {
		const values = adapters(overrides);

		await expect(recoverManualRefundFromProvider(values)).rejects.toMatchObject({
			observations: {
				observedAt: expect.any(Number),
				failedChecks: expect.arrayContaining([check]),
			},
		});
		expect(reconcile).not.toHaveBeenCalled();
	});

	it("propagates provider retrieval failures without reconciliation", async () => {
		const values = adapters();
		values.retrieveRefund.mockRejectedValue(new Error("provider unavailable"));

		await expect(recoverManualRefundFromProvider(values)).rejects.toThrow("provider unavailable");
		expect(reconcile).not.toHaveBeenCalled();
	});
});
