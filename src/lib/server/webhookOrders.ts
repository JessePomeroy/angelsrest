import type { ConvexHttpClient } from "convex/browser";
import type { Resend } from "resend";
import type Stripe from "stripe";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import {
	type CheckoutSnapshotInput,
	CheckoutSnapshotProtocolError,
} from "$lib/server/checkoutSnapshotConsumer";
import {
	ANGELS_REST_COMMERCE_PROFILE,
	type CommerceNotificationProfile,
} from "$lib/server/commerceTenant";
import { logStructured } from "$lib/server/logger";
import {
	handlePermanentFulfillmentFailure,
	handlePrintFulfillmentFailure,
	type PrintFulfillmentOutcome,
	PrintReconciliationAlertRetryableError,
	PrintReconciliationPendingError,
	type SubmitLumaPrintsOrder,
	sendClaimedFulfillmentFailureAdminAlert,
	submitPrintFulfillment,
} from "$lib/server/printFulfillment";
import type { ShippingDetails } from "$lib/server/webhookEmails";
import { buildConvexOrderCreatePayload } from "$lib/server/webhookOrderPayload";
import { getWebhookSecret } from "$lib/server/webhookSecret";

export interface CreatedOrderResult {
	orderNumber: string;
	_id: Id<"orders">;
	alreadyExisted: boolean;
	fulfillment: PrintFulfillmentOutcome;
	notification: "success" | "failure" | "none";
}

