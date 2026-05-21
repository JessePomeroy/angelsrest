import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

	it("submits print orders to LumaPrints and records the fulfillment order number", async () => {
		const { submitPrintFulfillment } = await import("../printFulfillment");

		await submitPrintFulfillment(
			{ convex },
			{
				orderId: "order-123",
				orderNumber: "ORD-001",
				lineItems: [],
				shippingDetails: shippingDetails as any,
				session,
			},
		);

		expect(mockBuildLumaPrintsOrder).toHaveBeenCalledWith(
			"ORD-001",
			expect.objectContaining({ firstName: "Jane" }),
			expect.arrayContaining([
				expect.objectContaining({ imageUrl: "https://cdn.example/image.jpg" }),
			]),
		);
		expect(mockCreateLumaPrintsOrder).toHaveBeenCalledWith({ externalId: "ORD-001" });
		expect(convex.mutation).toHaveBeenCalledWith("orders.updateStatus", {
			webhookSecret: "test-webhook-secret",
			orderId: "order-123",
			lumaprintsOrderNumber: "LP-123",
		});
	});

	it("rethrows transient fulfillment failures so Stripe retries", async () => {
		const { handlePrintFulfillmentFailure } = await import("../printFulfillment");
		const error = new Error("network dropped");

		await expect(
			handlePrintFulfillmentFailure(
				{ stripe, convex, resend },
				{
					orderId: "order-123",
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

	it("refunds, marks fulfillment_error, and alerts admin for permanent failures", async () => {
		const { LumaPrintsError } = await import("$lib/server/lumaprints");
		const { handlePrintFulfillmentFailure } = await import("../printFulfillment");

		await handlePrintFulfillmentFailure(
			{ stripe, convex, resend },
			{
				orderId: "order-123",
				orderNumber: "ORD-001",
				error: new LumaPrintsError("Order submission failed", {
					statusCode: 422,
					message: "Invalid image",
				}),
				session,
				customerEmail: "jane@example.com",
			},
		);

		expect(stripe.refunds.create).toHaveBeenCalledWith(
			expect.objectContaining({
				payment_intent: "pi_test_123",
				reason: "requested_by_customer",
			}),
			undefined,
		);
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.updateStatus",
			expect.objectContaining({
				webhookSecret: "test-webhook-secret",
				orderId: "order-123",
				status: "fulfillment_error",
				stripeRefundId: "re_test_123",
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

	it("refunds connected-account fulfillment failures with application fee refund enabled", async () => {
		const { LumaPrintsError } = await import("$lib/server/lumaprints");
		const { handlePrintFulfillmentFailure } = await import("../printFulfillment");

		await handlePrintFulfillmentFailure(
			{ stripe, convex, resend },
			{
				orderId: "order-123",
				orderNumber: "ORD-001",
				error: new LumaPrintsError("Order submission failed", {
					statusCode: 422,
					message: "Invalid image",
				}),
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
			{ stripeAccount: "acct_123" },
		);
	});
});
