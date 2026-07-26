import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "$convex/dataModel";

const mockLogStructured = vi.fn();
const mockCreateLumaPrintsOrder = vi.fn();
const mockBuildLumaPrintsOrder = vi.fn();
const mockBuildOrderItemsFromSession = vi.fn();
const mockBuildOrderItemsFromSnapshot = vi.fn();
const mockBuildRecipientFromShipping = vi.fn();
const mockSendFulfillmentFailureAlert = vi.fn();
const mockFindLumaPrintsOrder = vi.fn();

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
		findOrderByExternalId: mockFindLumaPrintsOrder,
	};
});

vi.mock("$lib/server/webhookDecoder", () => ({
	buildOrderItemsFromSession: mockBuildOrderItemsFromSession,
	buildRecipientFromShipping: mockBuildRecipientFromShipping,
}));
vi.mock("$lib/server/snapshotFulfillment", () => ({
	buildOrderItemsFromSnapshot: mockBuildOrderItemsFromSnapshot,
}));

vi.mock("$lib/server/webhookEmails", () => ({
	sendFulfillmentFailureAlert: mockSendFulfillmentFailureAlert,
}));

vi.mock("$convex/api", () => ({
	api: {
		orders: {
			claimPrintFulfillment: "orders.claimPrintFulfillment",
			updatePrintFulfillment: "orders.updatePrintFulfillment",
			updateStatus: "orders.updateStatus",
		},
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
	const printInput = {
		orderId,
		orderNumber: "ORD-001",
		lineItems: [],
		shippingDetails: shippingDetails as never,
		session,
	};
	async function handle(
		error: unknown,
		overrides: {
			session?: Stripe.Checkout.Session;
			stripeRequestOptions?: Stripe.RequestOptions;
		} = {},
	) {
		const { handlePrintFulfillmentFailure } = await import("../printFulfillment");
		return handlePrintFulfillmentFailure(
			{ stripe, convex, resend },
			{
				orderId,
				orderNumber: "ORD-001",
				error,
				session,
				customerEmail: "jane@example.com",
				...overrides,
			},
		);
	}

	beforeEach(() => {
		vi.clearAllMocks();
		convex.mutation.mockReset();
		convex.mutation.mockImplementation(async (reference: string, args: { update?: string }) => {
			if (reference === "orders.claimPrintFulfillment")
				return { kind: "claimed", externalId: session.id };
			if (reference === "orders.updatePrintFulfillment") return { kind: args.update };
		});
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
		mockBuildLumaPrintsOrder.mockImplementation((externalId: string) => ({ externalId }));
		mockCreateLumaPrintsOrder.mockResolvedValue({ orderNumber: "LP-123" });
		mockFindLumaPrintsOrder.mockResolvedValue(null);
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
		expect(mockBuildLumaPrintsOrder).toHaveBeenCalledWith(
			session.id,
			expect.anything(),
			expect.anything(),
		);
		expect(mockBuildLumaPrintsOrder.mock.invocationCallOrder[0]).toBeLessThan(
			convex.mutation.mock.invocationCallOrder[0],
		);
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.updateStatus",
			expect.objectContaining({ orderId, lumaprintsOrderNumber: "LP-123" }),
		);
	});

	it("finishes snapshot preparation before claiming and retries preparation failures", async () => {
		const { submitPrintFulfillment } = await import("../printFulfillment");
		const checkoutSnapshot = {
			schemaVersion: 1 as const,
			catalogProvider: "convex" as const,
			items: [
				{
					productKey: "product",
					revisionId: "revision",
					productKind: "print" as const,
					variantKey: "variant",
					materialOptionKey: "paper",
					sizeOptionKey: "size",
					borderOptionKey: null,
					frameOptionKey: null,
				},
			],
		};
		const input = {
			...printInput,
			lineItems: [{ quantity: 3 }] as Stripe.LineItem[],
			checkoutSnapshot,
		};
		mockBuildOrderItemsFromSnapshot
			.mockRejectedValueOnce(new Error("capability unavailable"))
			.mockResolvedValueOnce([
				{
					imageUrl: "https://opaque.example/capability",
					sourcePolicy: "opaque_capability",
					paperSubcategoryId: 103001,
					quantity: 3,
					width: 8,
					height: 10,
				},
			]);
		await expect(
			submitPrintFulfillment({ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder }, input),
		).rejects.toThrow("capability unavailable");
		expect(convex.mutation).not.toHaveBeenCalled();
		await submitPrintFulfillment(
			{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
			input,
		);
		expect(mockBuildOrderItemsFromSnapshot).toHaveBeenLastCalledWith(checkoutSnapshot, session.id, [
			expect.objectContaining({ quantity: 3 }),
		]);
		expect(mockBuildLumaPrintsOrder.mock.invocationCallOrder[0]).toBeLessThan(
			convex.mutation.mock.invocationCallOrder[0],
		);
		expect(mockBuildOrderItemsFromSession).not.toHaveBeenCalled();
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

	it("reconciles an ambiguous POST and never submits it twice", async () => {
		const { submitPrintFulfillment } = await import("../printFulfillment");
		let claimed = false;
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference !== "orders.claimPrintFulfillment") return;
			if (claimed) return { kind: "reconcile", externalId: session.id };
			claimed = true;
			return { kind: "claimed", externalId: session.id };
		});
		const submit = () =>
			submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				printInput,
			);
		mockCreateLumaPrintsOrder.mockRejectedValueOnce(new Error("unknown response"));
		await expect(submit()).rejects.toThrow("submission outcome is unknown");
		mockFindLumaPrintsOrder.mockResolvedValueOnce({ orderNumber: "LP-123" });
		await expect(submit()).resolves.toMatchObject({ kind: "fulfilled" });
		expect(mockCreateLumaPrintsOrder).toHaveBeenCalledOnce();
		expect(mockFindLumaPrintsOrder).toHaveBeenCalledWith(session.id);
	});

	it("rethrows transient fulfillment failures so Stripe retries", async () => {
		await expect(handle(new Error("network dropped"))).rejects.toThrow(
			"Print provider temporarily unavailable",
		);
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalled();
	});

	it("checkpoints, refunds, stores terminal recovery, and returns the terminal outcome", async () => {
		const { LumaPrintsError } = await import("$lib/server/lumaprints");

		const outcome = await handle(
			new LumaPrintsError("Order submission failed", {
				statusCode: 422,
				message: "Invalid image",
			}),
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

		await handle(new FulfillmentValidationError("invalid dimensions"), {
			stripeRequestOptions: { stripeAccount: "acct_123" },
		});

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
		convex.mutation.mockRejectedValueOnce(new Error("convex unavailable"));

		await expect(handle(new FulfillmentValidationError("invalid dimensions"))).rejects.toThrow(
			"convex unavailable",
		);

		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendFulfillmentFailureAlert).not.toHaveBeenCalled();
	});

	it("throws after a durable checkpoint when Stripe refund creation fails", async () => {
		const { FulfillmentValidationError } = await import("../fulfillmentValidationError");
		stripe.refunds.create.mockRejectedValueOnce(new Error("Stripe unavailable"));

		await expect(handle(new FulfillmentValidationError("invalid dimensions"))).rejects.toThrow(
			"Stripe unavailable",
		);

		expect(convex.mutation).toHaveBeenCalledTimes(1);
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.updateStatus",
			expect.objectContaining({
				fulfillmentRecoveryStatus: "refund_pending",
			}),
		);
		expect(mockSendFulfillmentFailureAlert).not.toHaveBeenCalled();
	});
});
