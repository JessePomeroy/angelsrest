import type { ConvexHttpClient } from "convex/browser";
import type { Resend } from "resend";
import type Stripe from "stripe";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import type { CheckoutSnapshotV1 } from "$lib/server/checkoutSnapshotConsumer";
import {
	ANGELS_REST_COMMERCE_PROFILE,
	type CommerceNotificationProfile,
} from "$lib/server/commerceTenant";
import { logStructured, timed } from "$lib/server/logger";
import { buildLumaPrintsOrder, findOrderByExternalId } from "$lib/server/lumaprints";
import { buildOrderItemsFromSession, buildRecipientFromShipping } from "$lib/server/webhookDecoder";
import type { ShippingDetails } from "$lib/server/webhookEmails";
import { sendFulfillmentFailureAlert } from "$lib/server/webhookEmails";
import {
	classifyLumaPrintsFailure,
	formatFailureForAdmin,
} from "$lib/server/webhookErrorClassification";
import { getWebhookSecret } from "$lib/server/webhookSecret";
import type { LumaPrintsOrder, LumaPrintsOrderResponse } from "$lib/shop/types";

/** Distinguishes automated recovery refunds from manual refunds. */
const REFUND_AUTOMATION_TAG = "fulfillment_recovery_v1";

export type SubmitLumaPrintsOrder = (order: LumaPrintsOrder) => Promise<LumaPrintsOrderResponse>;

export type PrintFulfillmentOutcome =
	| { kind: "fulfilled"; lumaprintsOrderNumber: string }
	| { kind: "no_print_items" }
	| {
			kind: "permanent_failure_refunded";
			stripeRefundId: string;
			errorSummary: string;
	  };

export interface PrintFulfillmentAdapters {
	convex: ConvexHttpClient;
	createLumaPrintsOrder: SubmitLumaPrintsOrder;
	findLumaPrintsOrder?: (externalId: string) => Promise<LumaPrintsOrderResponse | null>;
}

export interface PermanentFulfillmentFailureAdapters {
	convex: ConvexHttpClient;
	stripe: Stripe;
	resend: Resend;
}

