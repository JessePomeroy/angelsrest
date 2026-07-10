import { error } from "@sveltejs/kit";
import type { ConvexHttpClient } from "convex/browser";
import type { Resend } from "resend";
import type Stripe from "stripe";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { env } from "$env/dynamic/private";
import {
	type CommerceNotificationProfile,
	resolveCommerceTenant,
} from "$lib/server/commerceTenant";
import { logStructured } from "$lib/server/logger";
import type { SubmitLumaPrintsOrder } from "$lib/server/printFulfillment";
import type { ShippingDetails } from "$lib/server/webhookEmails";
import {
	sendAdminNotification,
	sendCustomerConfirmation,
	sendCustomerFulfillmentFailure,
	sendFailureAlert,
	sendPaymentFailedEmail,
} from "$lib/server/webhookEmails";
import { createOrderInConvex } from "$lib/server/webhookOrders";

export interface OrderIntakeAdapters {
	stripe: Stripe;
	resend: Resend;
	convex: ConvexHttpClient;
	createLumaPrintsOrder: SubmitLumaPrintsOrder;
}

/**
 * Process a verified Stripe webhook event.
 *
 * The SvelteKit route owns HTTP concerns: raw body, signature verification,
 * and response serialization. This module owns the order-intake behavior:
 * event dispatch, invoice-vs-print routing, order creation, fulfillment,
 * email sequencing, and retry/failure semantics.
 */
export async function processStripeWebhookEvent(
	event: Stripe.Event,
	adapters: OrderIntakeAdapters,
) {
	const webhookStart = Date.now();
	const sessionId =
		event.type === "checkout.session.completed"
			? (event.data.object as Stripe.Checkout.Session).id
			: undefined;

	logStructured({
		event: "webhook.received",
		stage: "webhook",
		sessionId,
		meta: { stripeEventType: event.type },
	});

	try {
		switch (event.type) {
			case "checkout.session.completed": {
				const session = event.data.object as Stripe.Checkout.Session;
				const tenant = await resolveCommerceTenant(event, adapters.convex);

				if (session.metadata?.type === "invoice_payment") {
					await markInvoicePaidFromSession(session, adapters.convex, tenant.siteUrl);
					break;
				}

				await handleCheckoutCompleted(session, adapters, {
					siteUrl: tenant.siteUrl,
					notificationProfile: tenant.notificationProfile,
					stripeRequestOptions: tenant.stripeRequestOptions,
				});
				break;
			}

			case "payment_intent.payment_failed": {
				const tenant = await resolveCommerceTenant(event, adapters.convex);
				await handlePaymentFailed(
					event.data.object as Stripe.PaymentIntent,
					adapters.resend,
					tenant.notificationProfile,
				);
				break;
			}

			default:
				break;
		}

		logStructured({
			event: "webhook.processed",
			stage: "webhook",
			sessionId,
			durationMs: Date.now() - webhookStart,
			meta: { stripeEventType: event.type },
		});
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);

		logStructured({
			event: "webhook.failed",
			level: "error",
			stage: "webhook",
			sessionId,
			durationMs: Date.now() - webhookStart,
			error: err,
			meta: { stripeEventType: event.type },
		});
		await sendFailureAlert(adapters.resend, event.type, sessionId ?? "unknown", errorMessage);
		throw error(500, "Webhook processing failed");
	}
}

async function markInvoicePaidFromSession(
	session: Stripe.Checkout.Session,
	convex: ConvexHttpClient,
	siteUrl: string,
) {
	const invoiceId = session.metadata?.invoiceId;
	if (!invoiceId) return;

	const webhookSecret = env.WEBHOOK_SECRET;
	if (!webhookSecret) {
		throw new Error("WEBHOOK_SECRET not configured");
	}
	await convex.mutation(api.invoices.markPaid, {
		webhookSecret,
		invoiceId: invoiceId as Id<"invoices">,
		siteUrl: session.metadata?.siteUrl || siteUrl,
		stripeCheckoutSessionId: session.id,
		stripeCheckoutFingerprint: session.metadata?.checkoutFingerprint,
	});
	logStructured({
		event: "invoice.marked_paid",
		stage: "webhook",
		meta: { invoiceId },
	});
}

async function handlePaymentFailed(
	paymentIntent: Stripe.PaymentIntent,
	resend: Resend,
	notificationProfile: CommerceNotificationProfile,
) {
	const failureMessage =
		paymentIntent.last_payment_error?.message || "Your payment method was declined.";
	logStructured({
		event: "payment.failed",
		level: "warn",
		stage: "webhook",
		meta: {
			paymentIntentId: paymentIntent.id,
			failureMessage,
		},
	});
	if (!paymentIntent.receipt_email) return;

	try {
		await sendPaymentFailedEmail(resend, {
			customerEmail: paymentIntent.receipt_email,
			errorMessage: failureMessage,
			notificationProfile,
		});
	} catch (err) {
		logStructured({
			event: "email.payment_failed.send_failed",
			level: "error",
			stage: "email_customer",
			error: err,
			meta: { paymentIntentId: paymentIntent.id, fatal: false },
		});
	}
}

