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
import { logStructured } from "$lib/server/logger";
import { formatCents } from "$lib/utils/format";

/** Shipping details extracted from `session.collected_information`. */
export type ShippingDetails =
	| Stripe.Checkout.Session.CollectedInformation.ShippingDetails
	| null
	| undefined;

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
			subject: `🚨 Webhook failure: ${eventType}`,
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
	}: {
		session: Stripe.Checkout.Session;
		customerEmail: string;
		shippingDetails: ShippingDetails;
		lineItems: Stripe.LineItem[];
		orderNumber?: string;
	},
) {
	const isDigital = session.metadata?.isDigital === "true";

	const digitalSection = isDigital
		? `
DOWNLOAD YOUR PURCHASE
https://www.angelsrest.online/checkout/success?session_id=${session.id}&email=${encodeURIComponent(customerEmail)}

Your download link will remain active. Visit the link above anytime to re-download. The email in the URL must match the address this order was purchased with.
`
		: `
SHIPPING ADDRESS
${formatShippingAddress(shippingDetails)}

TRACK YOUR ORDER
View your order status anytime: https://angelsrest.online/orders?email=${encodeURIComponent(customerEmail)}&order=${orderNumber}

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

Thank you for supporting Angel's Rest!

Best regards,
Jesse Pomeroy
Angel's Rest
https://angelsrest.online
  `.trim();

	await resend.emails.send({
		from: "Angel's Rest <orders@angelsrest.online>",
		to: [customerEmail],
		subject: `Order Confirmation - ${session.id}`,
		text: emailContent,
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
	}: {
		session: Stripe.Checkout.Session;
		customerEmail: string;
		shippingDetails: ShippingDetails;
		lineItems: Stripe.LineItem[];
		orderNumber?: string;
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
This order was automatically processed through your Angel's Rest website.
  `.trim();

	await resend.emails.send({
		from: "Angel's Rest Orders <orders@angelsrest.online>",
		to: [env.NOTIFICATION_EMAIL || ADMIN_EMAIL],
		subject: orderNumber
			? `🛒 New Order ${orderNumber}: ${formatCents(session.amount_total || 0)} from ${shippingDetails?.name || customerEmail}`
			: `🛒 New Order: ${formatCents(session.amount_total || 0)} from ${shippingDetails?.name || customerEmail}`,
		text: emailContent,
	});
}

/** Send payment-failed notification to the customer */
export async function sendPaymentFailedEmail(
	resend: Resend,
	{
		customerEmail,
		errorMessage,
	}: {
		customerEmail: string;
		errorMessage: string;
	},
) {
	await resend.emails.send({
		from: "Angel's Rest <orders@angelsrest.online>",
		to: [customerEmail],
		subject: "Payment could not be processed - Angel's Rest",
		text: `
Hi there,

We weren't able to process your recent payment.

Reason: ${errorMessage}

If you'd like to try again, visit our shop: https://${SITE_DOMAIN}/shop

If you believe this is an error or need help, just reply to this email.

Best regards,
Jesse Pomeroy
Angel's Rest
https://${SITE_DOMAIN}
`.trim(),
	});
}

/**
 * Admin notification email for permanent fulfillment failures.
 * Sent to NOTIFICATION_EMAIL (with Jesse's personal Gmail as fallback,
 * matching the pattern used elsewhere in this file).
 */
export async function sendFulfillmentFailureAlert(
	resend: Resend,
	{
		orderNumber,
		customerEmail,
		errorSummary,
		stripeRefundId,
		total,
	}: {
		orderNumber: string;
		customerEmail: string;
		errorSummary: string;
		stripeRefundId: string | undefined;
		total: number;
	},
) {
	const adminEmail = env.NOTIFICATION_EMAIL || ADMIN_EMAIL;
	const refundLine = stripeRefundId
		? `✅ Customer auto-refunded via Stripe (refund ID: ${stripeRefundId})`
		: "⚠️ Refund FAILED — manual intervention required";

	await resend.emails.send({
		from: "Angel's Rest Alerts <orders@angelsrest.online>",
		to: [adminEmail],
		subject: `[URGENT] Fulfillment error on order ${orderNumber}`,
		text: `
Order ${orderNumber} permanently failed at LumaPrints submission.

Customer: ${customerEmail}
Amount: ${formatCents(total)}

${refundLine}

Error details:
${errorSummary}

The order has been marked fulfillment_error in the admin dashboard.
No action required unless the refund failed above.

Admin dashboard: https://${SITE_DOMAIN}/admin/orders
`.trim(),
	});
}