export async function submitPrintFulfillment(
	{
		convex,
		createLumaPrintsOrder,
		findLumaPrintsOrder = findOrderByExternalId,
	}: PrintFulfillmentAdapters,
	input: {
		orderId: Id<"orders">;
		orderNumber: string;
		lineItems: Stripe.LineItem[];
		shippingDetails: ShippingDetails;
		session: Stripe.Checkout.Session;
		checkoutSnapshot?: CheckoutSnapshotV1;
	},
) {
	const { orderId, orderNumber, lineItems, shippingDetails, session, checkoutSnapshot } = input;
	const webhookSecret = getWebhookSecret();
	const claim = crypto.randomUUID();
	const externalId = orderNumber;
	const claimed = await convex.mutation(api.orders.claimPrintFulfillment, {
		orderId,
		webhookSecret,
		claim,
		externalId,
	});
	if (claimed.kind === "fulfilled")
		return {
			kind: "fulfilled",
			lumaprintsOrderNumber: claimed.orderNumber,
		} satisfies PrintFulfillmentOutcome;
	if (claimed.kind === "refunded")
		return {
			kind: "permanent_failure_refunded",
			stripeRefundId: claimed.stripeRefundId,
			errorSummary: "Fulfillment was already refunded",
		} satisfies PrintFulfillmentOutcome;
	if (claimed.kind === "no_print_items")
		return { kind: "no_print_items" } satisfies PrintFulfillmentOutcome;
	if (claimed.kind === "busy") throw new Error("Print fulfillment is already in progress");
	if (claimed.kind === "reconcile") {
		const existing = await findLumaPrintsOrder(claimed.externalId);
		if (!existing) throw new Error("Print provider reconciliation is pending");
		await convex.mutation(api.orders.updateStatus, {
			orderId,
			webhookSecret,
			lumaprintsOrderNumber: existing.orderNumber,
		});
		return {
			kind: "fulfilled",
			lumaprintsOrderNumber: existing.orderNumber,
		} satisfies PrintFulfillmentOutcome;
	}

	let recipient: ReturnType<typeof buildRecipientFromShipping> | undefined;
	let items: ReturnType<typeof buildOrderItemsFromSession>;
	try {
		recipient = checkoutSnapshot?.items.some(
			({ productKind }) => productKind === "print" || productKind === "print_set",
		)
			? buildRecipientFromShipping(shippingDetails)
			: undefined;
		items = checkoutSnapshot
			? await import("$lib/server/snapshotFulfillment").then(({ buildOrderItemsFromSnapshot }) =>
					buildOrderItemsFromSnapshot(checkoutSnapshot, session.id, lineItems),
				)
			: buildOrderItemsFromSession(session, lineItems);
		if (items.length === 0) {
			await convex.mutation(api.orders.updateStatus, {
				orderId,
				webhookSecret,
				printFulfillmentNoItems: true,
			});
			logStructured({
				event: "lumaprints.skipped",
				stage: "lumaprints_submit",
				orderId: orderNumber,
				meta: { reason: "no LumaPrints items in order" },
			});
			return { kind: "no_print_items" } satisfies PrintFulfillmentOutcome;
		}
		const borderedItems = items
			.map((item, index) => ({
				index,
				imageUrl: item.imageUrl,
				borderWidthInches: item.borderWidth ?? 0,
				sourcePolicy: item.sourcePolicy ?? ("byte_exact" as const),
			}))
			.filter((item) => item.borderWidthInches > 0);
		if (borderedItems.length > 0) {
			const { processBorderedPrints } = await import("$lib/server/sharpBorder");
			const urlMap = await timed(
				{
					event: "sharp.bordered",
					stage: "sharp_composite",
					orderId: orderNumber,
					meta: { borderedCount: borderedItems.length },
				},
				() => processBorderedPrints(borderedItems, orderNumber),
			);
			for (const [index, r2Url] of urlMap) {
				items[index].imageUrl = r2Url;
				items[index].sourcePolicy = "bordered_r2";
			}
		}
		recipient ??= buildRecipientFromShipping(shippingDetails);
	} catch (error) {
		if (classifyLumaPrintsFailure(error) === "transient")
			await convex
				.mutation(api.orders.updateStatus, {
					orderId,
					webhookSecret,
					releasePrintFulfillmentClaim: true,
				})
				.catch(() => undefined);
		throw error;
	}

	const lpOrder = buildLumaPrintsOrder(externalId, recipient, items);
	const result = await createLumaPrintsOrder(lpOrder);
	logStructured({
		event: "lumaprints.submitted",
		stage: "lumaprints_submit",
		orderId: orderNumber,
		meta: { itemCount: items.length },
	});
	await convex.mutation(api.orders.updateStatus, {
		orderId,
		webhookSecret,
		lumaprintsOrderNumber: result.orderNumber,
	});
	logStructured({
		event: "lumaprints.recorded",
		stage: "lumaprints_submit",
		orderId: orderNumber,
		meta: { lumaprintsOrderNumber: result.orderNumber },
	});
	return {
		kind: "fulfilled",
		lumaprintsOrderNumber: result.orderNumber,
	} satisfies PrintFulfillmentOutcome;
}

