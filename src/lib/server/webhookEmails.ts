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
	ANGELS_REST_COMMERCE_PROFILE,
	type CommerceNotificationProfile,
} from "$lib/server/commerceTenant";
import { logStructured } from "$lib/server/logger";
import type { LumaPrintsReconciliationClass } from "$lib/server/lumaprints";
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

function commerceSender(profile: CommerceNotificationProfile, suffix = "") {
	const displayName = profile.siteName.replace(/[\r\n<>]/g, " ").trim() || "Angel's Rest";
	if (profile.siteUrl === SITE_DOMAIN) {
		return `Angel's Rest${suffix} <orders@angelsrest.online>`;
	}
	return `${displayName}${suffix} via Angel's Rest <orders@angelsrest.online>`;
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
	const result = await resend.emails.send(
		{
			from: commerceSender(notificationProfile),
			to: [customerEmail],
			subject: `Order ${orderNumber} has shipped - ${notificationProfile.siteName}`,
			text: `Your ${notificationProfile.siteName} order ${orderNumber} has shipped.\n\n${tracking}\n\nView order status: ${commerceOrigin(notificationProfile)}/orders`,
		},
		{ idempotencyKey: `shipment-email:${lumaprintsOrderNumber}` },
	);
	if (result.error) throw new Error(result.error.message || "Shipment email delivery failed");
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
		.map((item) => `• ${item.description} (${item.quantity}x) - ${formatCents(item.amount_total)}`)
		.join("\n");
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
		await resend.emails.send({
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
		});
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
		},
		{ idempotencyKey: `print-reconciliation-blocked:${externalId}` },
	);
	if (result.error) {
		throw new Error(result.error.message || "Reconciliation-blocked alert delivery failed");
	}
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

	await resend.emails.send({
		from: commerceSender(notificationProfile),
		to: [customerEmail],
		subject: `Order Confirmation - ${session.id}`,
		text: emailContent,
	});
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
		},
		{ idempotencyKey: `fulfillment-refund-customer:${stripeRefundId}` },
	);
	if (result.error) {
		throw new Error(result.error.message || "Customer refund email delivery failed");
	}
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

	await resend.emails.send({
		from: commerceSender(notificationProfile, " Orders"),
		to: [notificationProfile.adminEmail],
		subject: orderNumber
			? `New Order ${orderNumber}: ${formatCents(session.amount_total || 0)} from ${shippingDetails?.name || customerEmail}`
			: `New Order: ${formatCents(session.amount_total || 0)} from ${shippingDetails?.name || customerEmail}`,
		text: emailContent,
	});
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
	});
	if (result.error)
		throw new Error(result.error.message || "Payment-failure email delivery failed");
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
		},
		{ idempotencyKey: `fulfillment-refund-admin:${stripeRefundId}` },
	);
	if (result.error) throw new Error(result.error.message || "Admin refund email delivery failed");
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
		},
		{ idempotencyKey: `fulfillment-refund-failed:${stripeRefundId}` },
	);
	if (result.error) throw new Error(result.error.message || "Refund-failure alert delivery failed");
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
		},
		{
			idempotencyKey: `fulfillment-refund-attention:order:${notificationIdentity}`,
		},
	);
	if (result.error)
		throw new Error(result.error.message || "Refund-attention alert delivery failed");
}
