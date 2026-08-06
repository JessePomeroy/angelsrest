import { randomUUID } from "node:crypto";
import type { ConvexHttpClient } from "convex/browser";
import type { Resend } from "resend";
import type Stripe from "stripe";
import { api } from "$convex/api";
import type { Id } from "$convex/dataModel";
import type { CheckoutSnapshotV1 } from "$lib/server/checkoutSnapshotConsumer";
import {
	ANGELS_REST_COMMERCE_PROFILE,
	type CommerceNotificationProfile,
} from "$lib/server/commerceTenant";
import { logStructured, timed } from "$lib/server/logger";
import {
	buildLumaPrintsOrder,
	findOrderByExternalId,
	type LumaPrintsReconciliationClass,
	LumaPrintsReconciliationError,
	LumaPrintsSubmissionError,
} from "$lib/server/lumaprints";
import { buildOrderItemsFromSession, buildRecipientFromShipping } from "$lib/server/webhookDecoder";
import type { ShippingDetails } from "$lib/server/webhookEmails";
import {
	sendAutomatedRefundAttentionAlert,
	sendAutomatedRefundFailureAlert,
	sendCustomerFulfillmentFailure,
	sendFulfillmentFailureAlert,
} from "$lib/server/webhookEmails";
import {
	classifyLumaPrintsFailure,
	formatFailureForAdmin,
} from "$lib/server/webhookErrorClassification";
import { getWebhookSecret } from "$lib/server/webhookSecret";
import type { LumaPrintsOrder, LumaPrintsOrderResponse } from "$lib/shop/types";

/** Distinguishes automated recovery refunds from manual refunds. */
const REFUND_AUTOMATION_TAG = "fulfillment_recovery_v1";

export class PrintReconciliationAlertRetryableError extends Error {}
export class PrintReconciliationPendingError extends Error {}
export class AutomatedFulfillmentRefundRetryableError extends Error {}
export class AutomatedRefundNotificationRetryableError extends Error {}

export type PrintReconciliationEscalationReason =
	| "transport"
	| "rate_or_server"
	| "resource_bound"
	| "client_exception"
	| "result_not_observed";

export type SubmitLumaPrintsOrder = (order: LumaPrintsOrder) => Promise<LumaPrintsOrderResponse>;

export type PrintFulfillmentOutcome =
	| { kind: "fulfilled"; lumaprintsOrderNumber: string }
	| { kind: "no_print_items" }
	| { kind: "no_print_items_replayed" }
	| { kind: "manual_refunded"; stripeRefundId: string }
	| {
			kind: "reconciliation_blocked";
			reconciliationClass: LumaPrintsReconciliationClass;
			escalationReason?: PrintReconciliationEscalationReason;
			alertClaimToken?: string;
	  }
	| {
			kind: "permanent_failure_refunded";
			stripeRefundId: string;
			errorSummary: string;
	  }
	| {
			kind: "automated_refund_failed";
			stripeRefundId: string;
			refundStatus: "failed" | "canceled";
			errorSummary: string;
	  }
	| {
			kind: "automated_refund_attention";
			stripeRefundId: string;
			refundStatus: "pending" | "requires_action";
			attentionReason: "attempts_exhausted" | "age_exceeded";
			errorSummary: string;
	  };

export interface PrintFulfillmentAdapters {
	convex: ConvexHttpClient;
	createLumaPrintsOrder: SubmitLumaPrintsOrder;
	findLumaPrintsOrder?: (externalId: string) => Promise<LumaPrintsOrderResponse | null>;
}

export interface PermanentFulfillmentFailureAdapters {
	convex: ConvexHttpClient;
	stripe: Stripe;
	resend: Resend;
}

function automatedRefundStatus(refund: Stripe.Refund) {
	if (
		refund.status === "pending" ||
		refund.status === "requires_action" ||
		refund.status === "succeeded" ||
		refund.status === "failed" ||
		refund.status === "canceled"
	)
		return refund.status;
	throw new AutomatedFulfillmentRefundRetryableError(
		"Stripe returned an unsupported automated refund status",
	);
}

async function claimReconciliationAlert(
	convex: ConvexHttpClient,
	orderId: Id<"orders">,
	externalId: string,
	webhookSecret: string,
) {
	const alertClaimToken = randomUUID();
	const claim = await convex.mutation(api.orders.claimPrintFulfillmentReconciliationAlert, {
		orderId,
		externalId,
		claimToken: alertClaimToken,
		webhookSecret,
	});
	if (claim.kind === "busy") {
		throw new PrintReconciliationAlertRetryableError(
			"Print reconciliation alert delivery is already in progress",
		);
	}
	return claim.kind === "claimed" ? alertClaimToken : undefined;
}

