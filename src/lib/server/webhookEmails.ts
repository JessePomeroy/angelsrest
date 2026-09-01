/**
 * Email helpers for the Stripe webhook.
 *
 * Extracted from the webhook handler to keep the endpoint file focused on
 * orchestration. Every function receives its dependencies (Resend instance,
 * etc.) as parameters so the webhook can pass in the same singletons it
 * already creates.
 */

import type { Resend } from "resend";
import type Stripe from "stripe";
import { env } from "$env/dynamic/private";
import { ADMIN_EMAIL, SITE_DOMAIN } from "$lib/config/site";
import {
	type CommerceEmailItem,
	renderCustomerCommerceEmailHtml,
	renderOwnerCommerceEmailHtml,
} from "$lib/server/commerceEmailHtml";
import {
	ANGELS_REST_COMMERCE_PROFILE,
	type CommerceNotificationProfile,
} from "$lib/server/commerceTenant";
import { logStructured } from "$lib/server/logger";
import type { LumaPrintsReconciliationClass } from "$lib/server/lumaprints";
import { RECEIPT_PAPER_TEXTURE_PUBLIC_URL } from "$lib/server/receiptPaperTexture";
import { formatCents } from "$lib/utils/format";
import { parseCanonicalOrderNumber } from "../../../packages/crm-api/convex/helpers/numbering";

/** Shipping details extracted from `session.collected_information`. */
export type ShippingDetails =
	| Stripe.Checkout.Session.CollectedInformation.ShippingDetails
	| null
	| undefined;

function commerceOrigin(profile: CommerceNotificationProfile) {
	return profile.siteUrl.startsWith("http") ? profile.siteUrl : `https://${profile.siteUrl}`;
}

function commerceEmailBrand(profile: CommerceNotificationProfile) {
	const homeUrl = commerceOrigin(profile);
	return {
		siteName: profile.siteName,
		homeUrl,
		...(profile.siteUrl === SITE_DOMAIN
			? { receiptTextureUrl: RECEIPT_PAPER_TEXTURE_PUBLIC_URL }
			: {}),
	};
}

function commerceSender(profile: CommerceNotificationProfile, suffix = "") {
	const displayName = profile.siteName.replace(/[\r\n<>]/g, " ").trim() || "Angel's Rest";
	if (profile.siteUrl === SITE_DOMAIN) {
		return `Angel's Rest${suffix} <orders@angelsrest.online>`;
	}
	return `${displayName}${suffix} via Angel's Rest <orders@angelsrest.online>`;
}

function requireCommerceEmailAccepted(
	result: {
		data?: { id?: string } | null;
		error?: { message?: string } | null;
	},
	failureMessage: string,
) {
	if (result.error) {
		throw new Error(result.error.message || failureMessage);
	}
	if (!result.data?.id) {
		throw new Error(`${failureMessage}: provider returned no delivery id`);
	}
}

/** Notify a customer after the hub atomically claims a LumaPrints shipment. */
export async function sendCustomerShipmentNotification(
	resend: Resend,
	{
		customerEmail,
		orderNumber,
		lumaprintsOrderNumber,
		trackingNumber,
		carrier,
		notificationProfile = ANGELS_REST_COMMERCE_PROFILE,
	}: {
		customerEmail: string;
		orderNumber: string;
		lumaprintsOrderNumber: string;
		trackingNumber?: string;
		carrier?: string;
		notificationProfile?: CommerceNotificationProfile;
	},
) {
	const tracking = trackingNumber
		? `Tracking${carrier ? ` (${carrier})` : ""}: ${trackingNumber}`
		: "Tracking details should update soon.";
	const html = renderCustomerCommerceEmailHtml({
		kind: "shipment",
		brand: commerceEmailBrand(notificationProfile),
		orderNumber,
		...(trackingNumber ? { trackingNumber } : {}),
		...(carrier ? { carrier } : {}),
		statusUrl: `${commerceOrigin(notificationProfile)}/orders`,
	});
	const result = await resend.emails.send(
		{
			from: commerceSender(notificationProfile),
			to: [customerEmail],
			subject: `Order ${orderNumber} has shipped - ${notificationProfile.siteName}`,
			text: `Your ${notificationProfile.siteName} order ${orderNumber} has shipped.\n\n${tracking}\n\nView order status: ${commerceOrigin(notificationProfile)}/orders`,
			html,
		},
		{ idempotencyKey: `shipment-email:${lumaprintsOrderNumber}` },
	);
	requireCommerceEmailAccepted(result, "Shipment email delivery failed");
}

