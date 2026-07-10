/**
 * Order creation and management for the Stripe webhook.
 *
 * Handles idempotent Convex order creation, print fulfillment, and the
 * permanent-failure refund path. Stripe fee capture is scheduled by the Convex
 * order mutation rather than performed on the webhook request.
 */

import type { ConvexHttpClient } from "convex/browser";
import type { Resend } from "resend";
import type Stripe from "stripe";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import {
	ANGELS_REST_COMMERCE_PROFILE,
	type CommerceNotificationProfile,
} from "$lib/server/commerceTenant";
import { logStructured } from "$lib/server/logger";
import {
	handlePermanentFulfillmentFailure,
	handlePrintFulfillmentFailure,
	type PrintFulfillmentOutcome,
	type SubmitLumaPrintsOrder,
	submitPrintFulfillment,
} from "$lib/server/printFulfillment";
import type { ShippingDetails } from "$lib/server/webhookEmails";
import { buildConvexOrderCreatePayload } from "$lib/server/webhookOrderPayload";
import { getWebhookSecret } from "$lib/server/webhookSecret";

export { handlePermanentFulfillmentFailure };

export interface CreatedOrderResult {
	orderNumber: string;
	_id: Id<"orders">;
	alreadyExisted: boolean;
	fulfillment: PrintFulfillmentOutcome;
	notification: "success" | "failure" | "none";
}

/**
 * Create an order in Convex.
 *
 * Convex schedules Stripe fee capture after creation because the
 * balance_transaction is not always available when checkout completes.
 */