function classifyInconclusiveReconciliation(error: unknown): PrintReconciliationEscalationReason {
	if (!(error instanceof LumaPrintsReconciliationError)) return "client_exception";
	if (
		error.message.includes("exceeded its") ||
		error.message.includes("pagination was unstable") ||
		error.message.includes("pagination changed") ||
		error.message.includes("pagination contained a duplicate")
	)
		return "resource_bound";
	if (error.message.includes("transport") || error.message.includes("stream")) return "transport";
	if (error.message.includes("unavailable")) return "rate_or_server";
	return "client_exception";
}

async function recordInconclusiveReconciliation(
	convex: ConvexHttpClient,
	orderId: Id<"orders">,
	externalId: string,
	reason: PrintReconciliationEscalationReason,
	webhookSecret: string,
): Promise<PrintFulfillmentOutcome | null> {
	const pending = await convex.mutation(api.orders.recordPrintFulfillmentReconciliationPending, {
		orderId,
		externalId,
		reason,
		webhookSecret,
	});
	if (pending.kind === "pending") return null;
	return {
		kind: "reconciliation_blocked",
		reconciliationClass: pending.reconciliationClass,
		...(pending.escalationReason === undefined
			? {}
			: { escalationReason: pending.escalationReason }),
		alertClaimToken: await claimReconciliationAlert(convex, orderId, externalId, webhookSecret),
	};
}

