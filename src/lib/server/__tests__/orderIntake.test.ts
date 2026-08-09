import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "$convex/dataModel";

const mockLogStructured = vi.fn();
const mockSendAdminNotification = vi.fn();
const mockSendAutomatedRefundAttentionAlert = vi.fn();
const mockSendAutomatedRefundFailureAlert = vi.fn();
const mockSendCustomerConfirmation = vi.fn();
const mockSendCustomerFulfillmentFailure = vi.fn();
const mockSendFailureAlert = vi.fn();
const mockSendFulfillmentFailureAlert = vi.fn();
const mockSendPaymentFailedEmail = vi.fn();
const mockSendPrintReconciliationBlockedAlert = vi.fn();
const mockBuildOrderItemsFromSnapshot = vi.fn();
const mockPrivateEnv = vi.hoisted(() => ({
	LUMAPRINTS_STORE_ID: "123",
	WEBHOOK_SECRET: "test-webhook-secret",
	CHECKOUT_SNAPSHOT_MODE: undefined as string | undefined,
}));

vi.mock("$lib/server/logger", () => ({
	logStructured: mockLogStructured,
	timed: async (_meta: unknown, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("$lib/server/webhookEmails", () => ({
	sendAdminNotification: mockSendAdminNotification,
	sendAutomatedRefundAttentionAlert: mockSendAutomatedRefundAttentionAlert,
	sendAutomatedRefundFailureAlert: mockSendAutomatedRefundFailureAlert,
	sendCustomerConfirmation: mockSendCustomerConfirmation,
	sendCustomerFulfillmentFailure: mockSendCustomerFulfillmentFailure,
	sendFailureAlert: mockSendFailureAlert,
	sendFulfillmentFailureAlert: mockSendFulfillmentFailureAlert,
	sendPaymentFailedEmail: mockSendPaymentFailedEmail,
	sendPrintReconciliationBlockedAlert: mockSendPrintReconciliationBlockedAlert,
}));

vi.mock("$convex/api", () => ({
	api: {
		invoices: { markPaid: "invoices.markPaid" },
		orders: {
			beginPrintFulfillmentSubmission: "orders.beginPrintFulfillmentSubmission",
			blockPrintFulfillmentReconciliation: "orders.blockPrintFulfillmentReconciliation",
			claimAutomatedFulfillmentRefundV2: "orders.claimAutomatedFulfillmentRefundV2",
			claimFulfillmentFailureNotificationV2: "orders.claimFulfillmentFailureNotificationV2",
			claimFulfillmentFailureNotificationV3: "orders.claimFulfillmentFailureNotificationV3",
			authorizeFulfillmentFailureNotificationSendV2:
				"orders.authorizeFulfillmentFailureNotificationSendV2",
			isFulfillmentFailureNotificationDeliveryUncertain:
				"orders.isFulfillmentFailureNotificationDeliveryUncertain",
			authorizePrintFulfillmentReconciliationAlertSend:
				"orders.authorizePrintFulfillmentReconciliationAlertSend",
			isPrintFulfillmentReconciliationAlertDeliveryUncertain:
				"orders.isPrintFulfillmentReconciliationAlertDeliveryUncertain",
			isAutomatedFulfillmentRefundRequestUncertain:
				"orders.isAutomatedFulfillmentRefundRequestUncertain",
			markAutomatedFulfillmentRefundRequestUncertain:
				"orders.markAutomatedFulfillmentRefundRequestUncertain",
			claimOrderConfirmation: "orders.claimOrderConfirmation",
			claimPaymentFailureEmail: "orders.claimPaymentFailureEmail",
			claimNonPrintOrderOutcome: "orders.claimNonPrintOrderOutcome",
			claimPrintFulfillmentV3: "orders.claimPrintFulfillmentV3",
			claimPrintFulfillmentReconciliationAlert: "orders.claimPrintFulfillmentReconciliationAlert",
			completeFulfillmentFailureNotificationV2: "orders.completeFulfillmentFailureNotificationV2",
			recordAutomatedFulfillmentRefund: "orders.recordAutomatedFulfillmentRefund",
			completePrintFulfillmentReconciliationAlert:
				"orders.completePrintFulfillmentReconciliationAlert",
			completePrintFulfillmentSubmission: "orders.completePrintFulfillmentSubmission",
			create: "orders.create",
			reconcilePrintFulfillmentSubmission: "orders.reconcilePrintFulfillmentSubmission",
			reconcileAutomatedFulfillmentRefund: "orders.reconcileAutomatedFulfillmentRefund",
			reconcileSucceededManualRefund: "orders.reconcileSucceededManualRefund",
			rejectPrintFulfillmentSubmission: "orders.rejectPrintFulfillmentSubmission",
			releasePrintFulfillmentClaim: "orders.releasePrintFulfillmentClaim",
			releaseAutomatedFulfillmentRefund: "orders.releaseAutomatedFulfillmentRefund",
			releaseFulfillmentFailureNotificationV2: "orders.releaseFulfillmentFailureNotificationV2",
			releasePrintFulfillmentReconciliationAlert:
				"orders.releasePrintFulfillmentReconciliationAlert",
			resolveCheckoutRouting: "orders.resolveCheckoutRouting",
			recordPrintFulfillmentReconciliationPending:
				"orders.recordPrintFulfillmentReconciliationPending",
			updatePrintFulfillment: "orders.updatePrintFulfillment",
			updateStatus: "orders.updateStatus",
		},
		platform: {
			getByStripeConnectedAccountId: "platform.getByStripeConnectedAccountId",
			getCommerceProfileForSite: "platform.getCommerceProfileForSite",
		},
	},
}));

vi.mock("$env/dynamic/private", () => ({ env: mockPrivateEnv }));
vi.mock("$lib/server/snapshotFulfillment", () => ({
	buildOrderItemsFromSnapshot: mockBuildOrderItemsFromSnapshot,
}));

vi.mock("$lib/config/site", () => ({
	ADMIN_EMAIL: "admin@example.com",
	SITE_DOMAIN: "angelsrest.online",
}));

function makeStripeEvent(
	type: string,
	object: unknown,
	overrides?: Partial<Stripe.Event>,
): Stripe.Event {
	return {
		id: "evt_test12345678",
		type,
		data: { object },
		...overrides,
	} as Stripe.Event;
}

function makeCheckoutSession(
	overrides?: Partial<Stripe.Checkout.Session>,
): Stripe.Checkout.Session {
	return {
		id: "cs_test_123",
		amount_total: 3500,
		amount_subtotal: 3500,
		customer_email: "jane@example.com",
		customer_details: {
			email: "jane@example.com",
			name: "Jane Doe",
		},
		collected_information: {
			shipping_details: {
				name: "Jane Doe",
				address: {
					line1: "123 Main St",
					line2: null,
					city: "Portland",
					state: "OR",
					postal_code: "97201",
					country: "US",
				},
			},
		},
		metadata: {
			imageUrl: "https://cdn.sanity.io/images/photo.jpg",
			paperSubcategoryId: "103001",
			paperWidth: "8",
			paperHeight: "10",
			paperName: "Archival Matte",
			paperSizeLabel: "8×10",
			productSlug: "spring-meadow",
		},
		mode: "payment",
		payment_intent: "pi_test_123",
		payment_status: "paid",
		...overrides,
	} as unknown as Stripe.Checkout.Session;
}

function makeLineItem(ordinal = 0): Stripe.LineItem {
	return {
		id: `li_test_${ordinal}`,
		amount_total: 3500 + ordinal,
		description: `Spring Meadow print ${ordinal}`,
		quantity: 1,
	} as Stripe.LineItem;
}

const snapshotHandle = "123e4567-e89b-42d3-a456-426614174000";
function handleMetadata(overrides: Record<string, string> = {}) {
	return {
		...makeCheckoutSession().metadata,
		checkoutSnapshotVersion: "2",
		checkoutSnapshotHandle: snapshotHandle,
		commerceTenantSiteUrl: "angelsrest.online",
		...overrides,
	};
}

function makeOrderResult(overrides: Record<string, unknown> = {}) {
	return {
		_id: "order-123" as Id<"orders">,
		orderNumber: "ORD-001",
		alreadyExisted: false,
		lumaprintsOrderNumber: undefined,
		status: "new",
		stripeFees: undefined,
		fulfillmentError: undefined,
		stripeRefundId: undefined,
		fulfillmentRecoveryStatus: undefined,
		printFulfillmentClaim: undefined,
		printFulfillmentPhase: undefined,
		printFulfillmentResolution: undefined,
		printFulfillmentReconciliationClass: undefined,
		...overrides,
	};
}

describe("processStripeWebhookEvent", () => {
	let orderCreateResults: Array<ReturnType<typeof makeOrderResult>>;
	let claimedExternalId: string | undefined;
	let claimResultOverride: Record<string, unknown> | undefined;
	let printClaimResults: Array<Record<string, unknown>>;
	let printCompletionResultOverride: Record<string, unknown> | undefined;
	let nonPrintOutcomeOverride: Record<string, unknown> | undefined;
	let orderConfirmationClaimResults: boolean[];
	let blockReconciliationResults: boolean[];
	let reconciliationAlertClaimResults: Array<
		{ kind: "claimed" | "unavailable" } | { kind: "busy"; leaseExpiresAt: number }
	>;
	let reconciliationAlertCompletionResults: Array<boolean | Error>;
	let fulfillmentFailureNotificationClaimResults: Array<
		{ kind: "claimed" | "unavailable" } | { kind: "busy"; leaseExpiresAt: number }
	>;
	let automatedRefundClaimResults: Array<Record<string, unknown>>;
	let automatedRefundRequestUncertainResults: boolean[];
	let automatedRefundCompletionResults: Array<
		{ kind: "succeeded"; stripeRefundId: string } | Error
	>;
	let automatedRefundReconciliationResult: Record<string, unknown> | undefined;
	let manualRefundReconciliationResult: Record<string, unknown>;
	let paymentFailureClaimResults: boolean[];
	const convex = {
		mutation: vi.fn(),
		query: vi.fn(),
	} as any;
	const resend = {} as any;
	const createLumaPrintsOrder = vi.fn();
	const stripe = {
		checkout: {
			sessions: {
				retrieve: vi.fn(),
				list: vi.fn(),
				listLineItems: vi.fn(),
			},
		},
		refunds: {
			create: vi.fn(),
			retrieve: vi.fn(),
		},
	} as any;

	beforeEach(() => {
		vi.clearAllMocks();
		orderCreateResults = [makeOrderResult()];
		claimedExternalId = undefined;
		claimResultOverride = undefined;
		printClaimResults = [];
		printCompletionResultOverride = undefined;
		nonPrintOutcomeOverride = undefined;
		orderConfirmationClaimResults = [true];
		blockReconciliationResults = [true];
		reconciliationAlertClaimResults = [{ kind: "claimed" }, { kind: "unavailable" }];
		reconciliationAlertCompletionResults = [true];
		fulfillmentFailureNotificationClaimResults = [{ kind: "claimed" }, { kind: "claimed" }];
		automatedRefundClaimResults = [];
		automatedRefundRequestUncertainResults = [];
		automatedRefundCompletionResults = [];
		automatedRefundReconciliationResult = undefined;
		manualRefundReconciliationResult = { kind: "reconciled" };
		vi.unstubAllGlobals();
		paymentFailureClaimResults = [true];
		convex.mutation.mockImplementation(
			async (reference: string, args: { update?: string; stripeSessionId?: string }) => {
				if (reference === "orders.create") {
					claimedExternalId = args.stripeSessionId;
					const result = orderCreateResults.shift();
					if (!result) throw new Error("Missing configured orders.create result");
					return result;
				}
				if (reference === "orders.claimNonPrintOrderOutcome") {
					return nonPrintOutcomeOverride ?? { kind: "success" };
				}
				if (reference === "orders.claimOrderConfirmation") {
					const result = orderConfirmationClaimResults.shift();
					if (result === undefined) throw new Error("Missing order-confirmation claim result");
					return result;
				}
				if (reference === "orders.claimPaymentFailureEmail") {
					const result = paymentFailureClaimResults.shift();
					if (result === undefined) throw new Error("Missing payment-failure claim result");
					return result;
				}
				if (reference === "orders.claimPrintFulfillmentV3")
					return (
						printClaimResults.shift() ??
						claimResultOverride ?? { kind: "claimed", externalId: claimedExternalId }
					);
				if (reference === "orders.beginPrintFulfillmentSubmission") {
					return { kind: "submitting", externalId: claimedExternalId };
				}
				if (reference === "orders.reconcileSucceededManualRefund") {
					return manualRefundReconciliationResult;
				}
				if (reference === "orders.reconcileAutomatedFulfillmentRefund") {
					return (
						automatedRefundReconciliationResult ?? {
							kind: "pending",
							refundStatus: "pending",
						}
					);
				}
				if (reference === "orders.releasePrintFulfillmentClaim") return true;
				if (reference === "orders.releaseAutomatedFulfillmentRefund") return true;
				if (reference === "orders.releasePrintFulfillmentReconciliationAlert") return true;
				if (reference === "orders.isAutomatedFulfillmentRefundRequestUncertain") {
					return automatedRefundRequestUncertainResults.shift() ?? false;
				}
				if (reference === "orders.markAutomatedFulfillmentRefundRequestUncertain") return true;
				if (reference === "orders.claimAutomatedFulfillmentRefundV2") {
					return (
						automatedRefundClaimResults.shift() ?? {
							kind: "claimed",
							leaseExpiresAt: Date.now() + 60_000,
						}
					);
				}
				if (reference === "orders.recordAutomatedFulfillmentRefund") {
					const result = automatedRefundCompletionResults.shift() ?? {
						kind: "succeeded",
						stripeRefundId: "re_test_123",
					};
					if (result instanceof Error) throw result;
					return result;
				}
				if (
					reference === "orders.claimFulfillmentFailureNotificationV2" ||
					reference === "orders.claimFulfillmentFailureNotificationV3"
				) {
					const result = fulfillmentFailureNotificationClaimResults.shift();
					if (result === undefined) {
						throw new Error("Missing fulfillment-failure notification claim result");
					}
					return result;
				}
				if (reference === "orders.authorizeFulfillmentFailureNotificationSendV2") return true;
				if (reference === "orders.isFulfillmentFailureNotificationDeliveryUncertain") {
					return false;
				}
				if (reference === "orders.releaseFulfillmentFailureNotificationV2") return true;
				if (reference === "orders.completeFulfillmentFailureNotificationV2") return true;
				if (reference === "orders.recordPrintFulfillmentReconciliationPending") {
					return { kind: "pending", attempts: 1 };
				}
				if (reference === "orders.blockPrintFulfillmentReconciliation") {
					const result = blockReconciliationResults.shift();
					if (result === undefined) throw new Error("Missing reconciliation-block claim result");
					return result;
				}
				if (reference === "orders.authorizePrintFulfillmentReconciliationAlertSend") {
					return true;
				}
				if (reference === "orders.isPrintFulfillmentReconciliationAlertDeliveryUncertain") {
					return false;
				}
				if (reference === "orders.claimPrintFulfillmentReconciliationAlert") {
					const result = reconciliationAlertClaimResults.shift();
					if (result === undefined) throw new Error("Missing reconciliation-alert claim result");
					return result;
				}
				if (reference === "orders.completePrintFulfillmentReconciliationAlert") {
					const result = reconciliationAlertCompletionResults.shift();
					if (result === undefined) {
						throw new Error("Missing reconciliation-alert completion result");
					}
					if (result instanceof Error) throw result;
					return result;
				}
				if (reference === "orders.rejectPrintFulfillmentSubmission") {
					return { kind: "refund_pending" };
				}
				if (
					reference === "orders.completePrintFulfillmentSubmission" ||
					reference === "orders.reconcilePrintFulfillmentSubmission"
				)
					return printCompletionResultOverride ?? { kind: "fulfilled" };
				if (reference === "orders.updatePrintFulfillment") return { kind: args.update };
				if (reference === "orders.updateStatus") {
					return undefined;
				}
				return undefined;
			},
		);
		convex.query.mockReset();
		mockPrivateEnv.CHECKOUT_SNAPSHOT_MODE = undefined;
		stripe.checkout.sessions.retrieve.mockReset();
		stripe.checkout.sessions.list.mockReset();
		stripe.checkout.sessions.listLineItems.mockReset();
		stripe.refunds.create.mockResolvedValue({ id: "re_test_123", status: "succeeded" });
		createLumaPrintsOrder.mockResolvedValue({ orderNumber: "123" });
	});

	function adapters() {
		return { stripe, resend, convex, createLumaPrintsOrder };
	}

	function manualRefundEvent(overrides: Record<string, unknown> = {}) {
		return makeStripeEvent(
			"refund.created",
			{
				id: "re_1234567890abcdef",
				amount: 1500,
				charge: "ch_1234567890abcdef",
				currency: "usd",
				metadata: {},
				payment_intent: "pi_1234567890abcdef",
				status: "succeeded",
				...overrides,
			},
			{ id: "evt_1234567890abcdef", livemode: false },
		);
	}

	function automatedRefundEvent(
		status: "pending" | "requires_action" | "succeeded" | "failed" | "canceled",
		type: "refund.created" | "refund.updated" | "refund.failed" = "refund.updated",
	) {
		return makeStripeEvent(
			type,
			{
				id: "re_automated1234567890",
				amount: 1500,
				charge: "ch_1234567890abcdef",
				currency: "usd",
				metadata: {
					automated: "fulfillment_recovery_v1",
					orderNumber: "ORD-001",
				},
				payment_intent: "pi_1234567890abcdef",
				status,
			},
			{ id: "evt_automated1234567890", livemode: false },
		);
	}

	function manualRefundSession(overrides: Record<string, unknown> = {}) {
		return {
			id: "cs_test_1234567890abcdef",
			amount_total: 1500,
			currency: "usd",
			livemode: false,
			metadata: null,
			mode: "payment",
			payment_intent: "pi_1234567890abcdef",
			payment_status: "paid",
			status: "complete",
			...overrides,
		};
	}

	it("reconciles signed full manual refunds without email or fulfillment effects", async () => {
		stripe.checkout.sessions.list.mockResolvedValue({
			data: [manualRefundSession()],
			has_more: false,
		});
		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(manualRefundEvent(), adapters());
		expect(stripe.checkout.sessions.list).toHaveBeenCalledWith({
			payment_intent: "pi_1234567890abcdef",
			limit: 2,
		});
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.reconcileSucceededManualRefund",
			expect.objectContaining({ stripeRefundId: "re_1234567890abcdef" }),
		);
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
	});

	it("returns a retryable host error for a signed refund fenced by a legacy submission", async () => {
		stripe.checkout.sessions.list.mockResolvedValue({
			data: [manualRefundSession()],
			has_more: false,
		});
		manualRefundReconciliationResult = {
			kind: "retryable",
			reason: "print_submission_in_flight",
		};
		const { processStripeWebhookEvent } = await import("../orderIntake");
		await expect(processStripeWebhookEvent(manualRefundEvent(), adapters())).rejects.toMatchObject({
			status: 500,
		});
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.reconcileSucceededManualRefund",
			expect.anything(),
		);
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
	});

	it("reconciles a signed automated succeeded update before sending leased success copy", async () => {
		stripe.checkout.sessions.list.mockResolvedValue({
			data: [manualRefundSession({ metadata: { commerceTenantSiteUrl: "angelsrest.online" } })],
			has_more: false,
		});
		automatedRefundReconciliationResult = {
			kind: "succeeded",
			orderId: "order-123",
			orderNumber: "ORD-001",
			customerEmail: "buyer@example.com",
			total: 1500,
			errorSummary: "Provider rejected fulfillment",
			stripeRefundId: "re_automated1234567890",
		};
		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(automatedRefundEvent("succeeded"), adapters());

		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.reconcileAutomatedFulfillmentRefund",
			expect.objectContaining({
				stripeRefundId: "re_automated1234567890",
				stripeRefundStatus: "succeeded",
				automationTag: "fulfillment_recovery_v1",
			}),
		);
		expect(mockSendFulfillmentFailureAlert).toHaveBeenCalledOnce();
		expect(mockSendCustomerFulfillmentFailure).toHaveBeenCalledOnce();
		expect(mockSendAutomatedRefundFailureAlert).not.toHaveBeenCalled();
	});

	it.each([
		["failed", "refund.failed"],
		["canceled", "refund.updated"],
	] as const)("reconciles signed automated %s evidence to operator-only alerting", async (status, eventType) => {
		stripe.checkout.sessions.list.mockResolvedValue({
			data: [manualRefundSession({ metadata: { commerceTenantSiteUrl: "angelsrest.online" } })],
			has_more: false,
		});
		automatedRefundReconciliationResult = {
			kind: "refund_failed",
			orderId: "order-123",
			orderNumber: "ORD-001",
			customerEmail: "buyer@example.com",
			total: 1500,
			errorSummary: "Provider rejected fulfillment",
			stripeRefundId: "re_automated1234567890",
			refundStatus: status,
		};
		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(automatedRefundEvent(status, eventType), adapters());

		expect(mockSendAutomatedRefundFailureAlert).toHaveBeenCalledOnce();
		expect(mockSendFulfillmentFailureAlert).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.claimFulfillmentFailureNotificationV2",
			expect.objectContaining({ audience: "refund_failure" }),
		);
	});

	it("reconciles signed automated attention to one operator-only leased alert", async () => {
		stripe.checkout.sessions.list.mockResolvedValue({
			data: [manualRefundSession({ metadata: { commerceTenantSiteUrl: "angelsrest.online" } })],
			has_more: false,
		});
		automatedRefundReconciliationResult = {
			kind: "refund_attention",
			orderId: "order-123",
			orderNumber: "ORD-001",
			customerEmail: "buyer@example.com",
			total: 1500,
			errorSummary: "Provider rejected fulfillment",
			stripeRefundId: "re_automated1234567890",
			refundStatus: "requires_action",
			attentionReason: "age_exceeded",
		};
		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(automatedRefundEvent("requires_action"), adapters());

		expect(mockSendAutomatedRefundAttentionAlert).toHaveBeenCalledOnce();
		expect(mockSendAutomatedRefundFailureAlert).not.toHaveBeenCalled();
		expect(mockSendFulfillmentFailureAlert).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.claimFulfillmentFailureNotificationV3",
			expect.objectContaining({ audience: "refund_attention" }),
		);
	});

	it("acknowledges unsupported refund evidence without any downstream effect", async () => {
		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(manualRefundEvent({ amount: 0 }), adapters());
		expect(stripe.checkout.sessions.list).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalled();
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
	});

	it("retries provider lookup failures without sending the generic alert", async () => {
		stripe.checkout.sessions.list.mockRejectedValue(new Error("Stripe unavailable"));
		const { processStripeWebhookEvent } = await import("../orderIntake");
		await expect(processStripeWebhookEvent(manualRefundEvent(), adapters())).rejects.toThrow();
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalled();
	});

	it.each([
		"refund.failed",
		"charge.refunded",
	])("keeps %s as a no-write event", async (eventType) => {
		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(makeStripeEvent(eventType, {}), adapters());
		expect(stripe.checkout.sessions.list).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalled();
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
	});

	it("drives a print checkout through the real fulfillment orchestration interface", async () => {
		const session = makeCheckoutSession();
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(createLumaPrintsOrder).toHaveBeenCalledTimes(1);
		expect(mockSendCustomerConfirmation).toHaveBeenCalledTimes(1);
		expect(mockSendAdminNotification).toHaveBeenCalledTimes(1);
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.completePrintFulfillmentSubmission",
			expect.objectContaining({ lumaprintsOrderNumber: "123" }),
		);
	});

	it("checkpoints a definite provider rejection before the idempotent refund flow", async () => {
		const { LumaPrintsSubmissionError } = await import("../lumaprints");
		const session = makeCheckoutSession();
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		createLumaPrintsOrder.mockRejectedValueOnce(
			new LumaPrintsSubmissionError("Order submission failed", "definitely_rejected", {
				phase: "status",
				statusCode: 400,
			}),
		);

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		const rejectionCall = convex.mutation.mock.calls.find(
			([reference]: unknown[]) => reference === "orders.rejectPrintFulfillmentSubmission",
		);
		const pendingCall = convex.mutation.mock.calls.find(
			([reference]: [unknown]) => reference === "orders.claimAutomatedFulfillmentRefundV2",
		);
		if (!rejectionCall || !pendingCall)
			throw new Error("Expected rejection and refund checkpoints");
		expect(rejectionCall[1]).toEqual(
			expect.objectContaining({
				orderId: "order-123",
				externalId: session.id,
				claimToken: expect.any(String),
			}),
		);
		expect(
			convex.mutation.mock.invocationCallOrder[convex.mutation.mock.calls.indexOf(rejectionCall)],
		).toBeLessThan(
			convex.mutation.mock.invocationCallOrder[convex.mutation.mock.calls.indexOf(pendingCall)],
		);
		expect(stripe.refunds.create).toHaveBeenCalledWith(
			expect.objectContaining({ payment_intent: "pi_test_123" }),
			{ idempotencyKey: `fulfillment-refund:${session.id}` },
		);
		expect(convex.mutation).not.toHaveBeenCalledWith(
			"orders.completePrintFulfillmentSubmission",
			expect.anything(),
		);
		expect(mockSendCustomerFulfillmentFailure).toHaveBeenCalledOnce();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
	});

	it("claims one confirmation when an existing uncertain print order reconciles across retries", async () => {
		const session = makeCheckoutSession({ id: "cs_test_1234567890abcdef" });
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		orderCreateResults = [
			makeOrderResult({
				alreadyExisted: true,
				printFulfillmentClaim: true,
				printFulfillmentResolution: "submission_uncertain",
			}),
			makeOrderResult({
				alreadyExisted: true,
				lumaprintsOrderNumber: "456",
				printFulfillmentResolution: "resolved",
			}),
		];
		printClaimResults = [{ kind: "reconcile", externalId: session.id }];
		orderConfirmationClaimResults = [true, false];
		const body = JSON.stringify({
			orders: [{ externalId: session.id, orderNumber: "456", storeId: "123" }],
			totalOrders: 1,
			currentPage: 1,
			totalPages: 1,
		});
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(body, {
					headers: {
						"content-type": "application/json",
						"content-length": String(new TextEncoder().encode(body).byteLength),
					},
				}),
			),
		);

		const { processStripeWebhookEvent } = await import("../orderIntake");
		const event = makeStripeEvent("checkout.session.completed", session);
		await processStripeWebhookEvent(event, adapters());
		await processStripeWebhookEvent(event, adapters());

		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).toHaveBeenCalledOnce();
		expect(mockSendAdminNotification).toHaveBeenCalledOnce();
		expect(convex.mutation).toHaveBeenCalledWith("orders.claimOrderConfirmation", {
			orderId: "order-123",
			webhookSecret: "test-webhook-secret",
		});
		expect(
			convex.mutation.mock.calls.filter(
				([reference]: unknown[]) => reference === "orders.claimOrderConfirmation",
			),
		).toHaveLength(2);
		expect(stripe.refunds.create).not.toHaveBeenCalled();
	});

	it("sends one bounded operator alert when a deterministic reconciliation block is retried", async () => {
		const session = makeCheckoutSession({ id: "cs_test_1234567890abcdef" });
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		orderCreateResults = [
			makeOrderResult({
				alreadyExisted: true,
				printFulfillmentClaim: true,
				printFulfillmentResolution: "submission_uncertain",
			}),
			makeOrderResult({
				alreadyExisted: true,
				printFulfillmentClaim: true,
				printFulfillmentResolution: "reconciliation_blocked",
				printFulfillmentReconciliationClass: "response_contract",
			}),
		];
		printClaimResults = [
			{ kind: "reconcile", externalId: session.id },
			{ kind: "reconciliation_blocked", reconciliationClass: "response_contract" },
		];
		const body = JSON.stringify({ malformed: true });
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(body, {
				headers: {
					"content-type": "application/json",
					"content-length": String(new TextEncoder().encode(body).byteLength),
				},
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const { processStripeWebhookEvent } = await import("../orderIntake");
		const event = makeStripeEvent("checkout.session.completed", session);
		await processStripeWebhookEvent(event, adapters());
		await processStripeWebhookEvent(event, adapters());

		expect(mockSendPrintReconciliationBlockedAlert).toHaveBeenCalledOnce();
		expect(mockSendPrintReconciliationBlockedAlert).toHaveBeenCalledWith(resend, {
			orderNumber: "ORD-001",
			externalId: session.id,
			reconciliationClass: "response_contract",
			notificationProfile: {
				siteName: "Angel's Rest",
				siteUrl: "angelsrest.online",
				adminEmail: "admin@example.com",
			},
		});
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalledWith(
			"orders.releasePrintFulfillmentReconciliationAlert",
			expect.anything(),
		);
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.completePrintFulfillmentReconciliationAlert",
			expect.objectContaining({
				orderId: "order-123",
				externalId: session.id,
				claimToken: expect.any(String),
			}),
		);
	});

	it("releases a failed blocked-alert lease and retries without any commerce effect", async () => {
		const session = makeCheckoutSession({ id: "cs_test_alertretry12345678" });
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		orderCreateResults = [
			makeOrderResult({
				alreadyExisted: true,
				printFulfillmentClaim: true,
				printFulfillmentResolution: "reconciliation_blocked",
				printFulfillmentReconciliationClass: "response_contract",
			}),
			makeOrderResult({
				alreadyExisted: true,
				printFulfillmentClaim: true,
				printFulfillmentResolution: "reconciliation_blocked",
				printFulfillmentReconciliationClass: "response_contract",
			}),
		];
		printClaimResults = [
			{ kind: "reconciliation_blocked", reconciliationClass: "response_contract" },
			{ kind: "reconciliation_blocked", reconciliationClass: "response_contract" },
		];
		reconciliationAlertClaimResults = [{ kind: "claimed" }, { kind: "claimed" }];
		reconciliationAlertCompletionResults = [true];
		mockSendPrintReconciliationBlockedAlert
			.mockRejectedValueOnce(new Error("Resend unavailable"))
			.mockResolvedValueOnce(undefined);

		const { processStripeWebhookEvent } = await import("../orderIntake");
		const event = makeStripeEvent("checkout.session.completed", session);
		await expect(processStripeWebhookEvent(event, adapters())).rejects.toThrow();
		await expect(processStripeWebhookEvent(event, adapters())).resolves.toBeUndefined();

		expect(mockSendPrintReconciliationBlockedAlert).toHaveBeenCalledTimes(2);
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.releasePrintFulfillmentReconciliationAlert",
			expect.objectContaining({
				orderId: "order-123",
				externalId: session.id,
				claimToken: expect.any(String),
			}),
		);
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.completePrintFulfillmentReconciliationAlert",
			expect.objectContaining({
				orderId: "order-123",
				externalId: session.id,
				claimToken: expect.any(String),
			}),
		);
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
	});

	it("keeps the webhook retryable while another blocked-alert lease is active", async () => {
		const session = makeCheckoutSession({ id: "cs_test_alertbusy123456789" });
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		orderCreateResults = [
			makeOrderResult({
				alreadyExisted: true,
				printFulfillmentClaim: true,
				printFulfillmentResolution: "reconciliation_blocked",
				printFulfillmentReconciliationClass: "response_contract",
			}),
		];
		printClaimResults = [
			{ kind: "reconciliation_blocked", reconciliationClass: "response_contract" },
		];
		reconciliationAlertClaimResults = [{ kind: "busy", leaseExpiresAt: Date.now() + 60_000 }];

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await expect(
			processStripeWebhookEvent(makeStripeEvent("checkout.session.completed", session), adapters()),
		).rejects.toMatchObject({ status: 500 });

		expect(mockSendPrintReconciliationBlockedAlert).not.toHaveBeenCalled();
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalledWith(
			"orders.completePrintFulfillmentReconciliationAlert",
			expect.anything(),
		);
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
	});

	it("retains a sent alert lease when completion crashes and suppresses generic email", async () => {
		const session = makeCheckoutSession({ id: "cs_test_alertcomplete123456" });
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		orderCreateResults = [
			makeOrderResult({
				alreadyExisted: true,
				printFulfillmentClaim: true,
				printFulfillmentResolution: "reconciliation_blocked",
				printFulfillmentReconciliationClass: "response_contract",
			}),
		];
		printClaimResults = [
			{ kind: "reconciliation_blocked", reconciliationClass: "response_contract" },
		];
		reconciliationAlertClaimResults = [{ kind: "claimed" }];
		reconciliationAlertCompletionResults = [new Error("Convex unavailable")];

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await expect(
			processStripeWebhookEvent(makeStripeEvent("checkout.session.completed", session), adapters()),
		).rejects.toThrow();

		expect(mockSendPrintReconciliationBlockedAlert).toHaveBeenCalledOnce();
		expect(convex.mutation).not.toHaveBeenCalledWith(
			"orders.releasePrintFulfillmentReconciliationAlert",
			expect.anything(),
		);
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
	});

	it("suppresses all email and fulfillment effects when a concurrent manual refund wins", async () => {
		const session = makeCheckoutSession();
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		claimResultOverride = { kind: "manual_refunded", stripeRefundId: "re_manual_123" };

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
	});

	it("GET-reconciles a refunded uncertain replay without submission or notification", async () => {
		const session = makeCheckoutSession({ id: "cs_test_1234567890abcdef" });
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		orderCreateResults = [
			makeOrderResult({
				alreadyExisted: true,
				status: "refunded",
				stripeRefundId: "re_manual_123",
				printFulfillmentClaim: true,
				printFulfillmentPhase: undefined,
				printFulfillmentResolution: "submission_uncertain",
			}),
		];
		claimResultOverride = { kind: "reconcile", externalId: session.id };
		printCompletionResultOverride = {
			kind: "manual_refunded",
			stripeRefundId: "re_manual_123",
		};
		const body = JSON.stringify({
			orders: [{ externalId: session.id, orderNumber: "456", storeId: "123" }],
			totalOrders: 1,
			currentPage: 1,
			totalPages: 1,
		});
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(body, {
					headers: {
						"content-type": "application/json",
						"content-length": String(new TextEncoder().encode(body).byteLength),
					},
				}),
			),
		);

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.reconcilePrintFulfillmentSubmission",
			expect.objectContaining({ lumaprintsOrderNumber: "456" }),
		);
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
	});

	it("preserves automated recovery notification when it wins the claim race", async () => {
		const session = makeCheckoutSession();
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		claimResultOverride = { kind: "automated_refunded", stripeRefundId: "re_automated_123" };

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(mockSendCustomerFulfillmentFailure).toHaveBeenCalledOnce();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
	});

	it("suppresses effects when a stored early-refund intent makes the new order terminal", async () => {
		const session = makeCheckoutSession();
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		orderCreateResults = [
			makeOrderResult({
				alreadyExisted: true,
				status: "refunded",
				stripeRefundId: "re_early_123",
			}),
		];

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalledWith(
			"orders.claimPrintFulfillmentV3",
			expect.anything(),
		);
	});

	it("keeps refund truth and suppresses effects after a provider result is stored", async () => {
		const session = makeCheckoutSession();
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		orderCreateResults = [
			makeOrderResult({
				alreadyExisted: true,
				status: "refunded",
				stripeRefundId: "re_manual_123",
				lumaprintsOrderNumber: "789",
				printFulfillmentResolution: "resolved",
			}),
		];

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalledWith(
			"orders.claimPrintFulfillmentV3",
			expect.anything(),
		);
	});

	it("suppresses non-print success email when concurrent refund reconciliation wins", async () => {
		const session = makeCheckoutSession({ metadata: {} });
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [] },
		});
		nonPrintOutcomeOverride = { kind: "manual_refunded", stripeRefundId: "re_manual_123" };

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
	});

	it("does not suppress the first claimed non-print confirmation on an existing order", async () => {
		const session = makeCheckoutSession({ metadata: {} });
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [] },
		});
		orderCreateResults = [
			makeOrderResult({ alreadyExisted: true }),
			makeOrderResult({ alreadyExisted: true }),
		];
		nonPrintOutcomeOverride = { kind: "success" };

		const { processStripeWebhookEvent } = await import("../orderIntake");
		const event = makeStripeEvent("checkout.session.completed", session);
		await processStripeWebhookEvent(event, adapters());
		nonPrintOutcomeOverride = { kind: "none" };
		await processStripeWebhookEvent(event, adapters());

		expect(mockSendCustomerConfirmation).toHaveBeenCalledOnce();
		expect(mockSendAdminNotification).toHaveBeenCalledOnce();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalledWith(
			"orders.claimOrderConfirmation",
			expect.anything(),
		);
	});

	it("returns a no-print outcome without calling the LumaPrints adapter", async () => {
		const session = makeCheckoutSession({ metadata: {} });
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [] },
		});

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).toHaveBeenCalledTimes(1);
		expect(mockSendAdminNotification).toHaveBeenCalledTimes(1);
	});

	it("routes connected-account sessions to the matching tenant and Stripe account", async () => {
		const session = makeCheckoutSession();
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		convex.query.mockResolvedValue({
			siteUrl: "zippymiggy.com",
			name: "Reflecting Pool",
			email: "owner@example.com",
			adminEmails: ["maggie@example.com"],
		});

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session, { account: "acct_123" }),
			adapters(),
		);

		expect(convex.query).toHaveBeenCalledWith("platform.getByStripeConnectedAccountId", {
			stripeConnectedAccountId: "acct_123",
			webhookSecret: "test-webhook-secret",
		});
		expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith(
			"cs_test_123",
			{ expand: ["line_items", "customer_details"] },
			{ stripeAccount: "acct_123" },
		);
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.create",
			expect.objectContaining({
				siteUrl: "zippymiggy.com",
				stripeSessionId: "cs_test_123",
			}),
		);
		expect(mockSendCustomerConfirmation).toHaveBeenCalledWith(
			resend,
			expect.objectContaining({
				notificationProfile: {
					siteName: "Reflecting Pool",
					siteUrl: "zippymiggy.com",
					adminEmail: "maggie@example.com",
				},
			}),
		);
	});

	it("routes a platform-account tenant session to that tenant's notifications", async () => {
		const session = makeCheckoutSession({
			metadata: {
				...makeCheckoutSession().metadata,
				commerceTenantSiteUrl: "zippymiggy.com",
			},
		});
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		convex.query.mockResolvedValue({
			siteName: "Reflecting Pool",
			siteUrl: "zippymiggy.com",
			adminEmail: "maggie@example.com",
		});

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(convex.query).toHaveBeenCalledWith("platform.getCommerceProfileForSite", {
			siteUrl: "zippymiggy.com",
			webhookSecret: "test-webhook-secret",
		});
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.create",
			expect.objectContaining({ siteUrl: "zippymiggy.com" }),
		);
		expect(mockSendCustomerConfirmation).toHaveBeenCalledWith(
			resend,
			expect.objectContaining({
				notificationProfile: {
					siteName: "Reflecting Pool",
					siteUrl: "zippymiggy.com",
					adminEmail: "maggie@example.com",
				},
			}),
		);
		expect(mockSendAdminNotification).toHaveBeenCalledWith(
			resend,
			expect.objectContaining({
				notificationProfile: expect.objectContaining({
					adminEmail: "maggie@example.com",
				}),
			}),
		);
	});

	it("fails closed when a connected-account event has no registered tenant", async () => {
		const session = makeCheckoutSession();
		convex.query.mockResolvedValue(null);

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await expect(
			processStripeWebhookEvent(
				makeStripeEvent("checkout.session.completed", session, { account: "acct_unknown" }),
				adapters(),
			),
		).rejects.toMatchObject({ status: 500 });

		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalledWith("orders.create", expect.anything());
	});

	it.each([
		["marked platform subscription", { type: "platform_subscription", siteUrl: "client.example" }],
		["unmarked subscription", {}],
	])("ignores a %s Session before all commerce effects", async (_label, metadata) => {
		const session = makeCheckoutSession({ mode: "subscription", metadata });

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
		expect(stripe.checkout.sessions.listLineItems).not.toHaveBeenCalled();
		expect(convex.query).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalled();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
		expect(mockSendPaymentFailedEmail).not.toHaveBeenCalled();
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
	});

	it("routes invoice payment sessions to invoice settlement only", async () => {
		const session = makeCheckoutSession({
			metadata: {
				type: "invoice_payment",
				invoiceId: "invoice-123",
				siteUrl: "https://client.example",
				checkoutFingerprint: "checkout-fingerprint-123",
			},
		});

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(convex.mutation).toHaveBeenCalledWith("invoices.markPaid", {
			webhookSecret: "test-webhook-secret",
			invoiceId: "invoice-123",
			siteUrl: "https://client.example",
			stripeCheckoutSessionId: "cs_test_123",
			stripeCheckoutFingerprint: "checkout-fingerprint-123",
		});
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
	});

	it.each([
		undefined,
		"",
		"handle-v1",
		"HANDLE-V2",
	])("keeps current checkout behavior while checking retired sessions when mode is %s", async (mode) => {
		mockPrivateEnv.CHECKOUT_SNAPSHOT_MODE = mode;
		const session = makeCheckoutSession({ metadata: {} });
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [] },
		});
		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);
		expect(convex.query).toHaveBeenCalledWith("orders.resolveCheckoutRouting", {
			stripeSessionId: session.id,
			webhookSecret: "test-webhook-secret",
		});
		expect(stripe.checkout.sessions.listLineItems).not.toHaveBeenCalled();
	});

	it("consumes a marked handle and fulfills from its stored snapshot when webhook mode is absent", async () => {
		const session = makeCheckoutSession({
			metadata: {
				checkoutSnapshotVersion: "2",
				checkoutSnapshotHandle: snapshotHandle,
				commerceTenantSiteUrl: "angelsrest.online",
			},
		});
		const lineItems = [makeLineItem()];
		const checkoutSnapshot = {
			schemaVersion: 1 as const,
			catalogProvider: "sanity" as const,
			items: [
				{
					productKey: "sanity-product-id",
					revisionId: "sanity-revision-id",
					productKind: "print" as const,
					variantKey: null,
					materialOptionKey: "archival-matte",
					sizeOptionKey: "4x6",
					borderOptionKey: null,
					frameOptionKey: null,
				},
			],
		};
		stripe.checkout.sessions.retrieve.mockResolvedValue(session);
		stripe.checkout.sessions.listLineItems.mockResolvedValue({ data: lineItems, has_more: false });
		convex.query.mockResolvedValue({
			source: "reservation",
			siteUrl: "angelsrest.online",
			stripeConnectedAccountId: undefined,
		});
		orderCreateResults = [makeOrderResult({ checkoutSnapshot })];
		mockBuildOrderItemsFromSnapshot.mockResolvedValue([
			{
				imageUrl: "https://cdn.sanity.io/images/print.jpg",
				sourcePolicy: "sanity_cdn",
				quantity: 1,
				paperSubcategoryId: 103001,
				width: 4,
				height: 6,
			},
		]);

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(convex.query).toHaveBeenCalledWith("orders.resolveCheckoutRouting", {
			stripeSessionId: session.id,
			stripeTenantMetadataSiteUrl: "angelsrest.online",
			webhookSecret: "test-webhook-secret",
		});
		expect(stripe.checkout.sessions.listLineItems).toHaveBeenCalledWith(
			session.id,
			{ limit: 41 },
			undefined,
		);
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.create",
			expect.objectContaining({
				checkoutSnapshotReservation: { version: 2, handle: snapshotHandle },
				items: [
					{
						productName: lineItems[0].description,
						quantity: lineItems[0].quantity,
						price: lineItems[0].amount_total,
					},
				],
			}),
		);
		expect(mockBuildOrderItemsFromSnapshot).toHaveBeenCalledWith(
			checkoutSnapshot,
			session.id,
			lineItems,
		);
		expect(createLumaPrintsOrder).toHaveBeenCalledTimes(1);
		expect(mockBuildOrderItemsFromSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
			createLumaPrintsOrder.mock.invocationCallOrder[0],
		);
	});

	it("stops a retired snapshot checkout before line-item or downstream effects", async () => {
		const session = makeCheckoutSession({
			metadata: {
				checkoutSnapshotVersion: "2",
				checkoutSnapshotHandle: snapshotHandle,
				commerceTenantSiteUrl: "angelsrest.online",
			},
		});
		convex.query.mockResolvedValue({
			source: "retired",
			siteUrl: "angelsrest.online",
			stripeConnectedAccountId: undefined,
		});

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
		expect(stripe.checkout.sessions.listLineItems).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalled();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
	});

	it("stops an unmarked retired checkout before downstream effects", async () => {
		const session = makeCheckoutSession({ metadata: {} });
		convex.query.mockResolvedValue({
			source: "retired",
			siteUrl: "angelsrest.online",
			stripeConnectedAccountId: undefined,
		});

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
		expect(stripe.checkout.sessions.listLineItems).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalled();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
	});

	it.each([
		[
			"unknown handle",
			{
				checkoutSnapshotVersion: "2",
				checkoutSnapshotHandle: snapshotHandle,
				commerceTenantSiteUrl: "angelsrest.online",
			},
		],
		["malformed marker", { checkoutSnapshotVersion: "broken", checkoutSnapshotHandle: "bad" }],
	] as const)("fails closed for a %s when webhook mode is absent", async (_label, metadata) => {
		const session = makeCheckoutSession({ metadata });
		stripe.checkout.sessions.retrieve.mockResolvedValue(session);
		stripe.checkout.sessions.listLineItems.mockResolvedValue({
			data: [makeLineItem()],
			has_more: false,
		});
		convex.query.mockResolvedValue(null);

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await expect(
			processStripeWebhookEvent(makeStripeEvent("checkout.session.completed", session), adapters()),
		).rejects.toMatchObject({ status: 500 });

		expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
		expect(stripe.checkout.sessions.listLineItems).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalled();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
	});

	it.each([
		"retrieve",
		"line items",
	] as const)("keeps a marked first-delivery %s failure before notification effects", async (failurePoint) => {
		const session = makeCheckoutSession({
			metadata: {
				checkoutSnapshotVersion: "2",
				checkoutSnapshotHandle: snapshotHandle,
				commerceTenantSiteUrl: "angelsrest.online",
			},
		});
		convex.query.mockResolvedValue({
			source: "reservation",
			siteUrl: "angelsrest.online",
			stripeConnectedAccountId: undefined,
		});
		if (failurePoint === "retrieve") {
			stripe.checkout.sessions.retrieve.mockRejectedValue(new Error("Stripe unavailable"));
		} else {
			stripe.checkout.sessions.retrieve.mockResolvedValue(session);
			stripe.checkout.sessions.listLineItems.mockRejectedValue(new Error("Stripe unavailable"));
		}

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await expect(
			processStripeWebhookEvent(makeStripeEvent("checkout.session.completed", session), adapters()),
		).rejects.toMatchObject({ status: 500 });

		expect(convex.mutation).not.toHaveBeenCalled();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
	});

	it.each([
		["unmarked mode-enabled", "retrieve"],
		["unmarked mode-enabled", "line items"],
		["marked existing-order", "retrieve"],
		["marked existing-order", "line items"],
	] as const)("preserves the failure alert for a %s %s failure", async (source, failurePoint) => {
		const existingOrder = source === "marked existing-order";
		mockPrivateEnv.CHECKOUT_SNAPSHOT_MODE = existingOrder ? undefined : "handle-v2";
		const session = makeCheckoutSession({
			metadata: existingOrder
				? {
						checkoutSnapshotVersion: "2",
						checkoutSnapshotHandle: snapshotHandle,
						commerceTenantSiteUrl: "angelsrest.online",
					}
				: {},
		});
		convex.query.mockResolvedValue(
			existingOrder
				? {
						source: "order",
						siteUrl: "angelsrest.online",
						stripeConnectedAccountId: undefined,
					}
				: null,
		);
		if (failurePoint === "retrieve") {
			stripe.checkout.sessions.retrieve.mockRejectedValue(new Error("Stripe unavailable"));
		} else {
			stripe.checkout.sessions.retrieve.mockResolvedValue(session);
			stripe.checkout.sessions.listLineItems.mockRejectedValue(new Error("Stripe unavailable"));
		}

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await expect(
			processStripeWebhookEvent(makeStripeEvent("checkout.session.completed", session), adapters()),
		).rejects.toMatchObject({ status: 500 });

		expect(convex.mutation).not.toHaveBeenCalled();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
		expect(mockSendFailureAlert).toHaveBeenCalledTimes(1);
	});

	it("preserves the tenant failure alert for a marked existing order when mode is absent", async () => {
		const session = makeCheckoutSession({
			metadata: {
				checkoutSnapshotVersion: "2",
				checkoutSnapshotHandle: snapshotHandle,
				commerceTenantSiteUrl: "zippymiggy.com",
			},
		});
		convex.query
			.mockResolvedValueOnce({
				source: "order",
				siteUrl: "zippymiggy.com",
				stripeConnectedAccountId: undefined,
			})
			.mockRejectedValueOnce(new Error("Tenant profile unavailable"));

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await expect(
			processStripeWebhookEvent(makeStripeEvent("checkout.session.completed", session), adapters()),
		).rejects.toMatchObject({ status: 500 });

		expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalled();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(mockSendFailureAlert).toHaveBeenCalledTimes(1);
	});

	it("keeps mode-enabled unmarked routing failures on the historical protocol alert policy", async () => {
		mockPrivateEnv.CHECKOUT_SNAPSHOT_MODE = "handle-v2";
		const session = makeCheckoutSession({ metadata: {} });
		convex.query.mockRejectedValue(new Error("Checkout routing unavailable"));

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await expect(
			processStripeWebhookEvent(makeStripeEvent("checkout.session.completed", session), adapters()),
		).rejects.toMatchObject({ status: 500 });

		expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalled();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
	});

	it.each([
		["removed", {}],
		["malformed", { checkoutSnapshotVersion: "broken", checkoutSnapshotHandle: "bad" }],
	] as const)("resumes an existing order with %s snapshot metadata", async (_label, metadata) => {
		mockPrivateEnv.CHECKOUT_SNAPSHOT_MODE = "handle-v2";
		const session = makeCheckoutSession({ metadata });
		stripe.checkout.sessions.retrieve.mockResolvedValue(session);
		stripe.checkout.sessions.listLineItems.mockResolvedValue({
			data: [makeLineItem()],
			has_more: false,
		});
		convex.query.mockResolvedValue({
			source: "order",
			siteUrl: "angelsrest.online",
			stripeConnectedAccountId: undefined,
		});
		orderCreateResults = [
			makeOrderResult({
				alreadyExisted: true,
				lumaprintsOrderNumber: "790",
				checkoutSnapshot: {
					schemaVersion: 1,
					catalogProvider: "convex",
					items: [],
				},
			}),
		];
		orderConfirmationClaimResults = [false];

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		const calls = convex.mutation.mock.calls as Array<[string, Record<string, unknown>]>;
		const payload = calls.find(([reference]) => reference === "orders.create")?.[1];
		expect(payload).not.toHaveProperty("checkoutSnapshot");
		expect(payload).not.toHaveProperty("checkoutSnapshotReservation");
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(mockBuildOrderItemsFromSnapshot).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
	});

	it("transfers a bound handle on first delivery with complete connected-account line items", async () => {
		mockPrivateEnv.CHECKOUT_SNAPSHOT_MODE = "handle-v2";
		const account = "acct_1234567890TenantA";
		const session = makeCheckoutSession({
			metadata: handleMetadata({ commerceTenantSiteUrl: "zippymiggy.com" }),
		});
		const lineItems = Array.from({ length: 40 }, (_, ordinal) => makeLineItem(ordinal));
		stripe.checkout.sessions.retrieve.mockResolvedValue(session);
		stripe.checkout.sessions.listLineItems.mockResolvedValue({
			data: lineItems,
			has_more: false,
		});
		convex.query
			.mockResolvedValueOnce({
				source: "reservation",
				siteUrl: "zippymiggy.com",
				stripeConnectedAccountId: account,
			})
			.mockResolvedValueOnce({
				siteName: "Reflecting Pool",
				siteUrl: "zippymiggy.com",
				adminEmail: "owner@example.com",
			});

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session, { account }),
			adapters(),
		);

		expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith(
			session.id,
			{ expand: ["customer_details"] },
			{ stripeAccount: account },
		);
		expect(stripe.checkout.sessions.listLineItems).toHaveBeenCalledWith(
			session.id,
			{ limit: 41 },
			{ stripeAccount: account },
		);
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.create",
			expect.objectContaining({
				stripeConnectedAccountId: account,
				checkoutSnapshotReservation: { version: 2, handle: snapshotHandle },
				items: lineItems.map((item) => ({
					productName: item.description,
					quantity: item.quantity,
					price: item.amount_total,
				})),
			}),
		);
	});

	it("rejects the 41st line-item sentinel before every order or terminal effect", async () => {
		mockPrivateEnv.CHECKOUT_SNAPSHOT_MODE = "handle-v2";
		const session = makeCheckoutSession({ metadata: handleMetadata() });
		stripe.checkout.sessions.retrieve.mockResolvedValue(session);
		stripe.checkout.sessions.listLineItems.mockResolvedValue({
			data: Array.from({ length: 41 }, (_, ordinal) => makeLineItem(ordinal)),
			has_more: false,
		});
		convex.query.mockResolvedValue({
			source: "reservation",
			siteUrl: "angelsrest.online",
			stripeConnectedAccountId: undefined,
		});

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await expect(
			processStripeWebhookEvent(makeStripeEvent("checkout.session.completed", session), adapters()),
		).rejects.toMatchObject({ status: 500 });

		expect(convex.mutation).not.toHaveBeenCalledWith("orders.create", expect.anything());
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
	});

	it.each([
		["account", { account: " acct_1234567890TenantB " }, handleMetadata()],
		["tenant", {}, handleMetadata({ commerceTenantSiteUrl: "other.example" })],
	] as const)("fails a %s routing mismatch before side effects", async (_label, eventOverrides, metadata) => {
		mockPrivateEnv.CHECKOUT_SNAPSHOT_MODE = "handle-v2";
		const session = makeCheckoutSession({ metadata });
		convex.query.mockRejectedValue(new Error("Checkout routing facts conflict"));
		const { processStripeWebhookEvent } = await import("../orderIntake");
		await expect(
			processStripeWebhookEvent(
				makeStripeEvent("checkout.session.completed", session, eventOverrides),
				adapters(),
			),
		).rejects.toMatchObject({ status: 500 });
		if (_label === "account") {
			expect(convex.query).toHaveBeenCalledWith(
				"orders.resolveCheckoutRouting",
				expect.objectContaining({ stripeConnectedAccountId: "acct_1234567890TenantB" }),
			);
		}
		expect(convex.mutation).not.toHaveBeenCalled();
		expect(stripe.checkout.sessions.listLineItems).not.toHaveBeenCalled();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
	});

	it("fails routing and marked count mismatches without provider, refund, or notification", async () => {
		mockPrivateEnv.CHECKOUT_SNAPSHOT_MODE = "handle-v2";
		const session = makeCheckoutSession({
			metadata: {
				checkoutSnapshotVersion: "1",
				catalogProvider: "convex",
				checkoutSnapshotItemCount: "2",
				checkoutSnapshotItem_0: JSON.stringify([
					0,
					"p",
					"r",
					"print",
					null,
					null,
					null,
					null,
					null,
				]),
				checkoutSnapshotItem_1: JSON.stringify([
					1,
					"p2",
					"r2",
					"print",
					null,
					null,
					null,
					null,
					null,
				]),
			},
		});
		stripe.checkout.sessions.retrieve.mockResolvedValue(session);
		stripe.checkout.sessions.listLineItems.mockResolvedValue({
			data: [makeLineItem()],
			has_more: false,
		});
		convex.query.mockResolvedValue(null);
		const { processStripeWebhookEvent } = await import("../orderIntake");
		await expect(
			processStripeWebhookEvent(makeStripeEvent("checkout.session.completed", session), adapters()),
		).rejects.toMatchObject({ status: 500 });
		expect(convex.mutation).not.toHaveBeenCalledWith("orders.create", expect.anything());
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
	});

	it.each([
		undefined,
		"handle-v2",
	])("keeps invoice settlement on the historical bypass when mode is %s", async (mode) => {
		mockPrivateEnv.CHECKOUT_SNAPSHOT_MODE = mode;
		const session = makeCheckoutSession({
			metadata: {
				type: "invoice_payment",
				checkoutSnapshotVersion: "broken",
				invoiceId: "invoice-123",
				siteUrl: "angelsrest.online",
			},
		});
		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);
		expect(convex.query).not.toHaveBeenCalledWith(
			"orders.resolveCheckoutRouting",
			expect.anything(),
		);
		expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
		expect(stripe.checkout.sessions.listLineItems).not.toHaveBeenCalled();
		expect(convex.mutation).toHaveBeenCalledTimes(1);
		expect(convex.mutation).toHaveBeenCalledWith(
			"invoices.markPaid",
			expect.objectContaining({ invoiceId: "invoice-123" }),
		);
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
	});

	it("keeps provider unavailability after order creation retryable", async () => {
		const session = makeCheckoutSession();
		orderCreateResults = [makeOrderResult({ alreadyExisted: true })];
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		createLumaPrintsOrder.mockRejectedValue(new TypeError("network unavailable"));

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await expect(
			processStripeWebhookEvent(makeStripeEvent("checkout.session.completed", session), adapters()),
		).rejects.toMatchObject({ status: 500 });

		expect(mockSendFailureAlert).toHaveBeenCalledTimes(1);
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
	});

	it("sends refund copy instead of normal confirmation after a permanent failure", async () => {
		const session = makeCheckoutSession();
		const shippingDetails = session.collected_information?.shipping_details;
		if (!shippingDetails) throw new Error("Missing shipping fixture");
		shippingDetails.name = "";
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(mockSendCustomerFulfillmentFailure).toHaveBeenCalledWith(resend, {
			customerEmail: "jane@example.com",
			orderNumber: "ORD-001",
			stripeRefundId: "re_test_123",
			total: 3500,
			notificationProfile: {
				siteName: "Angel's Rest",
				siteUrl: "angelsrest.online",
				adminEmail: "admin@example.com",
			},
		});
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
		expect(mockSendFulfillmentFailureAlert).toHaveBeenCalledTimes(1);
	});

	it("resumes pending recovery with the same refund idempotency key and skips LumaPrints", async () => {
		const session = makeCheckoutSession();
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		orderCreateResults = [
			makeOrderResult({
				alreadyExisted: true,
				status: "fulfillment_error",
				fulfillmentError: "Invalid image",
				fulfillmentRecoveryStatus: "refund_pending",
			}),
		];

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).toHaveBeenCalledWith(
			{
				payment_intent: "pi_test_123",
				reason: "requested_by_customer",
				metadata: {
					orderNumber: "ORD-001",
					fulfillmentError: "Invalid image",
					automated: "fulfillment_recovery_v1",
				},
			},
			{ idempotencyKey: "fulfillment-refund:cs_test_123" },
		);
		expect(mockSendCustomerFulfillmentFailure).toHaveBeenCalledTimes(1);
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
	});

	it("does not recreate a refund after its terminal checkpoint fails", async () => {
		const session = makeCheckoutSession();
		const shippingDetails = session.collected_information?.shipping_details;
		if (!shippingDetails) throw new Error("Missing shipping fixture");
		shippingDetails.name = "";
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		orderCreateResults = [
			makeOrderResult(),
			makeOrderResult({
				alreadyExisted: true,
				status: "fulfillment_error",
				fulfillmentError: "Fulfillment validation rejected",
				fulfillmentRecoveryStatus: "refund_pending",
			}),
		];
		automatedRefundClaimResults = [
			{ kind: "claimed", leaseExpiresAt: Date.now() + 60_000 },
			{ kind: "unavailable" },
		];
		automatedRefundRequestUncertainResults = [true];
		automatedRefundCompletionResults = [new Error("terminal write unavailable")];
		const { processStripeWebhookEvent } = await import("../orderIntake");
		await expect(
			processStripeWebhookEvent(makeStripeEvent("checkout.session.completed", session), adapters()),
		).rejects.toMatchObject({ status: 500 });
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
		expect(stripe.refunds.create.mock.calls[0]).toEqual([
			{
				payment_intent: "pi_test_123",
				reason: "requested_by_customer",
				metadata: {
					orderNumber: "ORD-001",
					fulfillmentError: "Fulfillment validation rejected",
					automated: "fulfillment_recovery_v1",
				},
			},
			{ idempotencyKey: "fulfillment-refund:cs_test_123" },
		]);
		expect(mockSendAutomatedRefundAttentionAlert).toHaveBeenCalledTimes(1);
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
	});

	it("does not duplicate side effects for an already terminal refunded failure", async () => {
		const session = makeCheckoutSession();
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		orderCreateResults = [
			makeOrderResult({
				alreadyExisted: true,
				status: "fulfillment_error",
				fulfillmentError: "Invalid image",
				stripeRefundId: "re_test_123",
				fulfillmentRecoveryStatus: "refunded",
			}),
		];
		fulfillmentFailureNotificationClaimResults = [{ kind: "unavailable" }, { kind: "unavailable" }];

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendFulfillmentFailureAlert).not.toHaveBeenCalled();
	});

	it("sends payment failure email for a marked Your-account commerce PaymentIntent", async () => {
		const paymentIntent = {
			id: "pi_test_123",
			receipt_email: "jane@example.com",
			last_payment_error: { message: "card declined" },
			metadata: { commerceTenantSiteUrl: "angelsrest.online" },
		} as unknown as Stripe.PaymentIntent;

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("payment_intent.payment_failed", paymentIntent),
			adapters(),
		);

		expect(convex.mutation).toHaveBeenCalledWith("orders.claimPaymentFailureEmail", {
			stripeEventId: "evt_test12345678",
			webhookSecret: "test-webhook-secret",
		});
		expect(mockSendPaymentFailedEmail).toHaveBeenCalledWith(resend, {
			customerEmail: "jane@example.com",
			errorMessage: "card declined",
			notificationProfile: {
				siteName: "Angel's Rest",
				siteUrl: "angelsrest.online",
				adminEmail: "admin@example.com",
			},
		});
	});

	it.each([
		"sequential",
		"concurrent",
	] as const)("claims a repeated payment-failure email once for %s delivery", async (delivery) => {
		paymentFailureClaimResults = [true, false];
		const paymentIntent = {
			id: "pi_repeated",
			receipt_email: "jane@example.com",
			last_payment_error: { message: "card declined" },
			metadata: { commerceTenantSiteUrl: "angelsrest.online" },
		} as unknown as Stripe.PaymentIntent;
		const event = makeStripeEvent("payment_intent.payment_failed", paymentIntent, {
			id: "evt_repeated123456",
		});
		const { processStripeWebhookEvent } = await import("../orderIntake");

		if (delivery === "concurrent") {
			await Promise.all([
				processStripeWebhookEvent(event, adapters()),
				processStripeWebhookEvent(event, adapters()),
			]);
		} else {
			await processStripeWebhookEvent(event, adapters());
			await processStripeWebhookEvent(event, adapters());
		}

		expect(convex.mutation).toHaveBeenCalledTimes(2);
		expect(mockSendPaymentFailedEmail).toHaveBeenCalledOnce();
		expect(mockLogStructured).toHaveBeenCalledWith({
			event: "email.payment_failed.duplicate_ignored",
			stage: "email_customer",
			meta: {
				stripeEventId: "evt_repeated123456",
				paymentIntentId: "pi_repeated",
				accountScope: "platform",
			},
		});
	});

	it("does not reattempt an email after a claimed send failure", async () => {
		paymentFailureClaimResults = [true, false];
		mockSendPaymentFailedEmail.mockRejectedValueOnce(new Error("Resend unavailable"));
		const paymentIntent = {
			id: "pi_send_failed",
			receipt_email: "jane@example.com",
			last_payment_error: { message: "card declined" },
			metadata: { commerceTenantSiteUrl: "angelsrest.online" },
		} as unknown as Stripe.PaymentIntent;
		const event = makeStripeEvent("payment_intent.payment_failed", paymentIntent, {
			id: "evt_sendfailed123456",
		});
		const { processStripeWebhookEvent } = await import("../orderIntake");

		await processStripeWebhookEvent(event, adapters());
		await processStripeWebhookEvent(event, adapters());

		expect(mockSendPaymentFailedEmail).toHaveBeenCalledOnce();
		expect(mockLogStructured).toHaveBeenCalledWith(
			expect.objectContaining({ event: "email.payment_failed.send_failed" }),
		);
		expect(mockLogStructured).toHaveBeenCalledWith(
			expect.objectContaining({ event: "email.payment_failed.duplicate_ignored" }),
		);
	});

	it("retries a failed durable claim without sending an email or generic alert", async () => {
		paymentFailureClaimResults = [];
		const paymentIntent = {
			id: "pi_claim_unavailable",
			receipt_email: "jane@example.com",
			last_payment_error: { message: "card declined" },
			metadata: { commerceTenantSiteUrl: "angelsrest.online" },
		} as unknown as Stripe.PaymentIntent;
		const event = makeStripeEvent("payment_intent.payment_failed", paymentIntent);
		const { processStripeWebhookEvent } = await import("../orderIntake");

		await expect(processStripeWebhookEvent(event, adapters())).rejects.toMatchObject({
			status: 500,
		});
		paymentFailureClaimResults = [true];
		await processStripeWebhookEvent(event, adapters());

		expect(convex.mutation).toHaveBeenCalledTimes(2);
		expect(mockSendPaymentFailedEmail).toHaveBeenCalledOnce();
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
		expect(mockLogStructured).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "email.payment_failed.claim_failed",
				stage: "email_customer",
			}),
		);
	});

	it("ignores an unmarked platform-account PaymentIntent failure", async () => {
		const paymentIntent = {
			id: "pi_platform_subscription",
			receipt_email: "owner@example.com",
			last_payment_error: { message: "card declined" },
			metadata: {},
		} as unknown as Stripe.PaymentIntent;

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("payment_intent.payment_failed", paymentIntent),
			adapters(),
		);

		expect(convex.query).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalled();
		expect(mockSendPaymentFailedEmail).not.toHaveBeenCalled();
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
	});

	it("sends a connected-account payment failure with the resolved tenant profile", async () => {
		const paymentIntent = {
			id: "pi_connected",
			receipt_email: "buyer@example.com",
			last_payment_error: { message: "card declined" },
			metadata: { commerceTenantSiteUrl: "zippymiggy.com" },
		} as unknown as Stripe.PaymentIntent;
		convex.query.mockResolvedValue({
			siteUrl: "zippymiggy.com",
			name: "Reflecting Pool",
			adminEmails: ["maggie@example.com"],
		});

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("payment_intent.payment_failed", paymentIntent, {
				account: "acct_connected",
			}),
			adapters(),
		);

		expect(convex.query).toHaveBeenCalledWith("platform.getByStripeConnectedAccountId", {
			stripeConnectedAccountId: "acct_connected",
			webhookSecret: "test-webhook-secret",
		});
		expect(convex.mutation).toHaveBeenCalledWith("orders.claimPaymentFailureEmail", {
			stripeConnectedAccountId: "acct_connected",
			stripeEventId: "evt_test12345678",
			webhookSecret: "test-webhook-secret",
		});
		expect(mockSendPaymentFailedEmail).toHaveBeenCalledWith(resend, {
			customerEmail: "buyer@example.com",
			errorMessage: "card declined",
			notificationProfile: {
				siteName: "Reflecting Pool",
				siteUrl: "zippymiggy.com",
				adminEmail: "maggie@example.com",
			},
		});
	});

	it("ignores an unmarked connected-account PaymentIntent failure", async () => {
		const paymentIntent = {
			id: "pi_unmarked_connected",
			receipt_email: "buyer@example.com",
			last_payment_error: { message: "card declined" },
			metadata: {},
		} as unknown as Stripe.PaymentIntent;

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("payment_intent.payment_failed", paymentIntent, {
				account: "acct_connected",
			}),
			adapters(),
		);

		expect(convex.query).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalled();
		expect(mockSendPaymentFailedEmail).not.toHaveBeenCalled();
		expect(mockSendFailureAlert).not.toHaveBeenCalled();
	});

	describe("handle-v2 uncertain submission incident", () => {
		it("replays only GET after a manual refund, from pending through a late provider result", async () => {
			mockPrivateEnv.CHECKOUT_SNAPSHOT_MODE = "handle-v2";
			const session = makeCheckoutSession({
				id: "cs_test_1234567890abcdef",
				payment_intent: "pi_1234567890abcdef",
				metadata: handleMetadata(),
			});
			const lineItems = [makeLineItem()];
			const checkoutSnapshot = {
				schemaVersion: 1 as const,
				catalogProvider: "sanity" as const,
				items: [
					{
						productKey: "sanity-product-id",
						revisionId: "sanity-revision-id",
						productKind: "print" as const,
						variantKey: "variant",
						materialOptionKey: "paper",
						sizeOptionKey: "size",
						borderOptionKey: null,
						frameOptionKey: null,
					},
				],
			};
			const refundedUncertainOrder = () =>
				makeOrderResult({
					alreadyExisted: true,
					status: "refunded",
					stripeRefundId: "re_1234567890abcdef",
					printFulfillmentClaim: true,
					printFulfillmentPhase: "submitting",
					printFulfillmentResolution: "submission_uncertain",
					checkoutSnapshot,
				});
			orderCreateResults = [
				makeOrderResult({ checkoutSnapshot }),
				refundedUncertainOrder(),
				refundedUncertainOrder(),
			];
			printClaimResults = [
				{ kind: "claimed", externalId: session.id },
				{ kind: "reconcile", externalId: session.id },
				{ kind: "reconcile", externalId: session.id },
			];
			printCompletionResultOverride = {
				kind: "manual_refunded",
				stripeRefundId: "re_1234567890abcdef",
			};
			convex.query
				.mockResolvedValueOnce({
					source: "reservation",
					siteUrl: "angelsrest.online",
					stripeConnectedAccountId: undefined,
				})
				.mockResolvedValueOnce({
					source: "order",
					siteUrl: "angelsrest.online",
					stripeConnectedAccountId: undefined,
				})
				.mockResolvedValueOnce({
					source: "order",
					siteUrl: "angelsrest.online",
					stripeConnectedAccountId: undefined,
				});
			stripe.checkout.sessions.retrieve.mockResolvedValue(session);
			stripe.checkout.sessions.listLineItems.mockResolvedValue({
				data: lineItems,
				has_more: false,
			});
			stripe.checkout.sessions.list.mockResolvedValue({
				data: [
					manualRefundSession({
						id: session.id,
						amount_total: session.amount_total,
						payment_intent: session.payment_intent,
					}),
				],
				has_more: false,
			});
			mockBuildOrderItemsFromSnapshot.mockResolvedValue([
				{
					imageUrl: "https://cdn.sanity.io/images/print.jpg",
					sourcePolicy: "sanity_cdn",
					quantity: 1,
					paperSubcategoryId: 103001,
					width: 8,
					height: 10,
				},
			]);
			createLumaPrintsOrder.mockRejectedValueOnce(
				new TypeError("connection closed after request upload"),
			);
			const reconciliationResponse = (body: Record<string, unknown>) => {
				const json = JSON.stringify(body);
				return new Response(json, {
					headers: {
						"content-type": "application/json",
						"content-length": String(new TextEncoder().encode(json).byteLength),
					},
				});
			};
			const fetchMock = vi
				.fn()
				.mockResolvedValueOnce(
					reconciliationResponse({
						orders: [],
						totalOrders: 0,
						currentPage: 1,
						totalPages: 0,
					}),
				)
				.mockResolvedValueOnce(
					reconciliationResponse({
						orders: [{ externalId: session.id, orderNumber: "456", storeId: "123" }],
						totalOrders: 1,
						currentPage: 1,
						totalPages: 1,
					}),
				);
			vi.stubGlobal("fetch", fetchMock);

			const { processStripeWebhookEvent } = await import("../orderIntake");
			const checkoutEvent = makeStripeEvent("checkout.session.completed", session);
			await expect(processStripeWebhookEvent(checkoutEvent, adapters())).rejects.toMatchObject({
				status: 500,
			});
			await processStripeWebhookEvent(
				manualRefundEvent({ amount: session.amount_total, payment_intent: session.payment_intent }),
				adapters(),
			);
			await expect(processStripeWebhookEvent(checkoutEvent, adapters())).rejects.toMatchObject({
				status: 500,
			});
			await processStripeWebhookEvent(checkoutEvent, adapters());

			const createCalls = convex.mutation.mock.calls.filter(
				([reference]: unknown[]) => reference === "orders.create",
			) as Array<[string, Record<string, unknown>]>;
			expect(createCalls).toHaveLength(3);
			expect(createCalls[0]?.[1]).toMatchObject({
				checkoutSnapshotReservation: { version: 2, handle: snapshotHandle },
			});
			expect(createCalls[1]?.[1]).not.toHaveProperty("checkoutSnapshotReservation");
			expect(createCalls[2]?.[1]).not.toHaveProperty("checkoutSnapshotReservation");
			expect(convex.mutation).toHaveBeenCalledWith(
				"orders.reconcileSucceededManualRefund",
				expect.objectContaining({
					stripeRefundId: "re_1234567890abcdef",
					stripeSessionId: session.id,
				}),
			);
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(createLumaPrintsOrder).toHaveBeenCalledOnce();
			expect(mockBuildOrderItemsFromSnapshot).toHaveBeenCalledOnce();
			expect(convex.mutation).toHaveBeenCalledWith(
				"orders.reconcilePrintFulfillmentSubmission",
				expect.objectContaining({ lumaprintsOrderNumber: "456" }),
			);
			expect(stripe.refunds.create).not.toHaveBeenCalled();
			expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
			expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
			expect(mockSendAdminNotification).not.toHaveBeenCalled();
		});
	});
});
