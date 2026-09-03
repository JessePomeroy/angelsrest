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
	inspectCheckoutAdmissionMetadata,
	inspectCheckoutSnapshotMetadata,
	readCheckoutTenantMarker,
	selectCheckoutSnapshotInput,
} from "$lib/server/checkoutSnapshotConsumer";
import {
	type CommerceNotificationProfile,
	resolveCommerceTenant,
} from "$lib/server/commerceTenant";
import { logStructured } from "$lib/server/logger";
import {
	AutomatedFulfillmentRefundRetryableError,
	AutomatedRefundNotificationRetryableError,
	PrintReconciliationAlertRetryableError,
	PrintReconciliationPendingError,
	ProviderSubmissionClosedRetryableError,
	type SubmitLumaPrintsOrder,
	sendClaimedAutomatedRefundNotification,
} from "$lib/server/printFulfillment";
import {
	ManualRefundReconciliationRetryableError,
	reconcileSucceededManualRefund,
} from "$lib/server/recovery/manualRefundReconciliation.server";
import { COMMERCE_TENANT_METADATA_KEY } from "$lib/server/stripeConnect";
import type { CommerceWebhookRole } from "$lib/server/stripeWebhook";
import type { ShippingDetails } from "$lib/server/webhookEmails";
import {
	sendAdminNotification,
	sendCustomerConfirmation,
	sendFailureAlert,
	sendPaymentFailedEmail,
	sendPrintReconciliationBlockedAlert,
} from "$lib/server/webhookEmails";
import { createOrderInConvex } from "$lib/server/webhookOrders";
import { getWebhookSecret } from "$lib/server/webhookSecret";

class PaymentFailureEmailClaimError extends Error {}
class PrintReconciliationAlertDeliveryError extends Error {}

export interface OrderIntakeAdapters {
	stripe: Stripe;
	resend: Resend;
	convex: ConvexHttpClient;
	createLumaPrintsOrder: SubmitLumaPrintsOrder;
}