function claimOrderConfirmation(convex: ConvexHttpClient, orderId: Id<"orders">) {
	return convex.mutation(api.orders.claimOrderConfirmation, {
		orderId,
		webhookSecret: getWebhookSecret(),
	});
}

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
		checkoutSnapshotInput = { protocol: "legacy" },
	}: {
		session: Stripe.Checkout.Session;
		shippingDetails: ShippingDetails;
		lineItems: Stripe.LineItem[];
		siteUrl: string;
		stripeRequestOptions?: Stripe.RequestOptions;
		notificationProfile?: CommerceNotificationProfile;
		checkoutSnapshotInput?: CheckoutSnapshotInput;
	},
): Promise<CreatedOrderResult> {
	const payload = buildConvexOrderCreatePayload({
		session,
		shippingDetails,
		lineItems,
		siteUrl,
		webhookSecret: getWebhookSecret(),
		stripeRequestOptions,
		checkoutSnapshotInput,
	});
	const orderResult = await convex.mutation(api.orders.create, payload).catch((cause) => {
		if (checkoutSnapshotInput.protocol === "handle-v2") {
			throw new CheckoutSnapshotProtocolError("Bound checkout snapshot transfer failed", { cause });
		}
		throw cause;
	});
	const { _id: orderId, orderNumber, alreadyExisted } = orderResult;
	const existingLumaprintsOrderNumber = orderResult.lumaprintsOrderNumber;
	const existingStatus = orderResult.status;
	const existingStripeFees = orderResult.stripeFees;
	const existingFulfillmentError = orderResult.fulfillmentError;
	const existingStripeRefundId = orderResult.stripeRefundId;
	const existingRecoveryStatus = orderResult.fulfillmentRecoveryStatus;
	const existingAutomatedRefundId = orderResult.automatedRefundId;
	const existingAutomatedRefundStatus = orderResult.automatedRefundStatus;
	const existingPrintClaim = orderResult.printFulfillmentClaim;
	const existingPrintPhase = orderResult.printFulfillmentPhase;
	const existingPrintResolution = orderResult.printFulfillmentResolution;

	logStructured({
		event: alreadyExisted ? "order.rehydrated" : "order.created",
		stage: "order_create",
		orderId: orderNumber,
		meta: { alreadyExisted },
	});

	if (existingStripeFees !== undefined) {
		logStructured({
			event: "stripe_fees.skipped",
			stage: "order_create",
			orderId: orderNumber,
			meta: { reason: "already captured", stripeFees: existingStripeFees },
		});
	}

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
		const manuallyRefunded =
			existingStatus === "refunded" &&
			existingStripeRefundId !== undefined &&
			existingRecoveryStatus === undefined;
		return {
			orderNumber,
			_id: orderId,
			alreadyExisted,
			fulfillment: manuallyRefunded
				? { kind: "manual_refunded", stripeRefundId: existingStripeRefundId }
				: {
						kind: "fulfilled",
						lumaprintsOrderNumber: existingLumaprintsOrderNumber,
					},
			notification:
				!manuallyRefunded && (await claimOrderConfirmation(convex, orderId)) ? "success" : "none",
		};
	}

	const needsProviderReconciliation =
		existingPrintClaim === true &&
		existingLumaprintsOrderNumber === undefined &&
		existingPrintPhase !== "preparing" &&
		existingPrintResolution !== "resolved";

	if (
		(existingRecoveryStatus === "refunded" || existingStatus === "refunded") &&
		!existingStripeRefundId
	) {
		throw new Error(`Order ${orderNumber} is marked refunded without a Stripe refund ID`);
	}

	if (
		existingStripeRefundId &&
		!needsProviderReconciliation &&
		(existingRecoveryStatus === "refunded" ||
			existingStatus === "fulfillment_error" ||
			existingStatus === "refunded")
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
		const manuallyRefunded = existingStatus === "refunded" && existingRecoveryStatus === undefined;
		const errorSummary = existingFulfillmentError ?? "Permanent fulfillment failure";
		if (!manuallyRefunded) {
			await sendClaimedFulfillmentFailureAdminAlert(
				{ convex, resend },
				{
					orderId,
					orderNumber,
					customerEmail: session.customer_details?.email ?? "unknown",
					errorSummary,
					stripeRefundId: existingStripeRefundId,
					total: session.amount_total ?? 0,
					notificationProfile,
				},
			);
		}
		return {
			orderNumber,
			_id: orderId,
			alreadyExisted,
			fulfillment: manuallyRefunded
				? { kind: "manual_refunded", stripeRefundId: existingStripeRefundId }
				: {
						kind: "permanent_failure_refunded",
						stripeRefundId: existingStripeRefundId,
						errorSummary,
					},
			notification: manuallyRefunded ? "none" : "failure",
		};
	}

	if (
		existingRecoveryStatus === "refund_failed" &&
		existingAutomatedRefundId &&
		(existingAutomatedRefundStatus === "failed" || existingAutomatedRefundStatus === "canceled")
	) {
		const errorSummary = existingFulfillmentError ?? "Permanent fulfillment failure";
		const fulfillment = await handlePermanentFulfillmentFailure(
			{ stripe, convex, resend },
			{
				orderId,
				orderNumber,
				error: undefined,
				durableFulfillmentError: errorSummary,
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
				error: undefined,
				durableFulfillmentError: existingFulfillmentError ?? "Permanent fulfillment failure",
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
			notification: fulfillment.kind === "permanent_failure_refunded" ? "failure" : "none",
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
				checkoutSnapshot: orderResult.checkoutSnapshot
					? {
							...orderResult.checkoutSnapshot,
							items: orderResult.checkoutSnapshot.items.map((item) => ({
								...item,
								materialOptionKey: item.materialOptionKey ?? null,
								sizeOptionKey: item.sizeOptionKey ?? null,
								borderOptionKey: item.borderOptionKey ?? null,
								frameOptionKey: item.frameOptionKey ?? null,
							})),
						}
					: undefined,
			},
		);
	} catch (err) {
		if (
			err instanceof PrintReconciliationAlertRetryableError ||
			err instanceof PrintReconciliationPendingError
		)
			throw err;
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

	let notification: CreatedOrderResult["notification"];
	if (
		fulfillment.kind === "manual_refunded" ||
		fulfillment.kind === "no_print_items_replayed" ||
		fulfillment.kind === "reconciliation_blocked" ||
		fulfillment.kind === "automated_refund_failed" ||
		fulfillment.kind === "automated_refund_attention" ||
		fulfillment.kind === "automated_refund_request_uncertain"
	) {
		notification = "none";
	} else if (fulfillment.kind === "permanent_failure_refunded") {
		notification = "failure";
	} else if (fulfillment.kind === "no_print_items") {
		// claimNonPrintOrderOutcome already owns the durable confirmation claim.
		notification = "success";
	} else {
		notification = (await claimOrderConfirmation(convex, orderId)) ? "success" : "none";
	}

	return {
		orderNumber,
		_id: orderId,
		alreadyExisted,
		fulfillment,
		notification,
	};
}