export async function submitPrintFulfillment(
	{
		convex,
		createLumaPrintsOrder,
		findLumaPrintsOrder = findOrderByExternalId,
	}: PrintFulfillmentAdapters,
	input: {
		orderId: Id<"orders">;
		orderNumber: string;
		lineItems: Stripe.LineItem[];
		shippingDetails: ShippingDetails;
		session: Stripe.Checkout.Session;
		checkoutSnapshot?: CheckoutSnapshotV1;
	},
): Promise<PrintFulfillmentOutcome> {
	const { orderId, orderNumber, lineItems, shippingDetails, session, checkoutSnapshot } = input;
	const webhookSecret = getWebhookSecret();
	const legacyItems = checkoutSnapshot ? undefined : buildOrderItemsFromSession(session, lineItems);
	const hasPrintItems = checkoutSnapshot
		? checkoutSnapshot.items.some(
				({ productKind }) => productKind === "print" || productKind === "print_set",
			)
		: (legacyItems?.length ?? 0) > 0;
	if (!hasPrintItems) {
		const outcome = await convex.mutation(api.orders.claimNonPrintOrderOutcome, {
			orderId,
			webhookSecret,
		});
		logStructured({
			event: "lumaprints.skipped",
			stage: "lumaprints_submit",
			orderId: orderNumber,
			meta: { reason: "no LumaPrints items in order", outcome: outcome.kind },
		});
		if (outcome.kind === "manual_refunded") {
			return { kind: "manual_refunded", stripeRefundId: outcome.stripeRefundId };
		}
		if (outcome.kind === "automated_refunded") {
			return {
				kind: "permanent_failure_refunded",
				stripeRefundId: outcome.stripeRefundId,
				errorSummary: "Fulfillment was already refunded",
			};
		}
		return outcome.kind === "success"
			? { kind: "no_print_items" }
			: { kind: "no_print_items_replayed" };
	}

	const claimToken = randomUUID();
	const claimed = await convex.mutation(api.orders.claimPrintFulfillmentV3, {
		orderId,
		claimToken,
		webhookSecret,
	});
	if (claimed.kind === "fulfilled")
		return { kind: "fulfilled", lumaprintsOrderNumber: claimed.orderNumber };
	if (claimed.kind === "manual_refunded") {
		return { kind: "manual_refunded", stripeRefundId: claimed.stripeRefundId };
	}
	if (claimed.kind === "automated_refunded") {
		return {
			kind: "permanent_failure_refunded",
			stripeRefundId: claimed.stripeRefundId,
			errorSummary: "Fulfillment was already refunded",
		};
	}
	if (claimed.kind === "reconciliation_blocked") {
		return {
			kind: "reconciliation_blocked",
			reconciliationClass: claimed.reconciliationClass,
			...(claimed.escalationReason === undefined
				? {}
				: { escalationReason: claimed.escalationReason }),
			alertClaimToken: await claimReconciliationAlert(convex, orderId, session.id, webhookSecret),
		};
	}
	if (claimed.kind === "busy" || claimed.kind === "preparing") {
		throw new Error("Print fulfillment is already in progress");
	}
	if (claimed.externalId !== session.id)
		throw new Error("Print fulfillment identity does not match paid order");
	if (claimed.kind === "reconcile") {
		let existing: LumaPrintsOrderResponse | null;
		try {
			existing = await findLumaPrintsOrder(claimed.externalId);
		} catch (error) {
			if (
				!(error instanceof LumaPrintsReconciliationError) ||
				error.disposition === "retryable" ||
				error.reconciliationClass === undefined
			) {
				const escalation = await recordInconclusiveReconciliation(
					convex,
					orderId,
					claimed.externalId,
					classifyInconclusiveReconciliation(error),
					webhookSecret,
				);
				if (escalation) return escalation;
				throw new PrintReconciliationPendingError("Print provider reconciliation is pending", {
					cause: error,
				});
			}
			const reconciliationClass = error.reconciliationClass;
			const blocked = await convex.mutation(api.orders.blockPrintFulfillmentReconciliation, {
				orderId,
				externalId: claimed.externalId,
				reconciliationClass,
				webhookSecret,
			});
			if (blocked) {
				return {
					kind: "reconciliation_blocked",
					reconciliationClass,
					alertClaimToken: await claimReconciliationAlert(
						convex,
						orderId,
						claimed.externalId,
						webhookSecret,
					),
				};
			}

			// The block result can be stale when another delivery stores the GET
			// result first. Re-read through the atomic claim before reporting a block.
			const refreshed = await convex.mutation(api.orders.claimPrintFulfillmentV3, {
				orderId,
				claimToken,
				webhookSecret,
			});
			if (refreshed.kind === "fulfilled") {
				return { kind: "fulfilled", lumaprintsOrderNumber: refreshed.orderNumber };
			}
			if (refreshed.kind === "manual_refunded") {
				return { kind: "manual_refunded", stripeRefundId: refreshed.stripeRefundId };
			}
			if (refreshed.kind === "automated_refunded") {
				return {
					kind: "permanent_failure_refunded",
					stripeRefundId: refreshed.stripeRefundId,
					errorSummary: "Fulfillment was already refunded",
				};
			}
			if (refreshed.kind === "reconciliation_blocked") {
				return {
					kind: "reconciliation_blocked",
					reconciliationClass: refreshed.reconciliationClass,
					...(refreshed.escalationReason === undefined
						? {}
						: { escalationReason: refreshed.escalationReason }),
					alertClaimToken: await claimReconciliationAlert(
						convex,
						orderId,
						claimed.externalId,
						webhookSecret,
					),
				};
			}
			if (refreshed.kind === "claimed") {
				const released = await convex.mutation(api.orders.releasePrintFulfillmentClaim, {
					orderId,
					claimToken,
					webhookSecret,
				});
				if (!released) throw new Error("Print preparation claim release is pending");
			}
			throw new Error("Print fulfillment reconciliation state changed");
		}
		if (!existing) {
			const escalation = await recordInconclusiveReconciliation(
				convex,
				orderId,
				claimed.externalId,
				"result_not_observed",
				webhookSecret,
			);
			if (escalation) return escalation;
			throw new PrintReconciliationPendingError("Print provider reconciliation is pending");
		}
		const completion = await convex.mutation(api.orders.reconcilePrintFulfillmentSubmission, {
			orderId,
			externalId: claimed.externalId,
			lumaprintsOrderNumber: existing.orderNumber,
			webhookSecret,
		});
		if (completion.kind === "manual_refunded") {
			return { kind: "manual_refunded", stripeRefundId: completion.stripeRefundId };
		}
		if (completion.kind === "automated_refunded") {
			return {
				kind: "permanent_failure_refunded",
				stripeRefundId: completion.stripeRefundId,
				errorSummary: "Fulfillment was already refunded",
			};
		}
		return { kind: "fulfilled", lumaprintsOrderNumber: existing.orderNumber };
	}

	const releasePreparationClaim = async () => {
		const released = await convex.mutation(api.orders.releasePrintFulfillmentClaim, {
			orderId,
			claimToken,
			webhookSecret,
		});
		if (!released) throw new Error("Print preparation claim release is pending");
	};

	let recipient;
	let items;
	try {
		recipient = checkoutSnapshot?.items.some(
			({ productKind }) => productKind === "print" || productKind === "print_set",
		)
			? buildRecipientFromShipping(shippingDetails)
			: undefined;
		items = checkoutSnapshot
			? await import("$lib/server/snapshotFulfillment").then(({ buildOrderItemsFromSnapshot }) =>
					buildOrderItemsFromSnapshot(checkoutSnapshot, session.id, lineItems),
				)
			: (legacyItems ?? []);
	} catch (cause) {
		await releasePreparationClaim();
		throw cause;
	}
	if (items.length === 0) {
		await releasePreparationClaim();
		logStructured({
			event: "lumaprints.skipped",
			stage: "lumaprints_submit",
			orderId: orderNumber,
			meta: { reason: "no LumaPrints items in order" },
		});
		return { kind: "no_print_items" } satisfies PrintFulfillmentOutcome;
	}

	let lpOrder: LumaPrintsOrder;
	try {
		const borderedItems = items
			.map((item, index) => ({
				index,
				imageUrl: item.imageUrl,
				borderWidthInches: item.borderWidth ?? 0,
				sourcePolicy: item.sourcePolicy ?? ("byte_exact" as const),
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
				() => processBorderedPrints(borderedItems, session.id),
			);
			for (const [index, r2Url] of urlMap) {
				items[index].imageUrl = r2Url;
				items[index].sourcePolicy = "bordered_r2";
			}
		}
		recipient ??= buildRecipientFromShipping(shippingDetails);
		lpOrder = buildLumaPrintsOrder(session.id, recipient, items);
	} catch (cause) {
		await releasePreparationClaim();
		throw cause;
	}

	const submission = await convex.mutation(api.orders.beginPrintFulfillmentSubmission, {
		orderId,
		claimToken,
		webhookSecret,
	});
	if (submission.kind === "manual_refunded") {
		return { kind: "manual_refunded", stripeRefundId: submission.stripeRefundId };
	}
	if (submission.kind === "automated_refunded") {
		return {
			kind: "permanent_failure_refunded",
			stripeRefundId: submission.stripeRefundId,
			errorSummary: "Fulfillment was already refunded",
		};
	}
	if (submission.kind !== "submitting" || submission.externalId !== lpOrder.externalId) {
		throw new Error("Print fulfillment preparation lease was lost");
	}

	let result: LumaPrintsOrderResponse;
	try {
		result = await createLumaPrintsOrder(lpOrder);
	} catch (error) {
		if (error instanceof LumaPrintsSubmissionError && error.disposition === "definitely_rejected") {
			const rejection = await convex.mutation(api.orders.rejectPrintFulfillmentSubmission, {
				orderId,
				claimToken,
				externalId: submission.externalId,
				webhookSecret,
			});
			if (rejection.kind === "manual_refunded") {
				return { kind: "manual_refunded", stripeRefundId: rejection.stripeRefundId };
			}
			if (rejection.kind === "automated_refunded") {
				return {
					kind: "permanent_failure_refunded",
					stripeRefundId: rejection.stripeRefundId,
					errorSummary: "Fulfillment was already refunded",
				};
			}
			throw error;
		}
		throw new Error("Print provider submission outcome is unknown");
	}
	logStructured({
		event: "lumaprints.submitted",
		stage: "lumaprints_submit",
		orderId: orderNumber,
		meta: { itemCount: items.length },
	});
	const completion = await convex.mutation(api.orders.completePrintFulfillmentSubmission, {
		orderId,
		claimToken,
		externalId: submission.externalId,
		lumaprintsOrderNumber: result.orderNumber,
		webhookSecret,
	});
	logStructured({
		event: "lumaprints.recorded",
		stage: "lumaprints_submit",
		orderId: orderNumber,
		meta: { lumaprintsOrderNumber: result.orderNumber },
	});
	if (completion.kind === "manual_refunded") {
		return { kind: "manual_refunded", stripeRefundId: completion.stripeRefundId };
	}
	if (completion.kind === "automated_refunded") {
		return {
			kind: "permanent_failure_refunded",
			stripeRefundId: completion.stripeRefundId,
			errorSummary: "Fulfillment was already refunded",
		};
	}
	return {
		kind: "fulfilled",
		lumaprintsOrderNumber: result.orderNumber,
	} satisfies PrintFulfillmentOutcome;
}

export async function handlePrintFulfillmentFailure(
	adapters: PermanentFulfillmentFailureAdapters,
	{
		orderId,
		orderNumber,
		error,
		session,
		stripeRequestOptions,
		customerEmail,
		notificationProfile = ANGELS_REST_COMMERCE_PROFILE,
	}: {
		orderId: Id<"orders">;
		orderNumber: string;
		error: unknown;
		session: Stripe.Checkout.Session;
		stripeRequestOptions?: Stripe.RequestOptions;
		customerEmail: string;
		notificationProfile?: CommerceNotificationProfile;
	},
) {
	const classification = classifyLumaPrintsFailure(error);

	logStructured({
		event: "lumaprints.classified",
		level: "warn",
		stage: "lumaprints_submit",
		orderId: orderNumber,
		meta: { classification },
	});

	if (classification === "transient") throw new Error("Print provider temporarily unavailable");
	if (classification === "refunded") throw new Error("Refund reconciliation is pending");

	return handlePermanentFulfillmentFailure(adapters, {
		orderId,
		orderNumber,
		error,
		session,
		stripeRequestOptions,
		customerEmail,
		notificationProfile,
	});
}

/** Durably checkpoint, converge, and notify around one idempotent Stripe refund. */
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
		durableFulfillmentError,
		session,
		stripeRequestOptions,
		customerEmail,
		notificationProfile = ANGELS_REST_COMMERCE_PROFILE,
	}: {
		orderId: Id<"orders">;
		orderNumber: string;
		error: unknown;
		durableFulfillmentError?: string;
		session: Stripe.Checkout.Session;
		stripeRequestOptions?: Stripe.RequestOptions;
		customerEmail: string;
		notificationProfile?: CommerceNotificationProfile;
	},
) {
	const errorSummary = durableFulfillmentError ?? formatFailureForAdmin(fulfillmentError);
	const truncatedError = errorSummary.slice(0, 1000);

	const paymentIntentId =
		typeof session.payment_intent === "string"
			? session.payment_intent
			: (session.payment_intent?.id ?? undefined);
	if (!paymentIntentId) {
		throw new Error(`Cannot refund order ${orderNumber}: Stripe session has no payment_intent`);
	}
	const webhookSecret = getWebhookSecret();
	const refundClaimToken = randomUUID();
	const refundClaim = await convex.mutation(api.orders.claimAutomatedFulfillmentRefundV2, {
		webhookSecret,
		orderId,
		claimToken: refundClaimToken,
		fulfillmentError: truncatedError,
	});
	if (refundClaim.kind === "busy") {
		throw new AutomatedFulfillmentRefundRetryableError(
			"Automated fulfillment refund is already in progress",
		);
	}
	if (refundClaim.kind === "unavailable") {
		throw new AutomatedFulfillmentRefundRetryableError(
			"Automated fulfillment refund claim is unavailable",
		);
	}
	if (refundClaim.kind === "refunded") {
		await sendClaimedFulfillmentFailureAdminAlert(
			{ convex, resend },
			{
				orderId,
				orderNumber,
				customerEmail,
				errorSummary,
				stripeRefundId: refundClaim.stripeRefundId,
				total: session.amount_total ?? 0,
				notificationProfile,
			},
		);
		return {
			kind: "permanent_failure_refunded",
			stripeRefundId: refundClaim.stripeRefundId,
			errorSummary,
		} satisfies PrintFulfillmentOutcome;
	}
	if (refundClaim.kind === "refund_failed") {
		await sendClaimedAutomatedRefundNotification(
			{ convex, resend },
			{
				audience: "refund_failure",
				orderId,
				orderNumber,
				customerEmail,
				errorSummary,
				stripeRefundId: refundClaim.stripeRefundId,
				refundStatus: refundClaim.refundStatus,
				total: session.amount_total ?? 0,
				notificationProfile,
			},
		);
		return {
			kind: "automated_refund_failed",
			stripeRefundId: refundClaim.stripeRefundId,
			refundStatus: refundClaim.refundStatus,
			errorSummary,
		} satisfies PrintFulfillmentOutcome;
	}
	if (refundClaim.kind === "refund_attention") {
		await sendClaimedAutomatedRefundNotification(
			{ convex, resend },
			{
				audience: "refund_attention",
				orderId,
				orderNumber,
				customerEmail,
				errorSummary,
				stripeRefundId: refundClaim.stripeRefundId,
				refundStatus: refundClaim.refundStatus,
				attentionReason: refundClaim.attentionReason,
				total: session.amount_total ?? 0,
				notificationProfile,
			},
		);
		return {
			kind: "automated_refund_attention",
			stripeRefundId: refundClaim.stripeRefundId,
			refundStatus: refundClaim.refundStatus,
			attentionReason: refundClaim.attentionReason,
			errorSummary,
		} satisfies PrintFulfillmentOutcome;
	}

	const isConnectedAccountRefund = Boolean(stripeRequestOptions?.stripeAccount);
	let refund: Stripe.Refund;
	try {
		refund = refundClaim.stripeRefundId
			? await stripe.refunds.retrieve(refundClaim.stripeRefundId, stripeRequestOptions)
			: await stripe.refunds.create(
					{
						payment_intent: paymentIntentId,
						reason: "requested_by_customer",
						...(isConnectedAccountRefund ? { refund_application_fee: true } : {}),
						metadata: {
							orderNumber,
							fulfillmentError: truncatedError.slice(0, 500),
							automated: REFUND_AUTOMATION_TAG,
						},
					},
					{
						...(stripeRequestOptions ?? {}),
						idempotencyKey: `fulfillment-refund:${session.id}`,
					},
				);
	} catch (cause) {
		try {
			await convex.mutation(api.orders.releaseAutomatedFulfillmentRefund, {
				webhookSecret,
				orderId,
				claimToken: refundClaimToken,
			});
		} catch (releaseError) {
			logStructured({
				event: "refund.claim_release_failed",
				level: "error",
				stage: "stripe_refund",
				orderId: orderNumber,
				error: releaseError,
			});
		}
		throw cause;
	}
	const stripeRefundId = refund.id;
	const refundStatus = automatedRefundStatus(refund);
	logStructured({
		event: "refund.created",
		stage: "stripe_refund",
		orderId: orderNumber,
		meta: { refundId: refund.id, refundStatus },
	});

	const recorded = await convex.mutation(api.orders.recordAutomatedFulfillmentRefund, {
		webhookSecret,
		orderId,
		claimToken: refundClaimToken,
		stripeRefundId,
		stripeRefundStatus: refundStatus,
	});
	if (recorded.kind === "pending") {
		throw new AutomatedFulfillmentRefundRetryableError(
			`Automated fulfillment refund is ${recorded.refundStatus}`,
		);
	}
	if (recorded.kind === "refund_attention") {
		await sendClaimedAutomatedRefundNotification(
			{ convex, resend },
			{
				audience: "refund_attention",
				orderId,
				orderNumber,
				customerEmail,
				errorSummary,
				stripeRefundId,
				refundStatus: recorded.refundStatus,
				attentionReason: recorded.attentionReason,
				total: session.amount_total ?? 0,
				notificationProfile,
			},
		);
		return {
			kind: "automated_refund_attention",
			stripeRefundId,
			refundStatus: recorded.refundStatus,
			attentionReason: recorded.attentionReason,
			errorSummary,
		} satisfies PrintFulfillmentOutcome;
	}
	if (recorded.kind === "refund_failed") {
		await sendClaimedAutomatedRefundNotification(
			{ convex, resend },
			{
				audience: "refund_failure",
				orderId,
				orderNumber,
				customerEmail,
				errorSummary,
				stripeRefundId,
				refundStatus: recorded.refundStatus,
				total: session.amount_total ?? 0,
				notificationProfile,
			},
		);
		return {
			kind: "automated_refund_failed",
			stripeRefundId,
			refundStatus: recorded.refundStatus,
			errorSummary,
		} satisfies PrintFulfillmentOutcome;
	}

	await sendClaimedFulfillmentFailureAdminAlert(
		{ convex, resend },
		{
			orderId,
			orderNumber,
			customerEmail,
			errorSummary,
			stripeRefundId,
			total: session.amount_total ?? 0,
			notificationProfile,
		},
	);

	return {
		kind: "permanent_failure_refunded",
		stripeRefundId,
		errorSummary,
	} satisfies PrintFulfillmentOutcome;
}

