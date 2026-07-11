import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "$convex/dataModel";

const mockLogStructured = vi.fn();
const mockSendAdminNotification = vi.fn();
const mockSendCustomerConfirmation = vi.fn();
const mockSendCustomerFulfillmentFailure = vi.fn();
const mockSendFailureAlert = vi.fn();
const mockSendFulfillmentFailureAlert = vi.fn();
const mockSendPaymentFailedEmail = vi.fn();

vi.mock("$lib/server/logger", () => ({
	logStructured: mockLogStructured,
	timed: async (_meta: unknown, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("$lib/server/webhookEmails", () => ({
	sendAdminNotification: mockSendAdminNotification,
	sendCustomerConfirmation: mockSendCustomerConfirmation,
	sendCustomerFulfillmentFailure: mockSendCustomerFulfillmentFailure,
	sendFailureAlert: mockSendFailureAlert,
	sendFulfillmentFailureAlert: mockSendFulfillmentFailureAlert,
	sendPaymentFailedEmail: mockSendPaymentFailedEmail,
}));

vi.mock("$convex/api", () => ({
	api: {
		invoices: { markPaid: "invoices.markPaid" },
		orders: {
			create: "orders.create",
			updateStatus: "orders.updateStatus",
		},
		platform: {
			getByStripeConnectedAccountId: "platform.getByStripeConnectedAccountId",
			getCommerceProfileForSite: "platform.getCommerceProfileForSite",
		},
	},
}));

vi.mock("$env/dynamic/private", () => ({
	env: {
		LUMAPRINTS_STORE_ID: "123",
		WEBHOOK_SECRET: "test-webhook-secret",
	},
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
		id: "evt_test_123",
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
		payment_intent: "pi_test_123",
		payment_status: "paid",
		...overrides,
	} as unknown as Stripe.Checkout.Session;
}

function makeLineItem(): Stripe.LineItem {
	return {
		id: "li_test_123",
		amount_total: 3500,
		description: "Spring Meadow print",
		quantity: 1,
	} as Stripe.LineItem;
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
		...overrides,
	};
}

describe("processStripeWebhookEvent", () => {
	let orderCreateResults: Array<ReturnType<typeof makeOrderResult>>;
	let updateStatusResults: Array<undefined | Error>;
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
			},
		},
		refunds: {
			create: vi.fn(),
		},
	} as any;

	beforeEach(() => {
		vi.clearAllMocks();
		orderCreateResults = [makeOrderResult()];
		updateStatusResults = [];
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.create") {
				const result = orderCreateResults.shift();
				if (!result) throw new Error("Missing configured orders.create result");
				return result;
			}
			if (reference === "orders.updateStatus") {
				const result = updateStatusResults.shift();
				if (result instanceof Error) throw result;
				return undefined;
			}
			return undefined;
		});
		convex.query.mockReset();
		stripe.checkout.sessions.retrieve.mockReset();
		stripe.refunds.create.mockResolvedValue({ id: "re_test_123", status: "succeeded" });
		createLumaPrintsOrder.mockResolvedValue({ orderNumber: "LP-123" });
	});

	function adapters() {
		return { stripe, resend, convex, createLumaPrintsOrder };
	}

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
			"orders.updateStatus",
			expect.objectContaining({
				lumaprintsOrderNumber: "LP-123",
			}),
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

	it("keeps transient LumaPrints failures retryable and sends no order confirmation", async () => {
		const session = makeCheckoutSession();
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
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		const { LumaPrintsError } = await import("../lumaprints");
		createLumaPrintsOrder.mockRejectedValue(
			new LumaPrintsError("Order rejected", {
				statusCode: 422,
				message: "Invalid image",
			}),
		);

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
			expect.objectContaining({ payment_intent: "pi_test_123" }),
			{ idempotencyKey: "fulfillment-refund:cs_test_123" },
		);
		expect(mockSendCustomerFulfillmentFailure).toHaveBeenCalledTimes(1);
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
	});

	it("recovers a post-refund state-write failure without a second fulfillment submission", async () => {
		const session = makeCheckoutSession();
		stripe.checkout.sessions.retrieve.mockResolvedValue({
			...session,
			line_items: { data: [makeLineItem()] },
		});
		orderCreateResults = [
			makeOrderResult(),
			makeOrderResult({
				alreadyExisted: true,
				status: "fulfillment_error",
				fulfillmentError: "Invalid image",
				fulfillmentRecoveryStatus: "refund_pending",
			}),
		];
		updateStatusResults = [
			undefined,
			new Error("terminal write unavailable"),
			undefined,
			undefined,
		];
		const { LumaPrintsError } = await import("../lumaprints");
		createLumaPrintsOrder.mockRejectedValueOnce(
			new LumaPrintsError("Order rejected", {
				statusCode: 422,
				message: "Invalid image",
			}),
		);

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await expect(
			processStripeWebhookEvent(makeStripeEvent("checkout.session.completed", session), adapters()),
		).rejects.toMatchObject({ status: 500 });
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(createLumaPrintsOrder).toHaveBeenCalledTimes(1);
		expect(stripe.refunds.create).toHaveBeenCalledTimes(2);
		expect(stripe.refunds.create.mock.calls[0][1]).toEqual(stripe.refunds.create.mock.calls[1][1]);
		expect(mockSendCustomerFulfillmentFailure).toHaveBeenCalledTimes(1);
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

	it("sends payment failure email when Stripe provides a receipt email", async () => {
		const paymentIntent = {
			id: "pi_test_123",
			receipt_email: "jane@example.com",
			last_payment_error: { message: "card declined" },
		} as Stripe.PaymentIntent;

		const { processStripeWebhookEvent } = await import("../orderIntake");
		await processStripeWebhookEvent(
			makeStripeEvent("payment_intent.payment_failed", paymentIntent),
			adapters(),
		);

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
});
