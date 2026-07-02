/**
 * Order creation and management for the Stripe webhook.
 *
 * Handles Convex order creation, Stripe fee capture, and the
 * permanent-failure refund path. Each function receives its external
 * dependencies (Stripe, Convex, Resend instances) as parameters.
 */

import type { ConvexHttpClient } from "convex/browser";
import type { Resend } from "resend";
import type Stripe from "stripe";
import { api } from "$convex/api";
import { logStructured } from "$lib/server/logger";
import {
	handlePrintFulfillmentFailure,
	submitPrintFulfillment,
} from "$lib/server/printFulfillment";
import type { ShippingDetails } from "$lib/server/webhookEmails";
import { buildConvexOrderCreatePayload } from "$lib/server/webhookOrderPayload";
import { getWebhookSecret } from "$lib/server/webhookSecret";

export { handlePermanentFulfillmentFailure } from "$lib/server/printFulfillment";

/**
 * Create an order in Convex.
 *
 * After creating the order, waits 3 seconds then fetches actual Stripe fees
 * from the balance_transaction (which isn't available immediately at checkout time).
 */
export async function createOrderInConvex(
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
		session,
		shippingDetails,
		lineItems,
		siteUrl,
		stripeRequestOptions,
	}: {
		session: Stripe.Checkout.Session;
		shippingDetails: ShippingDetails;
		lineItems: Stripe.LineItem[];
		siteUrl: string;
		stripeRequestOptions?: Stripe.RequestOptions;
	},
) {
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
	const existingStripeFees = orderResult.stripeFees;

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
	// Audit #23 PR #3 expanded the error handling here into a 3-signal fallback:
	// - **Transient errors** (network, LumaPrints 5xx, unknown) → re-throw so
	//   the webhook returns 500 and Stripe retries with backoff. Order creation
	//   is idempotent via `by_stripeSessionId`, so retries are safe. This is
	//   audit #1's original behavior, preserved for transient failures.
	// - **Permanent errors** (4xx from LumaPrints, invalid payload, rejected
	//   image, validation failure) → take the refund path: auto-refund the
	//   customer via Stripe, mark the order `fulfillment_error` in Convex,
	//   email the admin with full error context, and return 200 so Stripe
	//   doesn't retry (the underlying problem is permanent).
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
		return { orderNumber, _id: orderId, alreadyExisted };
	}

	try {
		await submitPrintFulfillment(
			{ convex },
			{
				orderId,
				orderNumber,
				lineItems,
				shippingDetails,
				session,
			},
		);
	} catch (err) {
		await handlePrintFulfillmentFailure(
			{ stripe, convex, resend },
			{
				orderId,
				orderNumber,
				error: err,
				session,
				stripeRequestOptions,
				customerEmail: session.customer_details?.email ?? "unknown",
			},
		);
	}

	return { orderNumber, _id: orderId, alreadyExisted };
}