export async function sendClaimedFulfillmentFailureAdminAlert(
	{ convex, resend }: { convex: ConvexHttpClient; resend: Resend },
	{
		orderId,
		orderNumber,
		customerEmail,
		errorSummary,
		stripeRefundId,
		total,
		notificationProfile = ANGELS_REST_COMMERCE_PROFILE,
	}: {
		orderId: Id<"orders">;
		orderNumber: string;
		customerEmail: string;
		errorSummary: string;
		stripeRefundId: string;
		total: number;
		notificationProfile?: CommerceNotificationProfile;
	},
) {
	return sendClaimedAutomatedRefundNotification(
		{ convex, resend },
		{
			audience: "admin",
			orderId,
			orderNumber,
			customerEmail,
			errorSummary,
			stripeRefundId,
			total,
			notificationProfile,
		},
	);
}

export async function sendClaimedAutomatedRefundNotification(
	{ convex, resend }: { convex: ConvexHttpClient; resend: Resend },
	input: {
		audience: "admin" | "customer" | "refund_failure" | "refund_attention";
		orderId: Id<"orders">;
		orderNumber: string;
		customerEmail: string;
		errorSummary: string;
		stripeRefundId: string;
		refundStatus?: "pending" | "requires_action" | "failed" | "canceled";
		attentionReason?: "attempts_exhausted" | "age_exceeded";
		total: number;
		notificationProfile?: CommerceNotificationProfile;
	},
) {
	const claimToken = randomUUID();
	const claimArgs = {
		webhookSecret: getWebhookSecret(),
		orderId: input.orderId,
		audience: input.audience,
		claimToken,
	};
	const claim = await convex.mutation(api.orders.claimFulfillmentFailureNotificationV2, claimArgs);
	if (claim.kind === "unavailable") return false;
	if (claim.kind === "busy") {
		throw new AutomatedRefundNotificationRetryableError(
			"Automated refund notification delivery is already in progress",
		);
	}
	try {
		if (input.audience === "customer") {
			await sendCustomerFulfillmentFailure(resend, {
				customerEmail: input.customerEmail,
				orderNumber: input.orderNumber,
				stripeRefundId: input.stripeRefundId,
				total: input.total,
				notificationProfile: input.notificationProfile,
			});
		} else if (input.audience === "refund_failure") {
			if (input.refundStatus !== "failed" && input.refundStatus !== "canceled") {
				throw new Error("Automated refund failure status is missing");
			}
			await sendAutomatedRefundFailureAlert(resend, {
				orderNumber: input.orderNumber,
				customerEmail: input.customerEmail,
				errorSummary: input.errorSummary,
				stripeRefundId: input.stripeRefundId,
				refundStatus: input.refundStatus,
				total: input.total,
				notificationProfile: input.notificationProfile,
			});
		} else if (input.audience === "refund_attention") {
			if (
				(input.refundStatus !== "pending" && input.refundStatus !== "requires_action") ||
				input.attentionReason === undefined
			) {
				throw new Error("Automated refund attention details are missing");
			}
			await sendAutomatedRefundAttentionAlert(resend, {
				orderNumber: input.orderNumber,
				customerEmail: input.customerEmail,
				errorSummary: input.errorSummary,
				stripeRefundId: input.stripeRefundId,
				refundStatus: input.refundStatus,
				attentionReason: input.attentionReason,
				total: input.total,
				notificationProfile: input.notificationProfile,
			});
		} else {
			await sendFulfillmentFailureAlert(resend, {
				orderNumber: input.orderNumber,
				customerEmail: input.customerEmail,
				errorSummary: input.errorSummary,
				stripeRefundId: input.stripeRefundId,
				total: input.total,
				notificationProfile: input.notificationProfile,
			});
		}
	} catch (cause) {
		try {
			await convex.mutation(api.orders.releaseFulfillmentFailureNotificationV2, claimArgs);
		} catch (releaseError) {
			logStructured({
				event: "refund.notification.release_failed",
				level: "error",
				stage: input.audience === "customer" ? "email_customer" : "email_admin",
				orderId: input.orderNumber,
				error: releaseError,
			});
		}
		throw new AutomatedRefundNotificationRetryableError(
			"Automated refund notification delivery failed",
			{ cause },
		);
	}
	const completed = await convex.mutation(
		api.orders.completeFulfillmentFailureNotificationV2,
		claimArgs,
	);
	if (!completed) {
		throw new AutomatedRefundNotificationRetryableError(
			"Automated refund notification completion failed",
		);
	}
	return true;
}
