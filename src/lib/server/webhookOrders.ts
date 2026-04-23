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
import { env } from "$env/dynamic/private";
import { SITE_DOMAIN } from "$lib/config/site";
import { logStructured, timed } from "$lib/server/logger";
import { buildLumaPrintsOrder, createOrder as createLumaPrintsOrder } from "$lib/server/lumaprints";
import { buildOrderItemsFromSession, buildRecipientFromShipping } from "$lib/server/webhookDecoder";
import type { ShippingDetails } from "$lib/server/webhookEmails";
import { sendFulfillmentFailureAlert } from "$lib/server/webhookEmails";
import {
	classifyLumaPrintsFailure,
	formatFailureForAdmin,
} from "$lib/server/webhookErrorClassification";

/**
 * Tag written to Stripe refund metadata so we can distinguish automated
 * refunds from manual ones in the dashboard (audit #23 PR #3). Any time
 * the origin of an automated refund changes, bump this constant instead
 * of hunting for stringly-typed magic values in the webhook handler.
 */
const REFUND_AUTOMATION_TAG = "audit_23_pr_3";

/**
 * Shared secret between the SvelteKit webhook and Convex. Must be set in
 * both environments (Vercel `WEBHOOK_SECRET` and `npx convex env set
 * WEBHOOK_SECRET`). Audit C4/C5.
 */
function getWebhookSecret(): string {
	const secret = env.WEBHOOK_SECRET;
	if (!secret) {
		throw new Error(
			"WEBHOOK_SECRET is not set — cannot call webhook-gated Convex mutations. Set it in Vercel and run `npx convex env set WEBHOOK_SECRET <value>`.",
		);
	}
	return secret;
}

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
	}: {
		session: Stripe.Checkout.Session;
		shippingDetails: ShippingDetails;
		lineItems: Stripe.LineItem[];
	},
) {
	// Extract payment intent ID (could be string or expanded object)
	const rawPaymentIntent = session.payment_intent;
	const stripePaymentIntentId =
		typeof rawPaymentIntent === "string" ? rawPaymentIntent : rawPaymentIntent?.id;

	const items = lineItems.map((item) => ({
		productName: item.description || "Unknown Product",
		quantity: item.quantity || 1,
		price: item.amount_total || item.price?.unit_amount || 0,
	}));

	const isDigital = session.metadata?.isDigital === "true";

	// Create order in Convex (idempotent — returns existing order if session already processed)
	const orderResult = await convex.mutation(api.orders.create, {
		webhookSecret: getWebhookSecret(),
		siteUrl: SITE_DOMAIN,
		stripeSessionId: session.id,
		customerEmail: session.customer_details?.email || "",
		customerName: session.customer_details?.name || shippingDetails?.name || undefined,
		stripePaymentIntentId: stripePaymentIntentId || undefined,
		shippingAddress: shippingDetails?.address
			? {
					line1: shippingDetails.address.line1 || "",
					line2: shippingDetails.address.line2 || undefined,
					city: shippingDetails.address.city || "",
					state: shippingDetails.address.state || "",
					postalCode: shippingDetails.address.postal_code || "",
					country: shippingDetails.address.country || "",
				}
			: undefined,
		items,
		total: session.amount_total || 0,
		subtotal: session.amount_subtotal || undefined,
		fulfillmentType: isDigital ? "digital" : "self",
		paperName: session.metadata?.paperName || undefined,
		paperSubcategoryId: session.metadata?.paperSubcategoryId || undefined,
	});
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
		await submitToLumaPrints(convex, orderId, orderNumber, lineItems, shippingDetails, session);
	} catch (err) {
		const classification = classifyLumaPrintsFailure(err);
		// `timed` inside submitToLumaPrints already captured the exception
		// to Sentry — log the classification as a follow-up info event so
		// dashboards can group "permanent vs transient" without producing
		// a duplicate Sentry issue.
		logStructured({
			event: "lumaprints.classified",
			level: "warn",
			stage: "lumaprints_submit",
			orderId: orderNumber,
			meta: { classification },
		});

		if (classification === "transient") {
			// Re-throw — Stripe retries the webhook.
			throw err;
		}

		// Permanent failure: refund + mark order + notify admin + return 200.
		await handlePermanentFulfillmentFailure(
			{ stripe, convex, resend },
			{
				orderId,
				orderNumber,
				error: err,
				session,
				customerEmail: session.customer_details?.email ?? "unknown",
			},
		);
	}

	return { orderNumber, _id: orderId, alreadyExisted };
}

/**
 * 3-signal permanent-failure fallback introduced in audit #23 PR #3.
 *
 * 1. Auto-refund via `stripe.refunds.create` with reason
 *    `requested_by_customer` and a metadata note pointing at the order.
 * 2. Mark the Convex order `fulfillment_error` with the human-readable
 *    error message and the Stripe refund ID for audit trail.
 * 3. Send an admin email with order details, error message, and a link
 *    to the order in the admin dashboard.
 *
 * All three signals are best-effort — if any one fails, we log and
 * continue so the other two still fire. The caller returns 200 to Stripe
 * unconditionally after this runs: the underlying LumaPrints failure is
 * permanent, retries won't help.
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

	// 1. Stripe refund
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

	// 2. Mark Convex order fulfillment_error
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

	// 3. Admin email
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

/**
 * Submit order to LumaPrints for fulfillment if it contains LumaPrints products.
 *
 * Critical path (audit #1): if the LumaPrints call fails, this function
 * throws so the webhook returns 500 and Stripe retries. Order creation is
 * idempotent upstream so retries are safe.
 */
async function submitToLumaPrints(
	convex: ConvexHttpClient,
	orderId: any,
	orderNumber: string,
	lineItems: Stripe.LineItem[],
	shippingDetails: ShippingDetails,
	session: Stripe.Checkout.Session,
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

	// ─── Sharp border compositing ────────────────────────────────────
	// Detect items with a borderWidth, run Sharp to composite a white
	// border, upload to R2, and replace the image URL with the R2 URL.
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
		// Replace original URLs with R2 URLs for bordered items
		for (const [index, r2Url] of urlMap) {
			items[index].imageUrl = r2Url;
		}
	}

	const recipient = buildRecipientFromShipping(shippingDetails);
	const lpOrder = buildLumaPrintsOrder(orderNumber, recipient, items);

	// `timed` logs an info entry with durationMs on success and an error
	// entry (with Sentry capture) on failure, then re-throws so the caller's
	// classify-and-fallback path runs unchanged.
	const result = await timed(
		{
			event: "lumaprints.submitted",
			stage: "lumaprints_submit",
			orderId: orderNumber,
			meta: { itemCount: items.length },
		},
		() => createLumaPrintsOrder(lpOrder),
	);

	// Update Convex order with the LumaPrints order number
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
