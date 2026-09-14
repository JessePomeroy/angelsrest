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
const mockSendCustomerFulfillmentFailure = vi.fn();
const mockSendAutomatedRefundAttentionAlert = vi.fn();
const mockSendAutomatedRefundFailureAlert = vi.fn();
const mockFindLumaPrintsOrder = vi.fn();
const mockConfirmLumaPrintsOrder = vi.fn();
const mockPreparePrintSources = vi.fn();

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
	class LumaPrintsReconciliationError extends LumaPrintsError {
		constructor(
			message: string,
			readonly disposition: "retryable" | "blocked",
			readonly reconciliationClass?:
				| "provider_rejected"
				| "response_contract"
				| "ambiguous_result"
				| "client_error",
		) {
			super(message);
			this.name = "LumaPrintsReconciliationError";
		}
	}
	class LumaPrintsSubmissionError extends LumaPrintsError {
		constructor(
			message: string,
			readonly disposition: "definitely_rejected" | "uncertain",
			details?: unknown,
		) {
			super(message, details);
			this.name = "LumaPrintsSubmissionError";
		}
	}
	return {
		LumaPrintsError,
		LumaPrintsReconciliationError,
		LumaPrintsSubmissionError,
		buildLumaPrintsOrder: mockBuildLumaPrintsOrder,
		confirmOrder: mockConfirmLumaPrintsOrder,
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
vi.mock("$lib/server/printSourcePreparation", () => ({
	preparePrintSources: mockPreparePrintSources,
}));

vi.mock("$lib/server/webhookEmails", () => ({
	sendAutomatedRefundAttentionAlert: mockSendAutomatedRefundAttentionAlert,
	sendAutomatedRefundFailureAlert: mockSendAutomatedRefundFailureAlert,
	sendCustomerFulfillmentFailure: mockSendCustomerFulfillmentFailure,
	sendFulfillmentFailureAlert: mockSendFulfillmentFailureAlert,
}));

vi.mock("$convex/api", () => ({
	api: {
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
			isPrintFulfillmentReconciliationAlertDeliveryUncertain:
				"orders.isPrintFulfillmentReconciliationAlertDeliveryUncertain",
			claimNonPrintOrderOutcome: "orders.claimNonPrintOrderOutcome",
			claimPrintFulfillmentV3: "orders.claimPrintFulfillmentV3",
			claimPrintFulfillmentV4: "orders.claimPrintFulfillmentV4",
			claimPrintFulfillmentV5: "orders.claimPrintFulfillmentV5",
			claimPrintFulfillmentReconciliationAlert: "orders.claimPrintFulfillmentReconciliationAlert",
			completeFulfillmentFailureNotificationV2: "orders.completeFulfillmentFailureNotificationV2",
			recordAutomatedFulfillmentRefund: "orders.recordAutomatedFulfillmentRefund",
			recordPrintFulfillmentReconciliationPending:
				"orders.recordPrintFulfillmentReconciliationPending",
			completePrintFulfillmentSubmission: "orders.completePrintFulfillmentSubmission",
			recordPrintFulfillmentSubmissionReceipt: "orders.recordPrintFulfillmentSubmissionReceipt",
			reconcilePrintFulfillmentSubmission: "orders.reconcilePrintFulfillmentSubmission",
			rejectPrintFulfillmentSubmission: "orders.rejectPrintFulfillmentSubmission",
			releasePrintFulfillmentClaim: "orders.releasePrintFulfillmentClaim",
			releaseAutomatedFulfillmentRefund: "orders.releaseAutomatedFulfillmentRefund",
			markAutomatedFulfillmentRefundRequestUncertain:
				"orders.markAutomatedFulfillmentRefundRequestUncertain",
			isAutomatedFulfillmentRefundRequestUncertain:
				"orders.isAutomatedFulfillmentRefundRequestUncertain",
			releaseFulfillmentFailureNotificationV2: "orders.releaseFulfillmentFailureNotificationV2",
			updatePrintFulfillment: "orders.updatePrintFulfillment",
			updateStatus: "orders.updateStatus",
		},
	},
}));

