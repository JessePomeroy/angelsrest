import { error } from "@sveltejs/kit";
import type { ConvexHttpClient } from "convex/browser";
import type { Resend } from "resend";
import type Stripe from "stripe";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import { env } from "$env/dynamic/private";
import {
	CheckoutSnapshotProtocolError,
	hasCheckoutSnapshotMarker,
	inspectCheckoutSnapshotMetadata,
	readCheckoutTenantMarker,
	selectCheckoutSnapshotInput,
} from "$lib/server/checkoutSnapshotConsumer";
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
import { getWebhookSecret } from "$lib/server/webhookSecret";

export interface OrderIntakeAdapters {
	stripe: Stripe;
	resend: Resend;
	convex: ConvexHttpClient;
	createLumaPrintsOrder: SubmitLumaPrintsOrder;
}

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
				if (session.metadata?.type === "invoice_payment") {
					const tenant = await resolveCommerceTenant(event, adapters.convex);
					await markInvoicePaidFromSession(session, adapters.convex, tenant.siteUrl);
					break;
				}

				const consumesCheckoutSnapshot =
					env.CHECKOUT_SNAPSHOT_MODE === "handle-v2" || hasCheckoutSnapshotMarker(session.metadata);
				let routing = null;
				if (consumesCheckoutSnapshot) {
					const stripeAccount =
						typeof event.account === "string" ? event.account.trim() : undefined;
					const metadataSiteUrl = readCheckoutTenantMarker(session.metadata);
					try {
						routing = await adapters.convex.query(api.orders.resolveCheckoutRouting, {
							stripeSessionId: session.id,
							...(stripeAccount ? { stripeConnectedAccountId: stripeAccount } : {}),
							...(metadataSiteUrl ? { stripeTenantMetadataSiteUrl: metadataSiteUrl } : {}),
							webhookSecret: getWebhookSecret(),
						});
					} catch (cause) {
						throw new CheckoutSnapshotProtocolError("Checkout routing failed", { cause });
					}
				}
				const tenantPromise = resolveCommerceTenant(event, adapters.convex, routing?.siteUrl);
				const tenant = consumesCheckoutSnapshot
					? await tenantPromise.catch((cause) => {
							throw new CheckoutSnapshotProtocolError("Checkout tenant routing failed", { cause });
						})
					: await tenantPromise;
				await handleCheckoutCompleted(session, adapters, {
					siteUrl: tenant.siteUrl,
					notificationProfile: tenant.notificationProfile,
					stripeRequestOptions: tenant.stripeRequestOptions,
					routingSource: routing?.source ?? null,
					completeLineItems: consumesCheckoutSnapshot,
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
		if (!(err instanceof CheckoutSnapshotProtocolError)) {
			await sendFailureAlert(adapters.resend, event.type, sessionId ?? "unknown", errorMessage);
		}
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
		routingSource = null,
		completeLineItems = false,
	}: {
		siteUrl: string;
		stripeRequestOptions?: Stripe.RequestOptions;
		notificationProfile: CommerceNotificationProfile;
		routingSource?: "order" | "reservation" | null;
		completeLineItems?: boolean;
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
		completeLineItems,
	);
	const checkoutSnapshotInput = completeLineItems
		? selectCheckoutSnapshotInput(
				routingSource,
				routingSource === "order"
					? undefined
					: inspectCheckoutSnapshotMetadata(session.metadata, lineItems.length),
			)
		: ({ protocol: "legacy" } as const);

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
			checkoutSnapshotInput,
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
	completeLineItems = false,
) {
	if (completeLineItems) {
		const fullSession = await stripe.checkout.sessions.retrieve(
			session.id,
			{ expand: ["customer_details"] },
			requestOptions,
		);
		const page = await stripe.checkout.sessions.listLineItems(
			session.id,
			{ limit: 41 },
			requestOptions,
		);
		if (page.data.length > 40 || page.has_more) {
			throw new CheckoutSnapshotProtocolError("Checkout has more than 40 line items");
		}
		return {
			fullSession,
			lineItems: page.data,
			shippingDetails: session.collected_information?.shipping_details,
		};
	}

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
