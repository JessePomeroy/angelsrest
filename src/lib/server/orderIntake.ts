import { error } from "@sveltejs/kit";
import type { ConvexHttpClient } from "convex/browser";
import type { Resend } from "resend";
import type Stripe from "stripe";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { env } from "$env/dynamic/private";
import { SITE_DOMAIN } from "$lib/config/site";
import { logStructured } from "$lib/server/logger";
import type { ShippingDetails } from "$lib/server/webhookEmails";
import {
	sendAdminNotification,
	sendCustomerConfirmation,
	sendFailureAlert,
	sendPaymentFailedEmail,
} from "$lib/server/webhookEmails";
import { createOrderInConvex } from "$lib/server/webhookOrders";

export interface OrderIntakeAdapters {
	stripe: Stripe;
	resend: Resend;
	convex: ConvexHttpClient;
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
				const siteUrl = await resolveWebhookSiteUrl(event, adapters.convex);

				if (session.metadata?.type === "invoice_payment") {
					await markInvoicePaidFromSession(session, adapters.convex, siteUrl);
					break;
				}

				await handleCheckoutCompleted(session, adapters, {
					siteUrl,
					stripeRequestOptions: getStripeRequestOptions(event),
				});
				break;
			}

			case "payment_intent.payment_failed": {
				await handlePaymentFailed(event.data.object as Stripe.PaymentIntent, adapters.resend);
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
	});
	logStructured({
		event: "invoice.marked_paid",
		stage: "webhook",
		meta: { invoiceId },
	});
}

async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent, resend: Resend) {
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
	}: {
		siteUrl: string;
		stripeRequestOptions?: Stripe.RequestOptions;
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
		},
		{
			session: fullSession,
			shippingDetails,
			lineItems,
			siteUrl,
			stripeRequestOptions,
		},
	);

	if (orderResult.alreadyExisted) {
		logStructured({
			event: "checkout.email_skipped_idempotent",
			stage: "webhook",
			sessionId: session.id,
			orderId: orderResult.orderNumber,
			meta: { reason: "order_already_existed" },
		});
	} else {
		try {
			await sendCustomerConfirmation(adapters.resend, {
				session: fullSession,
				customerEmail,
				shippingDetails,
				lineItems,
				orderNumber: orderResult.orderNumber,
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

async function resolveWebhookSiteUrl(event: Stripe.Event, convex: ConvexHttpClient) {
	const accountId = typeof event.account === "string" ? event.account : undefined;
	if (!accountId) return SITE_DOMAIN;

	const webhookSecret = env.WEBHOOK_SECRET;
	if (!webhookSecret) {
		throw new Error("WEBHOOK_SECRET not configured");
	}

	const client = await convex.query(api.platform.getByStripeConnectedAccountId, {
		stripeConnectedAccountId: accountId,
		webhookSecret,
	});
	if (!client) {
		throw new Error(`No platform client found for Stripe account ${accountId}`);
	}
	return client.siteUrl;
}

function getStripeRequestOptions(event: Stripe.Event): Stripe.RequestOptions | undefined {
	const accountId = typeof event.account === "string" ? event.account : undefined;
	return accountId ? { stripeAccount: accountId } : undefined;
}