vi.mock("$env/dynamic/private", () => ({
	env: {
		LUMAPRINTS_API_KEY: "test-key",
		LUMAPRINTS_API_SECRET: "test-secret",
		LUMAPRINTS_STORE_ID: "123",
		LUMAPRINTS_USE_SANDBOX: "false",
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
			retrieve: vi.fn(),
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
		siteUrl: "angelsrest.online",
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
		mockCreateLumaPrintsOrder.mockReset();
		mockConfirmLumaPrintsOrder.mockReset();
		mockFindLumaPrintsOrder.mockReset();
		convex.mutation.mockReset();
		convex.mutation.mockImplementation(async (reference: string, args: { update?: string }) => {
			if (reference === "orders.claimNonPrintOrderOutcome") return { kind: "success" };
			if (reference === "orders.claimPrintFulfillmentV5")
				return { kind: "claimed", externalId: session.id };
			if (reference === "orders.beginPrintFulfillmentSubmission") {
				return { kind: "submitting", externalId: session.id };
			}
			if (reference === "orders.releasePrintFulfillmentClaim") return true;
			if (reference === "orders.blockPrintFulfillmentReconciliation") return true;
			if (reference === "orders.claimPrintFulfillmentReconciliationAlert") {
				return { kind: "claimed" };
			}
			if (reference === "orders.recordPrintFulfillmentReconciliationPending") {
				return { kind: "pending", attempts: 1 };
			}
			if (reference === "orders.recordPrintFulfillmentSubmissionReceipt") {
				return { kind: "recorded" };
			}
			if (reference === "orders.claimAutomatedFulfillmentRefundV2") {
				return { kind: "claimed", leaseExpiresAt: Date.now() + 60_000 };
			}
			if (reference === "orders.recordAutomatedFulfillmentRefund") {
				return { kind: "succeeded", stripeRefundId: "re_test_123" };
			}
			if (reference === "orders.releaseAutomatedFulfillmentRefund") return true;
			if (reference === "orders.markAutomatedFulfillmentRefundRequestUncertain") return true;
			if (reference === "orders.isAutomatedFulfillmentRefundRequestUncertain") return false;
			if (
				reference === "orders.claimFulfillmentFailureNotificationV2" ||
				reference === "orders.claimFulfillmentFailureNotificationV3"
			)
				return { kind: "claimed" };
			if (reference === "orders.authorizeFulfillmentFailureNotificationSendV2") return true;
			if (reference === "orders.isFulfillmentFailureNotificationDeliveryUncertain") return false;
			if (reference === "orders.isPrintFulfillmentReconciliationAlertDeliveryUncertain") {
				return false;
			}
			if (reference === "orders.releaseFulfillmentFailureNotificationV2") return true;
			if (reference === "orders.completeFulfillmentFailureNotificationV2") return true;
			if (reference === "orders.rejectPrintFulfillmentSubmission") {
				return { kind: "refund_pending" };
			}
			if (
				reference === "orders.completePrintFulfillmentSubmission" ||
				reference === "orders.reconcilePrintFulfillmentSubmission"
			)
				return { kind: "fulfilled" };
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
			address1: "123 Main St",
			address2: "",
			city: "Portland",
			state: "OR",
			zip: "97201",
			country: "US",
			phone: "",
		});
		mockPreparePrintSources.mockImplementation(async (items) => items);
		mockBuildLumaPrintsOrder.mockImplementation((externalId: string) => ({ externalId }));
		mockCreateLumaPrintsOrder.mockResolvedValue({ orderNumber: "123" });
		mockConfirmLumaPrintsOrder.mockResolvedValue(true);
		mockFindLumaPrintsOrder.mockResolvedValue(null);
		mockSendFulfillmentFailureAlert.mockResolvedValue({ id: "email-123" });
	});

	it("completes a studio-handled print without claiming or calling the provider", async () => {
		const { submitPrintFulfillment } = await import("../printFulfillment");
		await expect(
			submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				{ ...printInput, fulfillmentType: "self" },
			),
		).resolves.toEqual({ kind: "no_print_items" });
		expect(convex.mutation).toHaveBeenCalledWith("orders.claimNonPrintOrderOutcome", {
			orderId,
			webhookSecret: "test-webhook-secret",
		});
		expect(mockCreateLumaPrintsOrder).not.toHaveBeenCalled();
	});

	it("returns an explicit retryable closure before resolver, worker, POST, refund, or email effects", async () => {
		const { ProviderSubmissionClosedRetryableError, submitPrintFulfillment } = await import(
			"../printFulfillment"
		);
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.claimPrintFulfillmentV5") {
				return { kind: "submission_closed" };
			}
		});
		await expect(
			submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				{
					...printInput,
					checkoutSnapshot: {
						schemaVersion: 1,
						catalogProvider: "convex",
						items: [
							{
								productKey: "product",
								revisionId: "revision",
								productKind: "print",
								variantKey: "variant",
								materialOptionKey: "paper",
								sizeOptionKey: "size",
								borderOptionKey: null,
								frameOptionKey: null,
							},
						],
					},
				},
			),
		).rejects.toBeInstanceOf(ProviderSubmissionClosedRetryableError);
		expect(mockBuildOrderItemsFromSnapshot).not.toHaveBeenCalled();
		expect(mockPreparePrintSources).not.toHaveBeenCalled();
		expect(mockCreateLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendFulfillmentFailureAlert).not.toHaveBeenCalled();
	});

	it("prepares print sources inside the trusted tenant before submission", async () => {
		const { buildLumaPrintsOrder } =
			await vi.importActual<typeof import("../lumaprints")>("../lumaprints");
		const { submitPrintFulfillment } = await import("../printFulfillment");
		const cases = [
			{ id: "cs_test_tenantAglobal1234", orderId: "order-a" as Id<"orders"> },
			{ id: "cs_test_tenantBglobal1234", orderId: "order-b" as Id<"orders"> },
		];
		const sessions = cases.map(({ id }) => id);
		convex.mutation.mockImplementation(
			async (reference: string, args: { orderId: Id<"orders"> }) => {
				const externalId = cases.find(({ orderId }) => orderId === args.orderId)?.id;
				if (reference === "orders.claimPrintFulfillmentV5") {
					return { kind: "claimed", externalId };
				}
				if (reference === "orders.beginPrintFulfillmentSubmission") {
					return { kind: "submitting", externalId };
				}
				if (reference === "orders.recordPrintFulfillmentSubmissionReceipt") {
					return { kind: "recorded" };
				}
				if (reference === "orders.reconcilePrintFulfillmentSubmission") {
					return { kind: "fulfilled" };
				}
				if (reference === "orders.releasePrintFulfillmentClaim") return true;
			},
		);
		mockBuildLumaPrintsOrder.mockImplementation(buildLumaPrintsOrder);
		mockBuildOrderItemsFromSession.mockImplementation(() => [
			{
				imageUrl: "https://opaque.example/source?private=1",
				sourcePolicy: "opaque_capability",
				paperSubcategoryId: 103001,
				quantity: 2,
				width: 8,
				height: 10,
				borderWidth: 0.25,
			},
		]);
		mockPreparePrintSources.mockImplementation(async (items, { siteUrl }) =>
			items.map((item: object, index: number) => ({
				...item,
				imageUrl: `https://worker.example/prepared/${siteUrl}/${index}.jpg`,
				sourcePolicy: "opaque_capability",
			})),
		);
		for (const { id, orderId } of cases)
			await submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				{ ...printInput, orderId, session: { ...session, id } },
			);
		const expected = (id: string) => ({
			externalId: id,
			storeId: 123,
			shippingMethod: "default",
			productionTime: "regular",
			recipient: {
				firstName: "Jane",
				lastName: "Doe",
				addressLine1: "123 Main St",
				addressLine2: "",
				city: "Portland",
				state: "OR",
				zipCode: "97201",
				country: "US",
				phone: "",
			},
			orderItems: [
				{
					externalItemId: `${id}-item-1`,
					subcategoryId: 103001,
					quantity: 2,
					width: 8,
					height: 10,
					file: { imageUrl: "https://worker.example/prepared/angelsrest.online/0.jpg" },
					orderItemOptions: [39],
				},
			],
		});
		expect(mockPreparePrintSources).toHaveBeenCalledTimes(2);
		expect(mockPreparePrintSources.mock.calls.map(([, options]) => options)).toEqual(
			sessions.map(() => ({ siteUrl: "angelsrest.online" })),
		);
		expect(mockCreateLumaPrintsOrder.mock.calls.map(([payload]) => payload)).toEqual(
			sessions.map(expected),
		);
		expect(mockConfirmLumaPrintsOrder.mock.calls).toEqual(sessions.map((id) => ["123", id]));
		expect(JSON.stringify(mockLogStructured.mock.calls)).not.toMatch(
			/opaque\.example|worker\.example/,
		);
	});

	it("claims before snapshot preparation and releases the claim when preparation fails", async () => {
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
		expect(convex.mutation).toHaveBeenNthCalledWith(1, "orders.claimPrintFulfillmentV5", {
			orderId,
			claimToken: expect.any(String),
			webhookSecret: "test-webhook-secret",
		});
		expect(convex.mutation).toHaveBeenNthCalledWith(2, "orders.releasePrintFulfillmentClaim", {
			orderId,
			claimToken: expect.any(String),
			webhookSecret: "test-webhook-secret",
		});
		expect(convex.mutation.mock.invocationCallOrder[0]).toBeLessThan(
			mockBuildOrderItemsFromSnapshot.mock.invocationCallOrder[0],
		);

		await submitPrintFulfillment(
			{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
			input,
		);
		expect(mockBuildOrderItemsFromSnapshot).toHaveBeenLastCalledWith(
			checkoutSnapshot,
			session.id,
			[expect.objectContaining({ quantity: 3 })],
			"angelsrest.online",
		);
		expect(mockBuildOrderItemsFromSession).not.toHaveBeenCalled();
	});

	it("holds the claim during image preparation and releases it before provider submission", async () => {
		const { submitPrintFulfillment } = await import("../printFulfillment");
		mockBuildOrderItemsFromSession.mockReturnValueOnce([
			{
				imageUrl: "https://opaque.example/source",
				sourcePolicy: "opaque_capability",
				paperSubcategoryId: 103001,
				quantity: 1,
				width: 8,
				height: 10,
				borderWidth: 0.25,
			},
		]);
		mockPreparePrintSources.mockRejectedValueOnce(new Error("R2 unavailable"));

		await expect(
			submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				printInput,
			),
		).rejects.toThrow("R2 unavailable");
		expect(convex.mutation.mock.invocationCallOrder[0]).toBeLessThan(
			mockPreparePrintSources.mock.invocationCallOrder[0],
		);
		expect(convex.mutation).toHaveBeenLastCalledWith("orders.releasePrintFulfillmentClaim", {
			orderId,
			claimToken: expect.any(String),
			webhookSecret: "test-webhook-secret",
		});
		expect(mockCreateLumaPrintsOrder).not.toHaveBeenCalled();
	});

	it("does not submit when a manual refund cancels preparation before the provider fence", async () => {
		const { submitPrintFulfillment } = await import("../printFulfillment");
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.claimPrintFulfillmentV5") {
				return { kind: "claimed", externalId: session.id };
			}
			if (reference === "orders.beginPrintFulfillmentSubmission") {
				return { kind: "manual_refunded", stripeRefundId: "re_manual_123" };
			}
		});

		await expect(
			submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				printInput,
			),
		).resolves.toEqual({ kind: "manual_refunded", stripeRefundId: "re_manual_123" });
		expect(mockCreateLumaPrintsOrder).not.toHaveBeenCalled();
	});

	it("reconciles an ambiguous POST and never submits it twice", async () => {
		const { submitPrintFulfillment } = await import("../printFulfillment");
		let claimed = false;
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.beginPrintFulfillmentSubmission") {
				return { kind: "submitting", externalId: session.id };
			}
			if (reference === "orders.reconcilePrintFulfillmentSubmission") {
				return { kind: "fulfilled" };
			}
			if (reference !== "orders.claimPrintFulfillmentV5") return;
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
		mockFindLumaPrintsOrder.mockResolvedValueOnce({ orderNumber: "123" });
		await expect(submit()).resolves.toMatchObject({ kind: "fulfilled" });
		expect(mockCreateLumaPrintsOrder).toHaveBeenCalledOnce();
		expect(mockFindLumaPrintsOrder).toHaveBeenCalledWith(session.id);
	});

	it("keeps a queue receipt provisional until a later direct confirmation", async () => {
		const { PrintReconciliationPendingError, submitPrintFulfillment } = await import(
			"../printFulfillment"
		);
		let firstClaim = true;
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.claimPrintFulfillmentV5") {
				if (firstClaim) {
					firstClaim = false;
					return { kind: "claimed", externalId: session.id };
				}
				return {
					kind: "reconcile",
					externalId: session.id,
					submissionOrderNumber: "123",
				};
			}
			if (reference === "orders.beginPrintFulfillmentSubmission") {
				return { kind: "submitting", externalId: session.id };
			}
			if (reference === "orders.recordPrintFulfillmentSubmissionReceipt") {
				return { kind: "recorded" };
			}
			if (reference === "orders.recordPrintFulfillmentReconciliationPending") {
				return { kind: "pending", attempts: 1 };
			}
			if (reference === "orders.reconcilePrintFulfillmentSubmission") {
				return { kind: "fulfilled" };
			}
		});
		mockConfirmLumaPrintsOrder.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		const submit = () =>
			submitPrintFulfillment(
				{
					convex,
					createLumaPrintsOrder: mockCreateLumaPrintsOrder,
					confirmLumaPrintsOrder: mockConfirmLumaPrintsOrder,
					findLumaPrintsOrder: mockFindLumaPrintsOrder,
				},
				printInput,
			);

		await expect(submit()).rejects.toBeInstanceOf(PrintReconciliationPendingError);
		await expect(submit()).resolves.toEqual({
			kind: "fulfilled",
			lumaprintsOrderNumber: "123",
		});
		expect(mockCreateLumaPrintsOrder).toHaveBeenCalledOnce();
		expect(mockConfirmLumaPrintsOrder.mock.calls).toEqual([
			["123", session.id],
			["123", session.id],
		]);
		expect(mockFindLumaPrintsOrder).not.toHaveBeenCalled();
		expect(
			convex.mutation.mock.calls.filter(
				([reference]: unknown[]) => reference === "orders.recordPrintFulfillmentSubmissionReceipt",
			),
		).toHaveLength(1);
	});

	it("clears only a definitely rejected POST fence before entering refund recovery", async () => {
		const { LumaPrintsSubmissionError } = (await import("$lib/server/lumaprints")) as unknown as {
			LumaPrintsSubmissionError: new (
				message: string,
				disposition: "definitely_rejected" | "uncertain",
				details?: unknown,
			) => Error;
		};
		const { submitPrintFulfillment } = await import("../printFulfillment");
		mockCreateLumaPrintsOrder.mockRejectedValueOnce(
			new LumaPrintsSubmissionError("rejected", "definitely_rejected", {
				phase: "status",
				statusCode: 400,
				providerReason: "billing_address",
			}),
		);

		await expect(
			submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				printInput,
			),
		).rejects.toThrow("rejected");
		expect(mockLogStructured).toHaveBeenCalledWith({
			event: "lumaprints.failed",
			level: "error",
			stage: "lumaprints_submit",
			orderId: "ORD-001",
			error: expect.any(Error),
			meta: { phase: "status", statusCode: 400, providerReason: "billing_address" },
		});
		const claim = convex.mutation.mock.calls.find(
			([reference]: unknown[]) => reference === "orders.claimPrintFulfillmentV5",
		)?.[1] as { claimToken: string } | undefined;
		if (!claim) throw new Error("Expected a print claim");
		expect(convex.mutation).toHaveBeenCalledWith("orders.rejectPrintFulfillmentSubmission", {
			orderId,
			claimToken: claim.claimToken,
			externalId: session.id,
			webhookSecret: "test-webhook-secret",
		});
		expect(convex.mutation).not.toHaveBeenCalledWith(
			"orders.recordPrintFulfillmentSubmissionReceipt",
			expect.anything(),
		);
	});

	it("keeps an uncertain typed submission fenced for GET reconciliation", async () => {
		const { LumaPrintsSubmissionError } = (await import("$lib/server/lumaprints")) as unknown as {
			LumaPrintsSubmissionError: new (
				message: string,
				disposition: "definitely_rejected" | "uncertain",
			) => Error;
		};
		const { submitPrintFulfillment } = await import("../printFulfillment");
		mockCreateLumaPrintsOrder.mockRejectedValueOnce(
			new LumaPrintsSubmissionError("unknown", "uncertain"),
		);

		await expect(
			submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				printInput,
			),
		).rejects.toThrow("submission outcome is unknown");
		expect(mockLogStructured).toHaveBeenCalledWith(
			expect.objectContaining({
				level: "error",
				error: new Error("LumaPrints order submission failed"),
			}),
		);
		expect(convex.mutation).not.toHaveBeenCalledWith(
			"orders.rejectPrintFulfillmentSubmission",
			expect.anything(),
		);
	});

	it("retries only transient reconciliation failures and records a later GET result", async () => {
		const { LumaPrintsReconciliationError } = await import("$lib/server/lumaprints");
		const { submitPrintFulfillment } = await import("../printFulfillment");
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.claimPrintFulfillmentV5") {
				return { kind: "reconcile", externalId: session.id };
			}
			if (reference === "orders.recordPrintFulfillmentReconciliationPending") {
				return { kind: "pending", attempts: 1 };
			}
			if (reference === "orders.reconcilePrintFulfillmentSubmission") {
				return { kind: "fulfilled" };
			}
		});
		mockFindLumaPrintsOrder
			.mockRejectedValueOnce(
				new LumaPrintsReconciliationError("temporarily unavailable", "retryable"),
			)
			.mockResolvedValueOnce({ orderNumber: "456" });
		const submit = () =>
			submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				printInput,
			);

		await expect(submit()).rejects.toThrow("Print provider reconciliation is pending");
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		await expect(submit()).resolves.toEqual({
			kind: "fulfilled",
			lumaprintsOrderNumber: "456",
		});
		expect(mockFindLumaPrintsOrder).toHaveBeenCalledTimes(2);
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.recordPrintFulfillmentReconciliationPending",
			expect.objectContaining({ reason: "rate_or_server" }),
		);
		expect(mockCreateLumaPrintsOrder).not.toHaveBeenCalled();
		expect(convex.mutation).toHaveBeenLastCalledWith("orders.reconcilePrintFulfillmentSubmission", {
			orderId,
			externalId: session.id,
			webhookSecret: "test-webhook-secret",
			lumaprintsOrderNumber: "456",
		});
	});

	it("records every bounded inconclusive GET class before retrying", async () => {
		const { LumaPrintsReconciliationError } = await import("$lib/server/lumaprints");
		const { submitPrintFulfillment } = await import("../printFulfillment");
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.claimPrintFulfillmentV5") {
				return { kind: "reconcile", externalId: session.id };
			}
			if (reference === "orders.recordPrintFulfillmentReconciliationPending") {
				return { kind: "pending", attempts: 1 };
			}
		});
		const cases = [
			[new LumaPrintsReconciliationError("transport connection reset", "retryable"), "transport"],
			[new LumaPrintsReconciliationError("temporarily unavailable", "retryable"), "rate_or_server"],
			[
				new LumaPrintsReconciliationError("lookup exceeded its page bound", "retryable"),
				"resource_bound",
			],
			[new Error("adapter threw"), "client_exception"],
			[null, "result_not_observed"],
		] as const;

		for (const [result, reason] of cases) {
			mockFindLumaPrintsOrder.mockReset();
			if (result === null) mockFindLumaPrintsOrder.mockResolvedValueOnce(null);
			else mockFindLumaPrintsOrder.mockRejectedValueOnce(result);
			const callCount = convex.mutation.mock.calls.length;
			await expect(
				submitPrintFulfillment(
					{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
					printInput,
				),
			).rejects.toThrow("reconciliation is pending");
			expect(convex.mutation.mock.calls.slice(callCount)).toContainEqual([
				"orders.recordPrintFulfillmentReconciliationPending",
				expect.objectContaining({ reason }),
			]);
		}
		expect(mockCreateLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
	});

	it("durably blocks deterministic reconciliation faults and stops automatic GET retries", async () => {
		const { LumaPrintsReconciliationError } = await import("$lib/server/lumaprints");
		const { submitPrintFulfillment } = await import("../printFulfillment");
		let blocked = false;
		let alertAvailable = true;
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.claimPrintFulfillmentV5") {
				return blocked
					? { kind: "reconciliation_blocked", reconciliationClass: "response_contract" }
					: { kind: "reconcile", externalId: session.id };
			}
			if (reference === "orders.blockPrintFulfillmentReconciliation") {
				blocked = true;
				return true;
			}
			if (reference === "orders.claimPrintFulfillmentReconciliationAlert") {
				const claimed = alertAvailable;
				alertAvailable = false;
				return claimed ? { kind: "claimed" } : { kind: "unavailable" };
			}
		});
		mockFindLumaPrintsOrder.mockRejectedValueOnce(
			new LumaPrintsReconciliationError("malformed", "blocked", "response_contract"),
		);
		const submit = () =>
			submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				printInput,
			);

		await expect(submit()).resolves.toEqual({
			kind: "reconciliation_blocked",
			reconciliationClass: "response_contract",
			alertClaimToken: expect.any(String),
		});
		await expect(submit()).resolves.toEqual({
			kind: "reconciliation_blocked",
			reconciliationClass: "response_contract",
			alertClaimToken: undefined,
		});
		expect(mockFindLumaPrintsOrder).toHaveBeenCalledOnce();
		expect(mockCreateLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.blockPrintFulfillmentReconciliation",
			expect.objectContaining({ reconciliationClass: "response_contract" }),
		);
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.claimPrintFulfillmentReconciliationAlert",
			expect.objectContaining({
				orderId,
				externalId: session.id,
				claimToken: expect.any(String),
			}),
		);
	});

	it("preserves ambiguous_result through orchestration and claims one alert", async () => {
		const { LumaPrintsReconciliationError } = await import("$lib/server/lumaprints");
		const { submitPrintFulfillment } = await import("../printFulfillment");
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.claimPrintFulfillmentV5") {
				return { kind: "reconcile", externalId: session.id };
			}
			if (reference === "orders.recordPrintFulfillmentReconciliationPending") {
				return { kind: "pending", attempts: 1 };
			}
			if (reference === "orders.blockPrintFulfillmentReconciliation") return true;
			if (reference === "orders.claimPrintFulfillmentReconciliationAlert") {
				return { kind: "claimed" };
			}
		});
		mockFindLumaPrintsOrder.mockRejectedValueOnce(
			new LumaPrintsReconciliationError("ambiguous", "blocked", "ambiguous_result"),
		);

		await expect(
			submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				printInput,
			),
		).resolves.toEqual({
			kind: "reconciliation_blocked",
			reconciliationClass: "ambiguous_result",
			alertClaimToken: expect.any(String),
		});
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.blockPrintFulfillmentReconciliation",
			expect.objectContaining({ reconciliationClass: "ambiguous_result" }),
		);
		expect(
			convex.mutation.mock.calls.filter(
				([reference]: [string]) => reference === "orders.claimPrintFulfillmentReconciliationAlert",
			),
		).toHaveLength(1);
	});

	it("keeps untyped reconciliation exceptions retryable instead of inventing a block class", async () => {
		const { submitPrintFulfillment } = await import("../printFulfillment");
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.claimPrintFulfillmentV5") {
				return { kind: "reconcile", externalId: session.id };
			}
			if (reference === "orders.recordPrintFulfillmentReconciliationPending") {
				return { kind: "pending", attempts: 1 };
			}
		});
		mockFindLumaPrintsOrder.mockRejectedValueOnce(new Error("unexpected adapter fault"));

		await expect(
			submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				printInput,
			),
		).rejects.toThrow("reconciliation is pending");
		expect(convex.mutation).not.toHaveBeenCalledWith(
			"orders.blockPrintFulfillmentReconciliation",
			expect.anything(),
		);
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.recordPrintFulfillmentReconciliationPending",
			expect.objectContaining({ reason: "client_exception" }),
		);
	});

	it("keeps a blocked reconciliation retryable while another alert lease is active", async () => {
		const { submitPrintFulfillment } = await import("../printFulfillment");
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.claimPrintFulfillmentV5") {
				return { kind: "reconciliation_blocked", reconciliationClass: "response_contract" };
			}
			if (reference === "orders.claimPrintFulfillmentReconciliationAlert") {
				return { kind: "busy", leaseExpiresAt: Date.now() + 60_000 };
			}
		});

		await expect(
			submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				printInput,
			),
		).rejects.toThrow("alert delivery is already in progress");
		expect(mockFindLumaPrintsOrder).not.toHaveBeenCalled();
		expect(mockCreateLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
	});

	it("uses the current fulfillment result when a deterministic block result is stale", async () => {
		const { LumaPrintsReconciliationError } = await import("$lib/server/lumaprints");
		const { submitPrintFulfillment } = await import("../printFulfillment");
		const claimResults = [
			{ kind: "reconcile", externalId: session.id },
			{ kind: "fulfilled", orderNumber: "457" },
		];
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.claimPrintFulfillmentV5") return claimResults.shift();
			if (reference === "orders.blockPrintFulfillmentReconciliation") return false;
		});
		mockFindLumaPrintsOrder.mockRejectedValueOnce(
			new LumaPrintsReconciliationError("malformed", "blocked", "response_contract"),
		);

		await expect(
			submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				printInput,
			),
		).resolves.toEqual({
			kind: "fulfilled",
			lumaprintsOrderNumber: "457",
		});
		expect(mockCreateLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalledWith(
			"orders.releasePrintFulfillmentClaim",
			expect.anything(),
		);
	});

	it("records a fenced provider receipt after a manual refund commits", async () => {
		const { submitPrintFulfillment } = await import("../printFulfillment");
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.claimPrintFulfillmentV5") {
				return { kind: "claimed", externalId: session.id };
			}
			if (reference === "orders.beginPrintFulfillmentSubmission") {
				return { kind: "submitting", externalId: session.id };
			}
			if (reference === "orders.recordPrintFulfillmentSubmissionReceipt") {
				return { kind: "recorded" };
			}
			if (reference === "orders.reconcilePrintFulfillmentSubmission") {
				return { kind: "manual_refunded", stripeRefundId: "re_manual_123" };
			}
		});

		await expect(
			submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				printInput,
			),
		).resolves.toEqual({ kind: "manual_refunded", stripeRefundId: "re_manual_123" });
		const claimArgs = convex.mutation.mock.calls.find(
			(call: unknown[]) => call[0] === "orders.claimPrintFulfillmentV5",
		)?.[1] as { claimToken: string } | undefined;
		if (!claimArgs) throw new Error("Expected a print fulfillment claim");
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.recordPrintFulfillmentSubmissionReceipt",
			expect.objectContaining({
				claimToken: claimArgs.claimToken,
				externalId: session.id,
				lumaprintsSubmissionOrderNumber: "123",
			}),
		);
		expect(mockCreateLumaPrintsOrder).toHaveBeenCalledOnce();
		expect(mockConfirmLumaPrintsOrder).toHaveBeenCalledWith("123", session.id);
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.reconcilePrintFulfillmentSubmission",
			expect.objectContaining({ lumaprintsOrderNumber: "123" }),
		);
	});

	it("GET-reconciles a refunded uncertain submission without another POST", async () => {
		const { submitPrintFulfillment } = await import("../printFulfillment");
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.claimPrintFulfillmentV5") {
				return { kind: "reconcile", externalId: session.id };
			}
			if (reference === "orders.reconcilePrintFulfillmentSubmission") {
				return { kind: "manual_refunded", stripeRefundId: "re_manual_123" };
			}
		});
		mockFindLumaPrintsOrder.mockResolvedValueOnce({ orderNumber: "458" });

		await expect(
			submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				printInput,
			),
		).resolves.toEqual({ kind: "manual_refunded", stripeRefundId: "re_manual_123" });
		expect(mockFindLumaPrintsOrder).toHaveBeenCalledOnce();
		expect(mockCreateLumaPrintsOrder).not.toHaveBeenCalled();
	});

	it("rethrows transient fulfillment failures so Stripe retries", async () => {
		await expect(handle(new Error("network dropped"))).rejects.toThrow(
			"Print provider temporarily unavailable",
		);
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalled();
	});

	it("checkpoints, refunds, stores terminal recovery, and returns the terminal outcome", async () => {
		const { FulfillmentValidationError } = await import("../fulfillmentValidationError");

		const outcome = await handle(
			new FulfillmentValidationError("Print provider rejected fulfillment"),
			{ stripeRequestOptions: { stripeAccount: "acct_123" } },
		);

		expect(outcome).toEqual(
			expect.objectContaining({
				kind: "permanent_failure_refunded",
				stripeRefundId: "re_test_123",
			}),
		);
		expect(convex.mutation).toHaveBeenNthCalledWith(
			1,
			"orders.claimAutomatedFulfillmentRefundV2",
			expect.objectContaining({
				orderId,
				claimToken: expect.any(String),
				fulfillmentError: "Fulfillment validation rejected",
			}),
		);
		expect(stripe.refunds.create).toHaveBeenCalledWith(
			{
				payment_intent: "pi_test_123",
				reason: "requested_by_customer",
				refund_application_fee: true,
				metadata: {
					orderNumber: "ORD-001",
					fulfillmentError: "Fulfillment validation rejected",
					automated: "fulfillment_recovery_v1",
				},
			},
			{ stripeAccount: "acct_123", idempotencyKey: "fulfillment-refund:cs_test_123" },
		);
		expect(convex.mutation).toHaveBeenNthCalledWith(
			2,
			"orders.recordAutomatedFulfillmentRefund",
			expect.objectContaining({
				orderId,
				stripeRefundId: "re_test_123",
			}),
		);
		expect(convex.mutation).toHaveBeenNthCalledWith(
			3,
			"orders.claimFulfillmentFailureNotificationV2",
			expect.objectContaining({ orderId, audience: "admin" }),
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

	it("persists pending and resumes by retrieving the same refund until it succeeds", async () => {
		const { FulfillmentValidationError } = await import("../fulfillmentValidationError");
		convex.mutation
			.mockReset()
			.mockResolvedValueOnce({ kind: "claimed", leaseExpiresAt: Date.now() + 60_000 })
			.mockResolvedValueOnce({ kind: "pending", refundStatus: "pending" })
			.mockResolvedValueOnce({
				kind: "claimed",
				leaseExpiresAt: Date.now() + 60_000,
				stripeRefundId: "re_pending_123456",
				refundStatus: "pending",
			})
			.mockResolvedValueOnce({ kind: "succeeded", stripeRefundId: "re_pending_123456" })
			.mockResolvedValueOnce({ kind: "claimed" })
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true);
		stripe.refunds.create.mockResolvedValueOnce({
			id: "re_pending_123456",
			status: "pending",
		});
		stripe.refunds.retrieve.mockResolvedValueOnce({
			id: "re_pending_123456",
			status: "succeeded",
		});

		await expect(handle(new FulfillmentValidationError("invalid dimensions"))).rejects.toThrow(
			"refund is pending",
		);
		await expect(
			handle(new FulfillmentValidationError("invalid dimensions")),
		).resolves.toMatchObject({
			kind: "permanent_failure_refunded",
			stripeRefundId: "re_pending_123456",
		});

		expect(stripe.refunds.create).toHaveBeenCalledOnce();
		expect(stripe.refunds.retrieve).toHaveBeenCalledWith("re_pending_123456", undefined);
		const records = convex.mutation.mock.calls.filter(
			([reference]: unknown[]) => reference === "orders.recordAutomatedFulfillmentRefund",
		);
		expect(
			records.map(
				(call: unknown[]) => (call[1] as { stripeRefundStatus: string }).stripeRefundStatus,
			),
		).toEqual(["pending", "succeeded"]);
		expect(mockSendFulfillmentFailureAlert).toHaveBeenCalledOnce();
	});

	it("fences a hard crash after Stripe acceptance instead of creating again", async () => {
		const { FulfillmentValidationError } = await import("../fulfillmentValidationError");
		convex.mutation
			.mockReset()
			.mockResolvedValueOnce({ kind: "claimed", leaseExpiresAt: Date.now() + 60_000 })
			.mockRejectedValueOnce(new Error("process crashed before refund checkpoint"))
			.mockResolvedValueOnce({ kind: "unavailable" })
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce({ kind: "claimed" })
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true);
		stripe.refunds.create.mockResolvedValue({ id: "re_crash_123456", status: "succeeded" });

		await expect(handle(new FulfillmentValidationError("invalid dimensions"))).rejects.toThrow(
			"process crashed",
		);
		await expect(handle(new FulfillmentValidationError("invalid dimensions"))).resolves.toEqual({
			kind: "automated_refund_request_uncertain",
			attentionReason: "request_outcome_unknown",
			errorSummary: "Fulfillment validation rejected",
		});

		expect(stripe.refunds.create).toHaveBeenCalledOnce();
		expect(mockSendAutomatedRefundAttentionAlert).toHaveBeenCalledOnce();
		expect(convex.mutation).not.toHaveBeenCalledWith(
			"orders.releaseAutomatedFulfillmentRefund",
			expect.anything(),
		);
	});

	it.each([
		"failed",
		"canceled",
	] as const)("records %s as operator-blocked and never sends refund-success copy", async (status) => {
		const { FulfillmentValidationError } = await import("../fulfillmentValidationError");
		convex.mutation
			.mockReset()
			.mockResolvedValueOnce({ kind: "claimed", leaseExpiresAt: Date.now() + 60_000 })
			.mockResolvedValueOnce({
				kind: "refund_failed",
				stripeRefundId: `re_${status}_123456`,
				refundStatus: status,
			})
			.mockResolvedValueOnce({ kind: "claimed" })
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true);
		stripe.refunds.create.mockResolvedValueOnce({ id: `re_${status}_123456`, status });

		await expect(handle(new FulfillmentValidationError("invalid dimensions"))).resolves.toEqual({
			kind: "automated_refund_failed",
			stripeRefundId: `re_${status}_123456`,
			refundStatus: status,
			errorSummary: "Fulfillment validation rejected",
		});
		expect(mockSendAutomatedRefundFailureAlert).toHaveBeenCalledOnce();
		expect(mockSendFulfillmentFailureAlert).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
	});

	it.each([
		"pending",
		"requires_action",
	] as const)("returns %s attention and sends only its leased operator alert", async (status) => {
		const { FulfillmentValidationError } = await import("../fulfillmentValidationError");
		convex.mutation
			.mockReset()
			.mockResolvedValueOnce({
				kind: "refund_attention",
				stripeRefundId: "re_attention_123456",
				refundStatus: status,
				attentionReason: "attempts_exhausted",
			})
			.mockResolvedValueOnce({ kind: "claimed" })
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true);

		await expect(handle(new FulfillmentValidationError("invalid dimensions"))).resolves.toEqual({
			kind: "automated_refund_attention",
			stripeRefundId: "re_attention_123456",
			refundStatus: status,
			attentionReason: "attempts_exhausted",
			errorSummary: "Fulfillment validation rejected",
		});
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(stripe.refunds.retrieve).not.toHaveBeenCalled();
		expect(mockSendAutomatedRefundAttentionAlert).toHaveBeenCalledWith(
			resend,
			expect.objectContaining({
				notificationIdentity: Buffer.from(orderId, "utf8").toString("base64url"),
			}),
		);
		expect(mockSendAutomatedRefundFailureAlert).not.toHaveBeenCalled();
		expect(mockSendFulfillmentFailureAlert).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
		expect(convex.mutation).toHaveBeenNthCalledWith(
			2,
			"orders.claimFulfillmentFailureNotificationV3",
			expect.objectContaining({ audience: "refund_attention" }),
		);
	});

	it("releases a failed email lease and retries with the durable refund", async () => {
		const { FulfillmentValidationError } = await import("../fulfillmentValidationError");
		convex.mutation
			.mockReset()
			.mockResolvedValueOnce({ kind: "claimed", leaseExpiresAt: Date.now() + 60_000 })
			.mockResolvedValueOnce({ kind: "succeeded", stripeRefundId: "re_email_123456" })
			.mockResolvedValueOnce({ kind: "claimed" })
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce({ kind: "refunded", stripeRefundId: "re_email_123456" })
			.mockResolvedValueOnce({ kind: "claimed" })
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true);
		stripe.refunds.create.mockResolvedValueOnce({ id: "re_email_123456", status: "succeeded" });
		mockSendFulfillmentFailureAlert
			.mockRejectedValueOnce(new Error("Resend rejected the request"))
			.mockResolvedValueOnce({ id: "email-accepted" });

		await expect(handle(new FulfillmentValidationError("invalid dimensions"))).rejects.toThrow(
			"notification delivery failed",
		);
		await expect(
			handle(new FulfillmentValidationError("invalid dimensions")),
		).resolves.toMatchObject({
			kind: "permanent_failure_refunded",
			stripeRefundId: "re_email_123456",
		});
		expect(stripe.refunds.create).toHaveBeenCalledOnce();
		expect(mockSendFulfillmentFailureAlert).toHaveBeenCalledTimes(2);
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.releaseFulfillmentFailureNotificationV2",
			expect.objectContaining({ audience: "admin", claimToken: expect.any(String) }),
		);
	});

	it("retries a refund notification after completion crashes without releasing its lease", async () => {
		const { sendClaimedFulfillmentFailureAdminAlert } = await import("../printFulfillment");
		const input = {
			orderId,
			orderNumber: "ORD-001",
			customerEmail: "jane@example.com",
			errorSummary: "Fulfillment validation rejected",
			stripeRefundId: "re_completioncrash123456",
			total: 3500,
		};
		convex.mutation
			.mockReset()
			.mockResolvedValueOnce({ kind: "claimed" })
			.mockResolvedValueOnce(true)
			.mockRejectedValueOnce(new Error("completion response lost"))
			.mockResolvedValueOnce({ kind: "busy", leaseExpiresAt: Date.now() + 60_000 })
			.mockResolvedValueOnce({ kind: "claimed" })
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true);
		mockSendFulfillmentFailureAlert.mockResolvedValue({ id: "email-accepted" });

		await expect(
			sendClaimedFulfillmentFailureAdminAlert({ convex, resend }, input),
		).rejects.toThrow("completion response lost");
		expect(convex.mutation).not.toHaveBeenCalledWith(
			"orders.releaseFulfillmentFailureNotificationV2",
			expect.anything(),
		);
		await expect(
			sendClaimedFulfillmentFailureAdminAlert({ convex, resend }, input),
		).rejects.toThrow("already in progress");
		await expect(sendClaimedFulfillmentFailureAdminAlert({ convex, resend }, input)).resolves.toBe(
			true,
		);

		expect(mockSendFulfillmentFailureAlert).toHaveBeenCalledTimes(2);
		expect(mockSendFulfillmentFailureAlert.mock.calls[0]).toEqual(
			mockSendFulfillmentFailureAlert.mock.calls[1],
		);
		const claimCalls = convex.mutation.mock.calls.filter(
			([reference]: unknown[]) => reference === "orders.claimFulfillmentFailureNotificationV2",
		);
		expect(claimCalls).toHaveLength(3);
		expect((claimCalls[0][1] as { claimToken: string }).claimToken).not.toBe(
			(claimCalls[2][1] as { claimToken: string }).claimToken,
		);
	});

	it("does not resend a refund notification after delivery becomes uncertain", async () => {
		const { sendClaimedFulfillmentFailureAdminAlert } = await import("../printFulfillment");
		convex.mutation.mockResolvedValueOnce({ kind: "unavailable" }).mockResolvedValueOnce(true);

		await expect(
			sendClaimedFulfillmentFailureAdminAlert(
				{ convex, resend },
				{
					orderId,
					orderNumber: "ORD-001",
					customerEmail: "jane@example.com",
					errorSummary: "Fulfillment validation rejected",
					stripeRefundId: "re_deliveryuncertain123456",
					total: 3500,
				},
			),
		).resolves.toBe(false);
		expect(mockSendFulfillmentFailureAlert).not.toHaveBeenCalled();
		expect(convex.mutation).not.toHaveBeenCalledWith(
			"orders.completeFulfillmentFailureNotificationV2",
			expect.anything(),
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

	it("fences an unknown refund request outcome without submitting again", async () => {
		const { FulfillmentValidationError } = await import("../fulfillmentValidationError");
		stripe.refunds.create.mockRejectedValueOnce(new Error("Stripe unavailable"));

		await expect(handle(new FulfillmentValidationError("invalid dimensions"))).resolves.toEqual({
			kind: "automated_refund_request_uncertain",
			attentionReason: "request_outcome_unknown",
			errorSummary: "Fulfillment validation rejected",
		});
		convex.mutation
			.mockResolvedValueOnce({ kind: "unavailable" })
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce({ kind: "unavailable" });
		await expect(handle(new FulfillmentValidationError("invalid dimensions"))).resolves.toEqual({
			kind: "automated_refund_request_uncertain",
			attentionReason: "request_outcome_unknown",
			errorSummary: "Fulfillment validation rejected",
		});

		expect(stripe.refunds.create).toHaveBeenCalledOnce();
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.markAutomatedFulfillmentRefundRequestUncertain",
			expect.objectContaining({ orderId, claimToken: expect.any(String) }),
		);
		expect(convex.mutation).not.toHaveBeenCalledWith(
			"orders.releaseAutomatedFulfillmentRefund",
			expect.anything(),
		);
		expect(mockSendAutomatedRefundAttentionAlert).toHaveBeenCalledOnce();
		expect(mockSendFulfillmentFailureAlert).not.toHaveBeenCalled();
	});

	it("does not call Stripe while another automated refund lease is active", async () => {
		const { FulfillmentValidationError } = await import("../fulfillmentValidationError");
		convex.mutation.mockResolvedValueOnce({
			kind: "busy",
			leaseExpiresAt: Date.now() + 60_000,
		});

		await expect(handle(new FulfillmentValidationError("invalid dimensions"))).rejects.toThrow(
			"refund is already in progress",
		);

		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendFulfillmentFailureAlert).not.toHaveBeenCalled();
	});

	describe("invalid snapshot side-effect boundary", () => {
		it("does not POST when snapshot preparation rejects a later source", async () => {
			const { submitPrintFulfillment } = await import("../printFulfillment");
			const checkoutSnapshot = {
				schemaVersion: 1 as const,
				catalogProvider: "convex" as const,
				items: [
					{
						productKey: "set",
						revisionId: "revision",
						productKind: "print_set" as const,
						variantKey: "variant",
						materialOptionKey: "paper",
						sizeOptionKey: "size",
						borderOptionKey: null,
						frameOptionKey: null,
					},
				],
			};
			mockBuildOrderItemsFromSnapshot.mockRejectedValueOnce(
				new Error("Paid fulfillment print source is invalid"),
			);

			await expect(
				submitPrintFulfillment(
					{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
					{
						...printInput,
						checkoutSnapshot,
						lineItems: [{ quantity: 1 }] as Stripe.LineItem[],
					},
				),
			).rejects.toThrow("Paid fulfillment print source is invalid");

			expect(mockBuildOrderItemsFromSnapshot).toHaveBeenCalledOnce();
			expect(mockPreparePrintSources).not.toHaveBeenCalled();
			expect(mockCreateLumaPrintsOrder).not.toHaveBeenCalled();
			expect(convex.mutation).not.toHaveBeenCalledWith(
				"orders.beginPrintFulfillmentSubmission",
				expect.anything(),
			);
		});
	});
});