export async function createOrderInConvex(
	{
		stripe,
		convex,
		resend,
		createLumaPrintsOrder,
	}: {
		stripe: Stripe;
		convex: ConvexHttpClient;
		resend: Resend;
		createLumaPrintsOrder: SubmitLumaPrintsOrder;
	},
	{
		session,
		shippingDetails,
		lineItems,
		siteUrl,
		stripeRequestOptions,
		notificationProfile = ANGELS_REST_COMMERCE_PROFILE,
	}: {
		session: Stripe.Checkout.Session;
		shippingDetails: ShippingDetails;
		lineItems: Stripe.LineItem[];
		siteUrl: string;
		stripeRequestOptions?: Stripe.RequestOptions;
		notificationProfile?: CommerceNotificationProfile;
	},
): Promise<CreatedOrderResult> {
	// Create order in Convex (idempotent — returns existing order if session already processed)
	const orderResult = await convex.mutation(
		api.orders.create,
		buildConvexOrderCreatePayload({
			session,
			shippingDetails,
			lineItems,
			siteUrl,
			webhookSecret: getWebhookSecret(),
		}),
	);
	const { _id: orderId, orderNumber, alreadyExisted } = orderResult;
	const existingLumaprintsOrderNumber = orderResult.lumaprintsOrderNumber;
	const existingStatus = orderResult.status;
	const existingStripeFees = orderResult.stripeFees;
	const existingFulfillmentError = orderResult.fulfillmentError;
	const existingStripeRefundId = orderResult.stripeRefundId;
	const existingRecoveryStatus = orderResult.fulfillmentRecoveryStatus;

	logStructured({
		event: alreadyExisted ? "order.rehydrated" : "order.created",
		stage: "order_create",
		orderId: orderNumber,
		meta: { alreadyExisted },
	});

	// Fee capture runs off the hot path (audit H5): `orders.create` schedules
	// `stripeFees.captureFeesForOrder` to run 15s after the order is created,
	// so the webhook doesn't block on Stripe's balance_transaction becoming
	// available. See convex/stripeFees.ts for the action + retry policy.
	if (existingStripeFees !== undefined) {
		logStructured({
			event: "stripe_fees.skipped",
			stage: "order_create",
			orderId: orderNumber,
			meta: { reason: "already captured", stripeFees: existingStripeFees },
		});
	}

	// Critical: LumaPrints submission.
	//
	// Idempotency guard (audit C13): if a prior webhook retry already submitted
	// this order to LumaPrints, `orders.create` returns the persisted
	// `lumaprintsOrderNumber`. We short-circuit here to prevent double-submission
	// which would otherwise produce two physical prints for one charge.
	//
	// Failure handling has two branches:
	// - **Transient errors** (network, LumaPrints 5xx, unknown) are rethrown so
	//   Stripe retries. Convex order creation is idempotent by checkout session.
	// - **Permanent errors** (LumaPrints 4xx and local validation failures) enter
	//   the refund/failure-state/admin-alert path. These side effects are recorded
	//   independently; `fulfillment_error` must not be treated as proof that the
	//   refund or email succeeded without their corresponding delivery fields.
	//
	// Classification lives in `webhookErrorClassification.ts` and is
	// conservative: unknown errors default to transient so we don't refund
	// customers based on our own bugs.
	if (existingLumaprintsOrderNumber) {
		logStructured({
			event: "lumaprints.skipped",
			stage: "lumaprints_submit",
			orderId: orderNumber,
			meta: {
				reason: "already submitted on prior webhook attempt",
				lumaprintsOrderNumber: existingLumaprintsOrderNumber,
			},
		});
		return {
			orderNumber,
			_id: orderId,
			alreadyExisted,
			fulfillment: {
				kind: "fulfilled",
				lumaprintsOrderNumber: existingLumaprintsOrderNumber,
			},
			notification: "none",
		};
	}

	if (alreadyExisted && existingRecoveryStatus === "refunded" && !existingStripeRefundId) {
		throw new Error(`Order ${orderNumber} is marked refunded without a Stripe refund ID`);
	}

	if (
		alreadyExisted &&
		existingStripeRefundId &&
		(existingRecoveryStatus === "refunded" || existingStatus === "fulfillment_error")
	) {
		logStructured({
			event: "lumaprints.skipped",
			stage: "lumaprints_submit",
			orderId: orderNumber,
			meta: {
				reason: "permanent failure was already refunded",
				stripeRefundId: existingStripeRefundId,
			},
		});
		return {
			orderNumber,
			_id: orderId,
			alreadyExisted,
			fulfillment: {
				kind: "permanent_failure_refunded",
				stripeRefundId: existingStripeRefundId,
				errorSummary: existingFulfillmentError ?? "Permanent fulfillment failure",
			},
			notification: "none",
		};
	}

	if (
		alreadyExisted &&
		(existingRecoveryStatus === "refund_pending" || existingStatus === "fulfillment_error")
	) {
		logStructured({
			event: "refund.recovery_resumed",
			level: "warn",
			stage: "stripe_refund",
			orderId: orderNumber,
			meta: { recoveryStatus: existingRecoveryStatus ?? "legacy_fulfillment_error" },
		});
		const fulfillment = await handlePermanentFulfillmentFailure(
			{ stripe, convex, resend },
			{
				orderId,
				orderNumber,
				error: new Error(existingFulfillmentError ?? "Permanent fulfillment failure"),
				session,
				stripeRequestOptions,
				customerEmail: session.customer_details?.email ?? "unknown",
				notificationProfile,
			},
		);
		return {
			orderNumber,
			_id: orderId,
			alreadyExisted,
			fulfillment,
			notification: "failure",
		};
	}

	let fulfillment: PrintFulfillmentOutcome;
	try {
		fulfillment = await submitPrintFulfillment(
			{ convex, createLumaPrintsOrder },
			{
				orderId,
				orderNumber,
				lineItems,
				shippingDetails,
				session,
			},
		);
	} catch (err) {
		fulfillment = await handlePrintFulfillmentFailure(
			{ stripe, convex, resend },
			{
				orderId,
				orderNumber,
				error: err,
				session,
				stripeRequestOptions,
				customerEmail: session.customer_details?.email ?? "unknown",
				notificationProfile,
			},
		);
	}

	return {
		orderNumber,
		_id: orderId,
		alreadyExisted,
		fulfillment,
		notification: fulfillment.kind === "permanent_failure_refunded" ? "failure" : "success",
	};
}