async function handleCheckoutCompleted(
	session: Stripe.Checkout.Session,
	adapters: OrderIntakeAdapters,
	{
		siteUrl,
		stripeRequestOptions,
		notificationProfile,
	}: {
		siteUrl: string;
		stripeRequestOptions?: Stripe.RequestOptions;
		notificationProfile: CommerceNotificationProfile;
	},
) {
	logStructured({
		event: "checkout.processing",
		stage: "webhook",
		sessionId: session.id,
	});

	const { fullSession, lineItems, shippingDetails } = await fetchSessionDetails(
		session,
		adapters.stripe,
		stripeRequestOptions,
	);

	const customerEmail = fullSession.customer_details?.email || session.customer_email;

	if (!customerEmail) {
		logStructured({
			event: "checkout.missing_email",
			level: "error",
			stage: "webhook",
			sessionId: session.id,
			error: new Error("No customer email on Stripe session"),
		});
		return;
	}

	const orderResult = await createOrderInConvex(
		{
			stripe: adapters.stripe,
			convex: adapters.convex,
			resend: adapters.resend,
			createLumaPrintsOrder: adapters.createLumaPrintsOrder,
		},
		{
			session: fullSession,
			shippingDetails,
			lineItems,
			siteUrl,
			stripeRequestOptions,
			notificationProfile,
		},
	);

	if (orderResult.notification === "none") {
		logStructured({
			event: "checkout.email_skipped_idempotent",
			stage: "webhook",
			sessionId: session.id,
			orderId: orderResult.orderNumber,
			meta: { reason: "order_already_existed" },
		});
	} else if (
		orderResult.notification === "failure" &&
		orderResult.fulfillment.kind === "permanent_failure_refunded"
	) {
		try {
			await sendCustomerFulfillmentFailure(adapters.resend, {
				customerEmail,
				orderNumber: orderResult.orderNumber,
				stripeRefundId: orderResult.fulfillment.stripeRefundId,
				total: fullSession.amount_total ?? 0,
				notificationProfile,
			});
		} catch (err) {
			logStructured({
				event: "email.customer_refund.send_failed",
				level: "error",
				stage: "email_customer",
				sessionId: session.id,
				orderId: orderResult.orderNumber,
				error: err,
				meta: { fatal: false },
			});
		}
	} else if (orderResult.notification === "success") {
		try {
			await sendCustomerConfirmation(adapters.resend, {
				session: fullSession,
				customerEmail,
				shippingDetails,
				lineItems,
				orderNumber: orderResult.orderNumber,
				notificationProfile,
			});
		} catch (err) {
			logStructured({
				event: "email.customer.send_failed",
				level: "error",
				stage: "email_customer",
				sessionId: session.id,
				orderId: orderResult.orderNumber,
				error: err,
				meta: { fatal: false },
			});
		}

		try {
			await sendAdminNotification(adapters.resend, {
				session: fullSession,
				customerEmail,
				shippingDetails,
				lineItems,
				orderNumber: orderResult.orderNumber,
				notificationProfile,
			});
		} catch (err) {
			logStructured({
				event: "email.admin.send_failed",
				level: "error",
				stage: "email_admin",
				sessionId: session.id,
				orderId: orderResult.orderNumber,
				error: err,
				meta: { fatal: false },
			});
		}
	} else {
		throw new Error(`Unexpected fulfillment notification outcome for ${orderResult.orderNumber}`);
	}

	logStructured({
		event: "checkout.processed",
		stage: "webhook",
		sessionId: session.id,
		orderId: orderResult.orderNumber,
	});
}

async function fetchSessionDetails(
	session: Stripe.Checkout.Session,
	stripe: Stripe,
	requestOptions?: Stripe.RequestOptions,
) {
	let fullSession: Stripe.Checkout.Session;
	let lineItems: Stripe.LineItem[] = [];
	let shippingDetails: ShippingDetails;

	try {
		fullSession = await stripe.checkout.sessions.retrieve(
			session.id,
			{
				expand: ["line_items", "customer_details"],
			},
			requestOptions,
		);
		lineItems = fullSession.line_items?.data || [];
		shippingDetails = session.collected_information?.shipping_details;
	} catch {
		logStructured({
			event: "session.retrieve_fallback",
			level: "warn",
			stage: "webhook",
			sessionId: session.id,
			meta: { reason: "stripe_retrieve_failed_likely_test_event" },
		});
		fullSession = session;
		shippingDetails = session.collected_information?.shipping_details;
	}

	return { fullSession, lineItems, shippingDetails };
}