export async function processStripeWebhookEvent(
	event: Stripe.Event,
	adapters: OrderIntakeAdapters,
	verifiedDestinationRole?: CommerceWebhookRole,
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
				if (session.mode !== "payment" || session.metadata?.type === "platform_subscription") break;
				if (session.metadata?.type === "invoice_payment") {
					const tenant = await resolveCommerceTenant(event, adapters.convex);
					await markInvoicePaidFromSession(session, adapters.convex, tenant.siteUrl);
					break;
				}

				const snapshotModeEnabled = env.CHECKOUT_SNAPSHOT_MODE === "handle-v2";
				const admissionProtocol = inspectCheckoutAdmissionMetadata(session.metadata);
				if (admissionProtocol.kind === "invalid-marked") {
					throw new CheckoutSnapshotProtocolError("Invalid Checkout admission protocol");
				}
				const snapshotMarkerPresent = hasCheckoutSnapshotMarker(session.metadata);
				const consumesCheckoutSnapshot = snapshotModeEnabled || snapshotMarkerPresent;
				const stripeAccount = typeof event.account === "string" ? event.account.trim() : undefined;
				const metadataSiteUrl = readCheckoutTenantMarker(session.metadata);
				let routing = null;
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
				if (routing?.source === "retired") break;
				if (consumesCheckoutSnapshot) {
					selectCheckoutSnapshotInput(
						routing?.source ?? null,
						routing?.source === "order"
							? undefined
							: inspectCheckoutSnapshotMetadata(session.metadata),
					);
				}
				const tenantPromise = resolveCommerceTenant(event, adapters.convex, routing?.siteUrl);
				const suppressTenantFailureAlert =
					snapshotModeEnabled || (snapshotMarkerPresent && routing?.source !== "order");
				const tenant = suppressTenantFailureAlert
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
					checkoutSessionAdmission:
						admissionProtocol.kind === "admission-v1" ? admissionProtocol.candidate : undefined,
				});
				break;
			}

			case "payment_intent.payment_failed": {
				const paymentIntent = event.data.object as Stripe.PaymentIntent;
				if (!hasPaymentFailureCommerceAuthority(paymentIntent)) break;
				const tenant = await resolveCommerceTenant(event, adapters.convex);
				await handlePaymentFailed(
					event,
					paymentIntent,
					adapters.resend,
					adapters.convex,
					tenant.notificationProfile,
				);
				break;
			}

			case "refund.created":
			case "refund.updated":
			case "refund.failed": {
				const refundResult = await reconcileSucceededManualRefund(
					event,
					adapters,
					verifiedDestinationRole,
				);
				if (refundResult.kind === "automated_succeeded") {
					const notification = {
						orderId: refundResult.orderId,
						orderNumber: refundResult.orderNumber,
						customerEmail: refundResult.customerEmail,
						errorSummary: refundResult.errorSummary,
						stripeRefundId: refundResult.stripeRefundId,
						total: refundResult.total,
						notificationProfile: refundResult.notificationProfile,
					};
					await sendClaimedAutomatedRefundNotification(adapters, {
						...notification,
						audience: "admin",
					});
					await sendClaimedAutomatedRefundNotification(adapters, {
						...notification,
						audience: "customer",
					});
				} else if (refundResult.kind === "automated_failed") {
					await sendClaimedAutomatedRefundNotification(adapters, {
						audience: "refund_failure",
						orderId: refundResult.orderId,
						orderNumber: refundResult.orderNumber,
						customerEmail: refundResult.customerEmail,
						errorSummary: refundResult.errorSummary,
						stripeRefundId: refundResult.stripeRefundId,
						refundStatus: refundResult.refundStatus,
						total: refundResult.total,
						notificationProfile: refundResult.notificationProfile,
					});
				} else if (refundResult.kind === "automated_attention") {
					await sendClaimedAutomatedRefundNotification(adapters, {
						audience: "refund_attention",
						orderId: refundResult.orderId,
						orderNumber: refundResult.orderNumber,
						customerEmail: refundResult.customerEmail,
						errorSummary: refundResult.errorSummary,
						stripeRefundId: refundResult.stripeRefundId,
						refundStatus: refundResult.refundStatus,
						attentionReason: refundResult.attentionReason,
						total: refundResult.total,
						notificationProfile: refundResult.notificationProfile,
					});
				}
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
		if (
			!(err instanceof CheckoutSnapshotProtocolError) &&
			!(err instanceof ManualRefundReconciliationRetryableError) &&
			!(err instanceof PaymentFailureEmailClaimError) &&
			!(err instanceof PrintReconciliationAlertDeliveryError) &&
			!(err instanceof PrintReconciliationAlertRetryableError) &&
			!(err instanceof PrintReconciliationPendingError) &&
			!(err instanceof ProviderSubmissionClosedRetryableError) &&
			!(err instanceof AutomatedFulfillmentRefundRetryableError) &&
			!(err instanceof AutomatedRefundNotificationRetryableError)
		) {
			await sendFailureAlert(adapters.resend, event.type, sessionId ?? "unknown", errorMessage);
		}
		throw error(
			err instanceof ProviderSubmissionClosedRetryableError ? 503 : 500,
			"Webhook processing failed",
		);
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

function hasPaymentFailureCommerceAuthority(paymentIntent: Stripe.PaymentIntent) {
	const tenantMarker = paymentIntent.metadata?.[COMMERCE_TENANT_METADATA_KEY];
	return typeof tenantMarker === "string" && tenantMarker.trim().length > 0;
}

function paymentFailureAccountScope(event: Stripe.Event) {
	return event.account ? `connected:${event.account}` : "platform";
}

async function handlePaymentFailed(
	event: Stripe.Event,
	paymentIntent: Stripe.PaymentIntent,
	resend: Resend,
	convex: ConvexHttpClient,
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

	let claimed: boolean;
	try {
		claimed = await convex.mutation(api.orders.claimPaymentFailureEmail, {
			webhookSecret: getWebhookSecret(),
			stripeEventId: event.id,
			...(event.account ? { stripeConnectedAccountId: event.account } : {}),
		});
	} catch (cause) {
		logStructured({
			event: "email.payment_failed.claim_failed",
			level: "error",
			stage: "email_customer",
			error: cause,
			meta: {
				stripeEventId: event.id,
				paymentIntentId: paymentIntent.id,
				accountScope: paymentFailureAccountScope(event),
			},
		});
		throw new PaymentFailureEmailClaimError("Payment-failure email claim failed", { cause });
	}
	if (!claimed) {
		logStructured({
			event: "email.payment_failed.duplicate_ignored",
			stage: "email_customer",
			meta: {
				stripeEventId: event.id,
				paymentIntentId: paymentIntent.id,
				accountScope: paymentFailureAccountScope(event),
			},
		});
		return;
	}

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
			meta: {
				stripeEventId: event.id,
				paymentIntentId: paymentIntent.id,
				accountScope: paymentFailureAccountScope(event),
				fatal: false,
			},
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
		checkoutSessionAdmission,
	}: {
		siteUrl: string;
		stripeRequestOptions?: Stripe.RequestOptions;
		notificationProfile: CommerceNotificationProfile;
		routingSource?: "order" | "reservation" | "admission" | null;
		completeLineItems?: boolean;
		checkoutSessionAdmission?: { version: 1; handleHash: string };
	},
) {
	logStructured({
		event: "checkout.processing",
		stage: "webhook",
		sessionId: session.id,
	});

	const markedFirstDelivery =
		routingSource !== "order" && hasCheckoutSnapshotMarker(session.metadata);
	let details: Awaited<ReturnType<typeof fetchSessionDetails>>;
	try {
		details = await fetchSessionDetails(
			session,
			adapters.stripe,
			stripeRequestOptions,
			completeLineItems,
		);
	} catch (cause) {
		if (cause instanceof CheckoutSnapshotProtocolError) throw cause;
		if (markedFirstDelivery) {
			throw new CheckoutSnapshotProtocolError("Checkout details failed", { cause });
		}
		throw cause;
	}
	const { fullSession, lineItems, shippingDetails } = details;
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
			checkoutSessionAdmission,
		},
	);

	if (
		orderResult.fulfillment.kind === "reconciliation_blocked" &&
		orderResult.fulfillment.alertClaimToken !== undefined
	) {
		const claimArgs = {
			orderId: orderResult._id,
			externalId: session.id,
			claimToken: orderResult.fulfillment.alertClaimToken,
			webhookSecret: getWebhookSecret(),
		};
		const sendAuthorized = await adapters.convex.mutation(
			api.orders.authorizePrintFulfillmentReconciliationAlertSend,
			claimArgs,
		);
		if (!sendAuthorized) {
			const deliveryUncertain = await adapters.convex.mutation(
				api.orders.isPrintFulfillmentReconciliationAlertDeliveryUncertain,
				{
					orderId: claimArgs.orderId,
					externalId: claimArgs.externalId,
					webhookSecret: claimArgs.webhookSecret,
				},
			);
			if (deliveryUncertain) {
				logStructured({
					event: "email.reconciliation_blocked.delivery_uncertain",
					level: "error",
					stage: "email_admin",
					sessionId: session.id,
					orderId: orderResult.orderNumber,
					error: new Error("Print reconciliation alert delivery is uncertain"),
				});
			} else {
				throw new PrintReconciliationAlertDeliveryError(
					"Print reconciliation alert lease expired before delivery",
				);
			}
		}
		if (sendAuthorized) {
			try {
				await sendPrintReconciliationBlockedAlert(adapters.resend, {
					orderNumber: orderResult.orderNumber,
					externalId: session.id,
					reconciliationClass: orderResult.fulfillment.reconciliationClass,
					escalationReason: orderResult.fulfillment.escalationReason,
					notificationProfile,
				});
			} catch (err) {
				logStructured({
					event: "email.reconciliation_blocked.send_failed",
					level: "error",
					stage: "email_admin",
					sessionId: session.id,
					orderId: orderResult.orderNumber,
					error: err,
					meta: { fatal: true },
				});
				try {
					await adapters.convex.mutation(
						api.orders.releasePrintFulfillmentReconciliationAlert,
						claimArgs,
					);
				} catch (releaseError) {
					logStructured({
						event: "email.reconciliation_blocked.release_failed",
						level: "error",
						stage: "email_admin",
						sessionId: session.id,
						orderId: orderResult.orderNumber,
						error: releaseError,
					});
				}
				throw new PrintReconciliationAlertDeliveryError(
					"Print reconciliation alert delivery failed",
					{ cause: err },
				);
			}
			let completed: boolean;
			try {
				completed = await adapters.convex.mutation(
					api.orders.completePrintFulfillmentReconciliationAlert,
					claimArgs,
				);
			} catch (completionError) {
				logStructured({
					event: "email.reconciliation_blocked.complete_failed",
					level: "error",
					stage: "email_admin",
					sessionId: session.id,
					orderId: orderResult.orderNumber,
					error: completionError,
				});
				throw new PrintReconciliationAlertDeliveryError(
					"Print reconciliation alert completion failed",
					{ cause: completionError },
				);
			}
			if (!completed) {
				throw new PrintReconciliationAlertDeliveryError(
					"Print reconciliation alert completion failed",
				);
			}
		}
	}

	if (orderResult.notification === "none") {
		logStructured({
			event: "checkout.email_skipped_idempotent",
			stage: "webhook",
			sessionId: session.id,
			orderId: orderResult.orderNumber,
			meta: {
				reason:
					orderResult.fulfillment.kind === "manual_refunded"
						? "order_manually_refunded"
						: orderResult.fulfillment.kind === "reconciliation_blocked"
							? "print_reconciliation_blocked"
							: "confirmation_already_claimed",
			},
		});
	} else if (
		orderResult.notification === "failure" &&
		orderResult.fulfillment.kind === "permanent_failure_refunded"
	) {
		await sendClaimedAutomatedRefundNotification(adapters, {
			audience: "customer",
			orderId: orderResult._id,
			orderNumber: orderResult.orderNumber,
			customerEmail,
			errorSummary: orderResult.fulfillment.errorSummary,
			stripeRefundId: orderResult.fulfillment.stripeRefundId,
			total: fullSession.amount_total ?? 0,
			notificationProfile,
		});
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