/** Format shipping address for emails */
export function formatShippingAddress(shippingDetails: ShippingDetails): string {
	if (!shippingDetails?.address) return "No shipping address";
	const { name, address } = shippingDetails;
	return [
		name,
		address.line1,
		address.line2,
		`${address.city}, ${address.state} ${address.postal_code}`,
		address.country,
	]
		.filter(Boolean)
		.join("\n");
}

/** Format line items for emails */
export function formatLineItems(lineItems: Stripe.LineItem[]): string {
	return lineItems
		.map((item) => {
			const emailItem = commerceEmailItem(item);
			return `• ${emailItem.description} (${emailItem.quantity} × ${emailItem.unitPrice}) — ${emailItem.total}`;
		})
		.join("\n");
}

function lineItemQuantity(item: Stripe.LineItem) {
	return typeof item.quantity === "number" &&
		Number.isSafeInteger(item.quantity) &&
		item.quantity > 0
		? item.quantity
		: 1;
}

function lineItemUnitAmount(item: Stripe.LineItem, quantity: number) {
	if (
		typeof item.price?.unit_amount === "number" &&
		Number.isSafeInteger(item.price.unit_amount) &&
		item.price.unit_amount >= 0
	) {
		return item.price.unit_amount;
	}

	const lineSubtotal =
		typeof item.amount_subtotal === "number" && item.amount_subtotal >= 0
			? item.amount_subtotal
			: item.amount_total;
	return Math.round(lineSubtotal / quantity);
}

function commerceEmailItem(item: Stripe.LineItem): CommerceEmailItem {
	const quantity = lineItemQuantity(item);
	return {
		description: item.description ?? "Item",
		quantity: String(quantity),
		unitPrice: formatCents(lineItemUnitAmount(item, quantity)),
		total: formatCents(item.amount_total),
	};
}

// ─── Failure Alerting ────────────────────────────────────────────────────────

/** Send an alert email when a critical webhook operation fails */
export async function sendFailureAlert(
	resend: Resend,
	eventType: string,
	sessionId: string,
	errorMessage: string,
) {
	try {
		const html = renderOwnerCommerceEmailHtml({
			kind: "webhook_failure",
			brand: commerceEmailBrand(ANGELS_REST_COMMERCE_PROFILE),
			eventType,
			sessionId,
			errorMessage,
			stripeUrl: "https://dashboard.stripe.com",
		});
		const result = await resend.emails.send({
			from: "Angel's Rest Alerts <orders@angelsrest.online>",
			to: [env.NOTIFICATION_EMAIL || ADMIN_EMAIL],
			subject: `Webhook failure: ${eventType}`,
			text: `A critical webhook operation failed. Stripe will retry automatically.

Event: ${eventType}
Session: ${sessionId}
Error: ${errorMessage}

Action required:
- Check Stripe dashboard for the payment: https://dashboard.stripe.com
- If retries exhaust, manually fulfill the order
- Check server logs for full stack trace`,
			html,
		});
		requireCommerceEmailAccepted(result, "Webhook failure alert delivery failed");
	} catch (emailErr) {
		// Alert email itself failed — log but don't throw (we're already in error handling)
		logStructured({
			event: "email.failure_alert.failed",
			level: "error",
			stage: "email_admin",
			sessionId,
			error: emailErr,
			meta: { eventType },
		});
	}
}

const RECONCILIATION_CLASS_COPY: Record<LumaPrintsReconciliationClass, string> = {
	provider_rejected: "Provider rejected the reconciliation request",
	response_contract: "Provider response did not match the expected contract",
	ambiguous_result: "Provider returned more than one matching result",
	client_error: "Reconciliation request could not be completed",
};

function canonicalOrderReference(orderNumber: string) {
	return parseCanonicalOrderNumber(orderNumber) === null ? "unknown" : orderNumber;
}

