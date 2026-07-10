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
import { formatCents } from "$lib/utils/format";

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
	await resend.emails.send({
		from: commerceSender(notificationProfile),
		to: [customerEmail],
		subject: `Order ${orderNumber} could not be fulfilled — refund issued`,
		text: `
We could not submit order ${orderNumber} for printing, so we issued a full refund of ${formatCents(total)} to the original payment method.

Stripe refund ID: ${stripeRefundId}

The refund has been created successfully. Your bank determines when the credit appears on your statement.

We are sorry we could not complete this order for ${notificationProfile.siteName}. Reply to this email if you need any help.
		`.trim(),
	});
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
	await resend.emails.send({
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

	await resend.emails.send({
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
	});
}