export async function handlePrintFulfillmentFailure(
	adapters: PermanentFulfillmentFailureAdapters,
	{
		orderId,
		orderNumber,
		error,
		session,
		stripeRequestOptions,
		customerEmail,
		notificationProfile = ANGELS_REST_COMMERCE_PROFILE,
	}: {
		orderId: Id<"orders">;
		orderNumber: string;
		error: unknown;
		session: Stripe.Checkout.Session;
		stripeRequestOptions?: Stripe.RequestOptions;
		customerEmail: string;
		notificationProfile?: CommerceNotificationProfile;
	},
) {
	const classification = classifyLumaPrintsFailure(error);

	logStructured({
		event: "lumaprints.classified",
		level: "warn",
		stage: "lumaprints_submit",
		orderId: orderNumber,
		meta: { classification },
	});

	if (classification === "transient") throw new Error("Print provider temporarily unavailable");
	if (classification === "refunded") {
		const observed = await adapters.convex.mutation(api.orders.claimPrintFulfillment, {
			orderId,
			webhookSecret: getWebhookSecret(),
			claim: crypto.randomUUID(),
			externalId: session.id,
		});
		if (observed.kind === "refunded")
			return {
				kind: "permanent_failure_refunded",
				stripeRefundId: observed.stripeRefundId,
				errorSummary: "Fulfillment was already refunded",
			} satisfies PrintFulfillmentOutcome;
		if (observed.kind === "fulfilled")
			return {
				kind: "fulfilled",
				lumaprintsOrderNumber: observed.orderNumber,
			} satisfies PrintFulfillmentOutcome;
		throw new Error("Refund reconciliation is pending");
	}

	return handlePermanentFulfillmentFailure(adapters, {
		orderId,
		orderNumber,
		error,
		session,
		stripeRequestOptions,
		customerEmail,
		notificationProfile,
	});
}

/** Durably checkpoints before the idempotent refund; admin email remains best effort. */
export async function handlePermanentFulfillmentFailure(
	{
		stripe,
		convex,
		resend,
	}: {
		stripe: Stripe;
		convex: ConvexHttpClient;
		resend: Resend;
	},
	{
		orderId,
		orderNumber,
		error: fulfillmentError,
		session,
		stripeRequestOptions,
		customerEmail,
		notificationProfile = ANGELS_REST_COMMERCE_PROFILE,
	}: {
		orderId: Id<"orders">;
		orderNumber: string;
		error: unknown;
		session: Stripe.Checkout.Session;
		stripeRequestOptions?: Stripe.RequestOptions;
		customerEmail: string;
		notificationProfile?: CommerceNotificationProfile;
	},
) {
	const errorSummary = formatFailureForAdmin(fulfillmentError);
	const truncatedError = errorSummary.slice(0, 1000);

	await convex.mutation(api.orders.updateStatus, {
		webhookSecret: getWebhookSecret(),
		orderId,
		status: "fulfillment_error",
		fulfillmentError: truncatedError,
		fulfillmentRecoveryStatus: "refund_pending",
	});

	const paymentIntentId =
		typeof session.payment_intent === "string"
			? session.payment_intent
			: (session.payment_intent?.id ?? undefined);
	if (!paymentIntentId) {
		throw new Error(`Cannot refund order ${orderNumber}: Stripe session has no payment_intent`);
	}

	const isConnectedAccountRefund = Boolean(stripeRequestOptions?.stripeAccount);
	const refund = await stripe.refunds.create(
		{
			payment_intent: paymentIntentId,
			reason: "requested_by_customer",
			...(isConnectedAccountRefund ? { refund_application_fee: true } : {}),
			metadata: {
				orderNumber,
				fulfillmentError: errorSummary.slice(0, 500),
				automated: REFUND_AUTOMATION_TAG,
			},
		},
		{
			...(stripeRequestOptions ?? {}),
			idempotencyKey: `fulfillment-refund:${session.id}`,
		},
	);
	const stripeRefundId = refund.id;
	logStructured({
		event: "refund.created",
		stage: "stripe_refund",
		orderId: orderNumber,
		meta: { refundId: refund.id, refundStatus: refund.status },
	});

	await convex.mutation(api.orders.updateStatus, {
		webhookSecret: getWebhookSecret(),
		orderId,
		status: "fulfillment_error",
		fulfillmentError: truncatedError,
		stripeRefundId,
		fulfillmentRecoveryStatus: "refunded",
	});

	try {
		await sendFulfillmentFailureAlert(resend, {
			orderNumber,
			customerEmail,
			errorSummary,
			stripeRefundId,
			total: session.amount_total ?? 0,
			notificationProfile,
		});
	} catch (emailErr) {
		logStructured({
			event: "fulfillment_error.email_failed",
			level: "error",
			stage: "email_admin",
			orderId: orderNumber,
			error: emailErr,
		});
	}

	return {
		kind: "permanent_failure_refunded",
		stripeRefundId,
		errorSummary,
	} satisfies PrintFulfillmentOutcome;
}