/** Send the one-time operator alert for a durable reconciliation block. */
export async function sendPrintReconciliationBlockedAlert(
	resend: Resend,
	{
		orderNumber,
		externalId,
		reconciliationClass,
		escalationReason,
		notificationProfile = ANGELS_REST_COMMERCE_PROFILE,
	}: {
		orderNumber: string;
		externalId: string;
		reconciliationClass: LumaPrintsReconciliationClass;
		escalationReason?:
			| "transport"
			| "rate_or_server"
			| "resource_bound"
			| "client_exception"
			| "result_not_observed";
		notificationProfile?: CommerceNotificationProfile;
	},
) {
	const orderReference = canonicalOrderReference(orderNumber);
	const escalationCopy = {
		transport: "Repeated provider lookups failed at the transport boundary",
		rate_or_server: "Repeated provider lookups were rate-limited or unavailable",
		resource_bound: "Repeated provider lookups exceeded a bounded resource limit",
		client_exception: "Repeated provider lookups ended in an unclassified client exception",
		result_not_observed: "Repeated provider lookups remained inconclusive",
	} as const;
	const classification =
		escalationReason === undefined
			? RECONCILIATION_CLASS_COPY[reconciliationClass]
			: escalationCopy[escalationReason];
	const html = renderOwnerCommerceEmailHtml({
		kind: "reconciliation_blocked",
		brand: commerceEmailBrand(notificationProfile),
		orderNumber: orderReference,
		classification,
		adminUrl: `${commerceOrigin(notificationProfile)}/admin/orders`,
	});
	const result = await resend.emails.send(
		{
			from: commerceSender(notificationProfile, " Alerts"),
			to: [notificationProfile.adminEmail],
			subject: `Print reconciliation blocked for order ${orderReference}`,
			text: `Automatic print reconciliation stopped for order ${orderReference}.

Classification: ${classification}

No customer failure email or automatic refund was sent.
The provider submission claim remains locked to prevent another provider POST.
This alert does not assert that the provider order is absent.
Review the provider and admin dashboards before you take manual action.`,
			html,
		},
		{ idempotencyKey: `print-reconciliation-blocked:${externalId}` },
	);
	requireCommerceEmailAccepted(result, "Reconciliation-blocked alert delivery failed");
}

/** Send order confirmation email to the customer */
export async function sendCustomerConfirmation(
	resend: Resend,
	{
		session,
		customerEmail,
		shippingDetails,
		lineItems,
		orderNumber,
		notificationProfile = ANGELS_REST_COMMERCE_PROFILE,
	}: {
		session: Stripe.Checkout.Session;
		customerEmail: string;
		shippingDetails: ShippingDetails;
		lineItems: Stripe.LineItem[];
		orderNumber?: string;
		notificationProfile?: CommerceNotificationProfile;
	},
) {
	const origin = commerceOrigin(notificationProfile);
	const isDigital = session.metadata?.isDigital === "true";

	const digitalSection = isDigital
		? `
DOWNLOAD YOUR PURCHASE
${origin}/checkout/success?session_id=${session.id}

Your download link will remain active. If you open it from a new browser, enter the email address used at checkout to verify the order.
`
		: `
SHIPPING ADDRESS
${formatShippingAddress(shippingDetails)}

TRACK YOUR ORDER
View your order status anytime: ${origin}/orders${orderNumber ? `?order=${encodeURIComponent(orderNumber)}` : ""}

WHAT'S NEXT?
• Your order will be processed within 1-2 business days
• Made-to-order prints typically ship within 2 weeks
• You'll receive tracking information once your order ships
`;

	const emailContent = `
Hi ${shippingDetails?.name || session.customer_details?.name || "there"},

Thank you for your order! Your payment has been successfully processed.

ORDER DETAILS
Order ID: ${session.id}
Total: ${formatCents(session.amount_total || 0)}

ITEMS ORDERED
${formatLineItems(lineItems)}
${digitalSection}
If you have any questions, just reply to this email.

Thank you for supporting ${notificationProfile.siteName}!

Best regards,
${notificationProfile.siteName}
${origin}
  `.trim();
	const html = renderCustomerCommerceEmailHtml({
		kind: "order_confirmation",
		brand: commerceEmailBrand(notificationProfile),
		customerName: shippingDetails?.name || session.customer_details?.name || "there",
		orderId: session.id,
		total: formatCents(session.amount_total || 0),
		items: lineItems.map(commerceEmailItem),
		delivery: isDigital
			? {
					kind: "digital",
					downloadUrl: `${origin}/checkout/success?session_id=${encodeURIComponent(session.id)}`,
				}
			: {
					kind: "physical",
					shippingAddress: formatShippingAddress(shippingDetails),
					statusUrl: `${origin}/orders${orderNumber ? `?order=${encodeURIComponent(orderNumber)}` : ""}`,
				},
	});

	const result = await resend.emails.send({
		from: commerceSender(notificationProfile),
		to: [customerEmail],
		subject: `Order Confirmation - ${session.id}`,
		text: emailContent,
		html,
	});
	requireCommerceEmailAccepted(result, "Customer confirmation delivery failed");
}

