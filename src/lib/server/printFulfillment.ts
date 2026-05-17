import type { ConvexHttpClient } from "convex/browser";
import type { Resend } from "resend";
import type Stripe from "stripe";
import { api } from "$convex/api";
import { logStructured, timed } from "$lib/server/logger";
import { buildLumaPrintsOrder, createOrder as createLumaPrintsOrder } from "$lib/server/lumaprints";
import { buildOrderItemsFromSession, buildRecipientFromShipping } from "$lib/server/webhookDecoder";
import type { ShippingDetails } from "$lib/server/webhookEmails";
import { sendFulfillmentFailureAlert } from "$lib/server/webhookEmails";
import {
	classifyLumaPrintsFailure,
	formatFailureForAdmin,
} from "$lib/server/webhookErrorClassification";
import { getWebhookSecret } from "$lib/server/webhookSecret";

/**
 * Tag written to Stripe refund metadata so automated refunds are distinct from
 * manual refunds in the dashboard. Bump this if the automation changes.
 */
const REFUND_AUTOMATION_TAG = "audit_23_pr_3";

export interface PrintFulfillmentAdapters {
	convex: ConvexHttpClient;
}

export interface PermanentFulfillmentFailureAdapters extends PrintFulfillmentAdapters {
	stripe: Stripe;
	resend: Resend;
}

export async function submitPrintFulfillment(
	{ convex }: PrintFulfillmentAdapters,
	{
		orderId,
		orderNumber,
		lineItems,
		shippingDetails,
		session,
	}: {
		orderId: any;
		orderNumber: string;
		lineItems: Stripe.LineItem[];
		shippingDetails: ShippingDetails;
		session: Stripe.Checkout.Session;
	},
) {
	const items = buildOrderItemsFromSession(session, lineItems);
	if (items.length === 0) {
		logStructured({
			event: "lumaprints.skipped",
			stage: "lumaprints_submit",
			orderId: orderNumber,
			meta: { reason: "no LumaPrints items in order" },
		});
		return;
	}

	const borderedItems = items
		.map((item, index) => ({
			index,
			imageUrl: item.imageUrl,
			borderWidthInches: item.borderWidth ?? 0,
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
		}
	}

	const recipient = buildRecipientFromShipping(shippingDetails);
	const lpOrder = buildLumaPrintsOrder(orderNumber, recipient, items);

	const result = await timed(
		{
			event: "lumaprints.submitted",
			stage: "lumaprints_submit",
			orderId: orderNumber,
			meta: { itemCount: items.length },
		},
		() => createLumaPrintsOrder(lpOrder),
	);

	await convex.mutation(api.orders.updateStatus, {
		webhookSecret: getWebhookSecret(),
		orderId,
		lumaprintsOrderNumber: result.orderNumber,
	});

	logStructured({
		event: "lumaprints.recorded",
		stage: "lumaprints_submit",
		orderId: orderNumber,
		meta: { lumaprintsOrderNumber: result.orderNumber },
	});
}

export async function handlePrintFulfillmentFailure(
	adapters: PermanentFulfillmentFailureAdapters,
	{
		orderId,
		orderNumber,
		error,
		session,
		customerEmail,
	}: {
		orderId: any;
		orderNumber: string;
		error: unknown;
		session: Stripe.Checkout.Session;
		customerEmail: string;
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

	if (classification === "transient") {
		throw error;
	}

	await handlePermanentFulfillmentFailure(adapters, {
		orderId,
		orderNumber,
		error,
		session,
		customerEmail,
	});
}

/**
 * Permanent-failure fallback for LumaPrints submission.
 *
 * Best-effort side effects:
 * 1. Auto-refund via Stripe.
 * 2. Mark the order `fulfillment_error` in Convex.
 * 3. Notify the admin with order and failure context.
 */
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
		customerEmail,
	}: {
		orderId: any;
		orderNumber: string;
		error: unknown;
		session: Stripe.Checkout.Session;
		customerEmail: string;
	},
) {
	const errorSummary = formatFailureForAdmin(fulfillmentError);
	let stripeRefundId: string | undefined;

	try {
		const paymentIntentId =
			typeof session.payment_intent === "string"
				? session.payment_intent
				: (session.payment_intent?.id ?? undefined);

		if (!paymentIntentId) {
			logStructured({
				event: "refund.skipped",
				level: "error",
				stage: "stripe_refund",
				orderId: orderNumber,
				error: new Error("no payment_intent on session"),
			});
		} else {
			const refund = await stripe.refunds.create({
				payment_intent: paymentIntentId,
				reason: "requested_by_customer",
				metadata: {
					orderNumber,
					fulfillmentError: errorSummary.slice(0, 500),
					automated: REFUND_AUTOMATION_TAG,
				},
			});
			stripeRefundId = refund.id;
			logStructured({
				event: "refund.created",
				stage: "stripe_refund",
				orderId: orderNumber,
				meta: { refundId: refund.id, refundStatus: refund.status },
			});
		}
	} catch (refundErr) {
		logStructured({
			event: "refund.failed",
			level: "error",
			stage: "stripe_refund",
			orderId: orderNumber,
			error: refundErr,
		});
	}

	try {
		await convex.mutation(api.orders.updateStatus, {
			webhookSecret: getWebhookSecret(),
			orderId,
			status: "fulfillment_error",
			fulfillmentError: errorSummary.slice(0, 1000),
			stripeRefundId,
		});
	} catch (convexErr) {
		logStructured({
			event: "fulfillment_error.convex_update_failed",
			level: "error",
			stage: "fulfillment_failure",
			orderId: orderNumber,
			error: convexErr,
		});
	}

	try {
		await sendFulfillmentFailureAlert(resend, {
			orderNumber,
			customerEmail,
			errorSummary,
			stripeRefundId,
			total: session.amount_total ?? 0,
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
}
