import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "$convex/dataModel";

const mockLogStructured = vi.fn();
const mockCreateLumaPrintsOrder = vi.fn();
const mockBuildLumaPrintsOrder = vi.fn();
const mockBuildOrderItemsFromSession = vi.fn();
const mockBuildRecipientFromShipping = vi.fn();
const mockSendFulfillmentFailureAlert = vi.fn();

vi.mock("$lib/server/logger", () => ({
	logStructured: mockLogStructured,
	timed: async (_meta: unknown, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("$lib/server/lumaprints", () => {
	class LumaPrintsError extends Error {
		details: unknown;

		constructor(message: string, details?: unknown) {
			super(message);
			this.name = "LumaPrintsError";
			this.details = details;
		}
	}

	return {
		LumaPrintsError,
		buildLumaPrintsOrder: mockBuildLumaPrintsOrder,
		createOrder: mockCreateLumaPrintsOrder,
	};
});

vi.mock("$lib/server/webhookDecoder", () => ({
	buildOrderItemsFromSession: mockBuildOrderItemsFromSession,
	buildRecipientFromShipping: mockBuildRecipientFromShipping,
}));

vi.mock("$lib/server/webhookEmails", () => ({
	sendFulfillmentFailureAlert: mockSendFulfillmentFailureAlert,
}));

vi.mock("$convex/api", () => ({
	api: {
		orders: { updateStatus: "orders.updateStatus" },
	},
}));

vi.mock("$env/dynamic/private", () => ({
	env: {
		WEBHOOK_SECRET: "test-webhook-secret",
	},
}));

describe("print fulfillment", () => {
	const convex = {
		mutation: vi.fn(),
	} as any;
	const stripe = {
		refunds: {
			create: vi.fn(),
		},
	} as any;
	const resend = {} as any;
	const orderId = "order-123" as Id<"orders">;
	const session = {
		id: "cs_test_123",
		amount_total: 3500,
		payment_intent: "pi_test_123",
	} as Stripe.Checkout.Session;
	const shippingDetails = {
		name: "Jane Doe",
		address: {
			line1: "123 Main St",
			city: "Portland",
			state: "OR",
			postal_code: "97201",
			country: "US",
		},
	};

	beforeEach(() => {
		vi.clearAllMocks();
		convex.mutation.mockReset();
		stripe.refunds.create.mockResolvedValue({
			id: "re_test_123",
			status: "succeeded",
		});
		mockBuildOrderItemsFromSession.mockReturnValue([
			{
				imageUrl: "https://cdn.example/image.jpg",
				subcategoryId: 103001,
				quantity: 1,
				width: 8,
				height: 10,
			},
		]);
		mockBuildRecipientFromShipping.mockReturnValue({
			firstName: "Jane",
			lastName: "Doe",
		});
		mockBuildLumaPrintsOrder.mockReturnValue({ externalId: "ORD-001" });
		mockCreateLumaPrintsOrder.mockResolvedValue({ orderNumber: "LP-123" });
		mockSendFulfillmentFailureAlert.mockResolvedValue({ id: "email-123" });
	});

	it("submits print orders and returns a fulfilled outcome", async () => {
		const { submitPrintFulfillment } = await import("../printFulfillment");

		const outcome = await submitPrintFulfillment(
			{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
			{
				orderId,
				orderNumber: "ORD-001",
				lineItems: [],
				shippingDetails: shippingDetails as any,
				session,
			},
		);

		expect(outcome).toEqual({ kind: "fulfilled", lumaprintsOrderNumber: "LP-123" });
		expect(mockCreateLumaPrintsOrder).toHaveBeenCalledWith({ externalId: "ORD-001" });
		expect(convex.mutation).toHaveBeenCalledWith("orders.updateStatus", {
			webhookSecret: "test-webhook-secret",
			orderId,
			lumaprintsOrderNumber: "LP-123",
		});
	});

	it("returns no_print_items without validating a recipient or calling LumaPrints", async () => {
		const { submitPrintFulfillment } = await import("../printFulfillment");
		mockBuildOrderItemsFromSession.mockReturnValue([]);

		const outcome = await submitPrintFulfillment(
			{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
			{
				orderId,
				orderNumber: "ORD-001",
				lineItems: [],
				shippingDetails: null,
				session,
			},
		);

		expect(outcome).toEqual({ kind: "no_print_items" });
		expect(mockBuildRecipientFromShipping).not.toHaveBeenCalled();
		expect(mockCreateLumaPrintsOrder).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalled();
	});

	it("rethrows transient fulfillment failures so Stripe retries", async () => {
		const { handlePrintFulfillmentFailure } = await import("../printFulfillment");
		const error = new Error("network dropped");

		await expect(
			handlePrintFulfillmentFailure(
				{ stripe, convex, resend },
				{
					orderId,
					orderNumber: "ORD-001",
					error,
					session,
					customerEmail: "jane@example.com",
				},
			),
		).rejects.toBe(error);
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalled();
	});

	it("checkpoints, refunds, stores terminal recovery, and returns the terminal outcome", async () => {
		const { LumaPrintsError } = await import("$lib/server/lumaprints");
		const { handlePrintFulfillmentFailure } = await import("../printFulfillment");

		const outcome = await handlePrintFulfillmentFailure(
			{ stripe, convex, resend },
			{
				orderId,
				orderNumber: "ORD-001",
				error: new LumaPrintsError("Order submission failed", {
					statusCode: 422,
					message: "Invalid image",
				}),
				session,
				customerEmail: "jane@example.com",
			},
		);

		expect(outcome).toEqual(
			expect.objectContaining({
				kind: "permanent_failure_refunded",
				stripeRefundId: "re_test_123",
			}),
		);
		expect(convex.mutation).toHaveBeenNthCalledWith(
			1,
			"orders.updateStatus",
			expect.objectContaining({
				orderId,
				status: "fulfillment_error",
				fulfillmentRecoveryStatus: "refund_pending",
			}),
		);
		expect(stripe.refunds.create).toHaveBeenCalledWith(
			expect.objectContaining({
				payment_intent: "pi_test_123",
				reason: "requested_by_customer",
			}),
			{ idempotencyKey: "fulfillment-refund:cs_test_123" },
		);
		expect(convex.mutation).toHaveBeenNthCalledWith(
			2,
			"orders.updateStatus",
			expect.objectContaining({
				orderId,
				status: "fulfillment_error",
				stripeRefundId: "re_test_123",
				fulfillmentRecoveryStatus: "refunded",
			}),
		);
		expect(mockSendFulfillmentFailureAlert).toHaveBeenCalledWith(
			resend,
			expect.objectContaining({
				orderNumber: "ORD-001",
				customerEmail: "jane@example.com",
				stripeRefundId: "re_test_123",
			}),
		);
	});

	it("adds connected-account routing to the deterministic refund request", async () => {
		const { FulfillmentValidationError } = await import("../fulfillmentValidationError");
		const { handlePrintFulfillmentFailure } = await import("../printFulfillment");

		await handlePrintFulfillmentFailure(
			{ stripe, convex, resend },
			{
				orderId,
				orderNumber: "ORD-001",
				error: new FulfillmentValidationError("invalid dimensions"),
				session,
				stripeRequestOptions: { stripeAccount: "acct_123" },
				customerEmail: "jane@example.com",
			},
		);

		expect(stripe.refunds.create).toHaveBeenCalledWith(
			expect.objectContaining({
				payment_intent: "pi_test_123",
				refund_application_fee: true,
			}),
			{
				stripeAccount: "acct_123",
				idempotencyKey: "fulfillment-refund:cs_test_123",
			},
		);
	});

	it("does not call Stripe when the pending checkpoint cannot be stored", async () => {
		const { FulfillmentValidationError } = await import("../fulfillmentValidationError");
		const { handlePrintFulfillmentFailure } = await import("../printFulfillment");
		convex.mutation.mockRejectedValueOnce(new Error("convex unavailable"));

		await expect(
			handlePrintFulfillmentFailure(
				{ stripe, convex, resend },
				{
					orderId,
					orderNumber: "ORD-001",
					error: new FulfillmentValidationError("invalid dimensions"),
					session,
					customerEmail: "jane@example.com",
				},
			),
		).rejects.toThrow("convex unavailable");

		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendFulfillmentFailureAlert).not.toHaveBeenCalled();
	});

	it("throws after a durable checkpoint when Stripe refund creation fails", async () => {
		const { FulfillmentValidationError } = await import("../fulfillmentValidationError");
		const { handlePrintFulfillmentFailure } = await import("../printFulfillment");
		stripe.refunds.create.mockRejectedValueOnce(new Error("Stripe unavailable"));

		await expect(
			handlePrintFulfillmentFailure(
				{ stripe, convex, resend },
				{
					orderId,
					orderNumber: "ORD-001",
					error: new FulfillmentValidationError("invalid dimensions"),
					session,
					customerEmail: "jane@example.com",
				},
			),
		).rejects.toThrow("Stripe unavailable");

		expect(convex.mutation).toHaveBeenCalledTimes(1);
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.updateStatus",
			expect.objectContaining({
				fulfillmentRecoveryStatus: "refund_pending",
			}),
		);
		expect(mockSendFulfillmentFailureAlert).not.toHaveBeenCalled();
	});

	it("keeps a missing payment intent retryable after recording pending recovery", async () => {
		const { FulfillmentValidationError } = await import("../fulfillmentValidationError");
		const { handlePrintFulfillmentFailure } = await import("../printFulfillment");
		const sessionWithoutPaymentIntent = { ...session, payment_intent: null };

		await expect(
			handlePrintFulfillmentFailure(
				{ stripe, convex, resend },
				{
					orderId,
					orderNumber: "ORD-001",
					error: new FulfillmentValidationError("invalid dimensions"),
					session: sessionWithoutPaymentIntent,
					customerEmail: "jane@example.com",
				},
			),
		).rejects.toThrow("no payment_intent");

		expect(convex.mutation).toHaveBeenCalledTimes(1);
		expect(stripe.refunds.create).not.toHaveBeenCalled();
	});
});