/** Notify a customer only after a permanent fulfillment failure is durably refunded. */
export async function sendCustomerFulfillmentFailure(
	resend: Resend,
	{
		customerEmail,
		orderNumber,
		stripeRefundId,
		total,
		notificationProfile = ANGELS_REST_COMMERCE_PROFILE,
	}: {
		customerEmail: string;
		orderNumber: string;
		stripeRefundId: string;
		total: number;
		notificationProfile?: CommerceNotificationProfile;
	},
) {
	const html = renderCustomerCommerceEmailHtml({
		kind: "refund_issued",
		brand: commerceEmailBrand(notificationProfile),
		orderNumber,
		refundId: stripeRefundId,
		total: formatCents(total),
	});
	const result = await resend.emails.send(
		{
			from: commerceSender(notificationProfile),
			to: [customerEmail],
			subject: `Order ${orderNumber} could not be fulfilled — refund issued`,
			text: `
We could not submit order ${orderNumber} for printing, so we issued a full refund of ${formatCents(total)} to the original payment method.

Stripe refund ID: ${stripeRefundId}

The refund has been created successfully. Your bank determines when the credit appears on your statement.

We are sorry we could not complete this order for ${notificationProfile.siteName}. Reply to this email if you need any help.
			`.trim(),
			html,
		},
		{ idempotencyKey: `fulfillment-refund-customer:${stripeRefundId}` },
	);
	requireCommerceEmailAccepted(result, "Customer refund email delivery failed");
}

/** Send order notification email to admin */
export async function sendAdminNotification(
	resend: Resend,
	{
		session,
		customerEmail,
		shippingDetails,
		lineItems,
		orderNumber,
		notificationProfile = ANGELS_REST_COMMERCE_PROFILE,
	}: {
		session: Stripe.Checkout.Session;
		customerEmail: string;
		shippingDetails: ShippingDetails;
		lineItems: Stripe.LineItem[];
		orderNumber?: string;
		notificationProfile?: CommerceNotificationProfile;
	},
) {
	const emailContent = `
🎉 NEW ORDER RECEIVED!

ORDER DETAILS
Order ID: ${session.id}
Customer: ${customerEmail}
Total: ${formatCents(session.amount_total || 0)}
Payment Status: ${session.payment_status}

ITEMS TO FULFILL
${formatLineItems(lineItems)}

SHIP TO
${formatShippingAddress(shippingDetails)}

STRIPE DASHBOARD
View full details: https://dashboard.stripe.com/payments/${session.payment_intent}

---
This order was automatically processed through ${notificationProfile.siteName}.
  `.trim();
	const paymentIntentId =
		typeof session.payment_intent === "string"
			? session.payment_intent
			: (session.payment_intent?.id ?? String(session.payment_intent));
	const html = renderOwnerCommerceEmailHtml({
		kind: "new_order",
		brand: commerceEmailBrand(notificationProfile),
		orderId: session.id,
		...(orderNumber ? { orderNumber } : {}),
		customerName: shippingDetails?.name || customerEmail,
		customerEmail,
		total: formatCents(session.amount_total || 0),
		paymentStatus: String(session.payment_status),
		items: lineItems.map(commerceEmailItem),
		shippingAddress: formatShippingAddress(shippingDetails),
		stripeUrl: `https://dashboard.stripe.com/payments/${paymentIntentId}`,
	});

	const result = await resend.emails.send({
		from: commerceSender(notificationProfile, " Orders"),
		to: [notificationProfile.adminEmail],
		subject: orderNumber
			? `New Order ${orderNumber}: ${formatCents(session.amount_total || 0)} from ${shippingDetails?.name || customerEmail}`
			: `New Order: ${formatCents(session.amount_total || 0)} from ${shippingDetails?.name || customerEmail}`,
		text: emailContent,
		html,
	});
	requireCommerceEmailAccepted(result, "Admin order notification delivery failed");
}

/** Send payment-failed notification to the customer */
export async function sendPaymentFailedEmail(
	resend: Resend,
	{
		customerEmail,
		errorMessage,
		notificationProfile = ANGELS_REST_COMMERCE_PROFILE,
	}: {
		customerEmail: string;
		errorMessage: string;
		notificationProfile?: CommerceNotificationProfile;
	},
) {
	const html = renderCustomerCommerceEmailHtml({
		kind: "payment_failed",
		brand: commerceEmailBrand(notificationProfile),
		reason: errorMessage,
		shopUrl: `${commerceOrigin(notificationProfile)}/shop`,
	});
	const result = await resend.emails.send({
		from: commerceSender(notificationProfile),
		to: [customerEmail],
		subject: `Payment could not be processed - ${notificationProfile.siteName}`,
		text: `
Hi there,

We weren't able to process your recent payment.

Reason: ${errorMessage}

If you'd like to try again, visit our shop: ${commerceOrigin(notificationProfile)}/shop

If you believe this is an error or need help, just reply to this email.

Best regards,
${notificationProfile.siteName}
${commerceOrigin(notificationProfile)}
`.trim(),
		html,
	});
	requireCommerceEmailAccepted(result, "Payment-failure email delivery failed");
}

/**
 * Admin notification email for permanent fulfillment failures.
 * Sent to the resolved tenant admin after refund recovery is durable.
 */
export async function sendFulfillmentFailureAlert(
	resend: Resend,
	{
		orderNumber,
		customerEmail,
		errorSummary,
		stripeRefundId,
		total,
		notificationProfile = ANGELS_REST_COMMERCE_PROFILE,
	}: {
		orderNumber: string;
		customerEmail: string;
		errorSummary: string;
		stripeRefundId: string;
		total: number;
		notificationProfile?: CommerceNotificationProfile;
	},
) {
	const refundLine = `Customer auto-refunded via Stripe (refund ID: ${stripeRefundId})`;
	const html = renderOwnerCommerceEmailHtml({
		kind: "fulfillment_refund_succeeded",
		brand: commerceEmailBrand(notificationProfile),
		orderNumber,
		customerEmail,
		errorSummary,
		refundId: stripeRefundId,
		total: formatCents(total),
		adminUrl: `${commerceOrigin(notificationProfile)}/admin/orders`,
	});

	const result = await resend.emails.send(
		{
			from: commerceSender(notificationProfile, " Alerts"),
			to: [notificationProfile.adminEmail],
			subject: `[URGENT] Fulfillment error on order ${orderNumber}`,
			text: `
Order ${orderNumber} permanently failed at LumaPrints submission.

Customer: ${customerEmail}
Amount: ${formatCents(total)}

${refundLine}

Error details:
${errorSummary}

The order has been marked fulfillment_error in the admin dashboard.
The refund ID and terminal recovery state are stored on the order.

Admin dashboard: ${commerceOrigin(notificationProfile)}/admin/orders
`.trim(),
			html,
		},
		{ idempotencyKey: `fulfillment-refund-admin:${stripeRefundId}` },
	);
	requireCommerceEmailAccepted(result, "Admin refund email delivery failed");
}

/** Alert operators when Stripe explicitly fails or cancels an automated refund. */
export async function sendAutomatedRefundFailureAlert(
	resend: Resend,
	{
		orderNumber,
		customerEmail,
		errorSummary,
		stripeRefundId,
		refundStatus,
		total,
		notificationProfile = ANGELS_REST_COMMERCE_PROFILE,
	}: {
		orderNumber: string;
		customerEmail: string;
		errorSummary: string;
		stripeRefundId: string;
		refundStatus: "failed" | "canceled";
		total: number;
		notificationProfile?: CommerceNotificationProfile;
	},
) {
	const html = renderOwnerCommerceEmailHtml({
		kind: "automated_refund_failed",
		brand: commerceEmailBrand(notificationProfile),
		orderNumber,
		customerEmail,
		errorSummary,
		refundId: stripeRefundId,
		refundStatus,
		total: formatCents(total),
		adminUrl: `${commerceOrigin(notificationProfile)}/admin/orders`,
	});
	const result = await resend.emails.send(
		{
			from: commerceSender(notificationProfile, " Alerts"),
			to: [notificationProfile.adminEmail],
			subject: `[ACTION REQUIRED] Refund ${refundStatus} for order ${orderNumber}`,
			text: `Automated fulfillment refund did not succeed.

Order: ${orderNumber}
Customer: ${customerEmail}
Amount: ${formatCents(total)}
Stripe refund ID: ${stripeRefundId}
Stripe refund status: ${refundStatus}

Fulfillment error:
${errorSummary}

No customer refund-success email was sent. The order is durably blocked for operator review.
Review Stripe and the admin dashboard before taking further action:
${commerceOrigin(notificationProfile)}/admin/orders`,
			html,
		},
		{ idempotencyKey: `fulfillment-refund-failed:${stripeRefundId}` },
	);
	requireCommerceEmailAccepted(result, "Refund-failure alert delivery failed");
}

/** Alert operators when an automated refund remains nonterminal past its retry bound. */
export async function sendAutomatedRefundAttentionAlert(
	resend: Resend,
	{
		orderNumber,
		customerEmail,
		errorSummary,
		stripeRefundId,
		refundStatus,
		attentionReason,
		notificationIdentity,
		total,
		notificationProfile = ANGELS_REST_COMMERCE_PROFILE,
	}: {
		orderNumber: string;
		customerEmail: string;
		errorSummary: string;
		stripeRefundId?: string;
		refundStatus?: "pending" | "requires_action";
		attentionReason: "attempts_exhausted" | "age_exceeded" | "request_outcome_unknown";
		notificationIdentity: string;
		total: number;
		notificationProfile?: CommerceNotificationProfile;
	},
) {
	const reason =
		attentionReason === "request_outcome_unknown"
			? "The refund request outcome is unknown. Do not submit another refund automatically."
			: attentionReason === "age_exceeded"
				? "The refund exceeded the allowed pending age."
				: "The refund exhausted the allowed automatic status checks.";
	if (!/^[A-Za-z0-9_-]{1,180}$/.test(notificationIdentity))
		throw new Error("Refund-attention notification identity is missing");
	const providerDetails =
		stripeRefundId === undefined
			? "Stripe refund ID: not observed\nStripe refund status: unknown"
			: `Stripe refund ID: ${stripeRefundId}\nStripe refund status: ${refundStatus}`;
	const html = renderOwnerCommerceEmailHtml({
		kind: "automated_refund_attention",
		brand: commerceEmailBrand(notificationProfile),
		orderNumber,
		customerEmail,
		errorSummary,
		...(stripeRefundId ? { refundId: stripeRefundId } : {}),
		...(refundStatus ? { refundStatus } : {}),
		reason,
		total: formatCents(total),
		adminUrl: `${commerceOrigin(notificationProfile)}/admin/orders`,
	});
	const result = await resend.emails.send(
		{
			from: commerceSender(notificationProfile, " Alerts"),
			to: [notificationProfile.adminEmail],
			subject: `[ACTION REQUIRED] Refund needs attention for order ${orderNumber}`,
			text: `Automated fulfillment refund still needs operator attention.

Order: ${orderNumber}
Customer: ${customerEmail}
Amount: ${formatCents(total)}
${providerDetails}

${reason}

Fulfillment error:
${errorSummary}

No refund success was inferred and no customer refund-success email was sent.
Signed Stripe refund updates may still resolve this order automatically.
Review Stripe and the admin dashboard:
${commerceOrigin(notificationProfile)}/admin/orders`,
			html,
		},
		{
			idempotencyKey: `fulfillment-refund-attention:order:${notificationIdentity}`,
		},
	);
	requireCommerceEmailAccepted(result, "Refund-attention alert delivery failed");
}
