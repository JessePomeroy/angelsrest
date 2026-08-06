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
const mockProcessBorderedPrints = vi.fn();

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
		) {
			super(message);
			this.name = "LumaPrintsSubmissionError";
		}
	}
	return {
		LumaPrintsError,
		LumaPrintsReconciliationError,
		LumaPrintsSubmissionError,
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
vi.mock("$lib/server/sharpBorder", () => ({ processBorderedPrints: mockProcessBorderedPrints }));

vi.mock("$lib/server/webhookEmails", () => ({
	sendFulfillmentFailureAlert: mockSendFulfillmentFailureAlert,
}));

vi.mock("$convex/api", () => ({
	api: {
		orders: {
			beginPrintFulfillmentSubmission: "orders.beginPrintFulfillmentSubmission",
			blockPrintFulfillmentReconciliation: "orders.blockPrintFulfillmentReconciliation",
			claimAutomatedFulfillmentRefund: "orders.claimAutomatedFulfillmentRefund",
			claimFulfillmentFailureNotification: "orders.claimFulfillmentFailureNotification",
			claimNonPrintOrderOutcome: "orders.claimNonPrintOrderOutcome",
			claimPrintFulfillmentV2: "orders.claimPrintFulfillmentV2",
			claimPrintFulfillmentReconciliationAlert: "orders.claimPrintFulfillmentReconciliationAlert",
			completeAutomatedFulfillmentRefund: "orders.completeAutomatedFulfillmentRefund",
			completePrintFulfillmentSubmission: "orders.completePrintFulfillmentSubmission",
			reconcilePrintFulfillmentSubmission: "orders.reconcilePrintFulfillmentSubmission",
			rejectPrintFulfillmentSubmission: "orders.rejectPrintFulfillmentSubmission",
			releasePrintFulfillmentClaim: "orders.releasePrintFulfillmentClaim",
			releaseAutomatedFulfillmentRefund: "orders.releaseAutomatedFulfillmentRefund",
			updatePrintFulfillment: "orders.updatePrintFulfillment",
			updateStatus: "orders.updateStatus",
		},
	},
}));

vi.mock("$env/dynamic/private", () => ({
	env: {
		LUMAPRINTS_STORE_ID: "123",
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
			if (reference === "orders.claimNonPrintOrderOutcome") return { kind: "success" };
			if (reference === "orders.claimPrintFulfillmentV2")
				return { kind: "claimed", externalId: session.id };
			if (reference === "orders.beginPrintFulfillmentSubmission") {
				return { kind: "submitting", externalId: session.id };
			}
			if (reference === "orders.releasePrintFulfillmentClaim") return true;
			if (reference === "orders.blockPrintFulfillmentReconciliation") return true;
			if (reference === "orders.claimPrintFulfillmentReconciliationAlert") {
				return { kind: "claimed" };
			}
			if (reference === "orders.claimAutomatedFulfillmentRefund") {
				return { kind: "claimed", leaseExpiresAt: Date.now() + 60_000 };
			}
			if (reference === "orders.completeAutomatedFulfillmentRefund") {
				return { kind: "completed" };
			}
			if (reference === "orders.releaseAutomatedFulfillmentRefund") return true;
			if (reference === "orders.claimFulfillmentFailureNotification") return true;
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
		mockProcessBorderedPrints.mockImplementation(
			(items, stripeSessionId) =>
				new Map(
					items.map(({ index }: { index: number }) => [
						index,
						`https://worker.example/image/prints/bordered/${stripeSessionId}/${index}.jpg`,
					]),
				),
		);
		mockBuildLumaPrintsOrder.mockImplementation((externalId: string) => ({ externalId }));
		mockCreateLumaPrintsOrder.mockResolvedValue({ orderNumber: "123" });
		mockFindLumaPrintsOrder.mockResolvedValue(null);
		mockSendFulfillmentFailureAlert.mockResolvedValue({ id: "email-123" });
	});

	it("isolates same-number tenant borders by session and submits exact URL-safe payloads", async () => {
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
				if (reference === "orders.claimPrintFulfillmentV2") {
					return { kind: "claimed", externalId };
				}
				if (reference === "orders.beginPrintFulfillmentSubmission") {
					return { kind: "submitting", externalId };
				}
				if (reference === "orders.completePrintFulfillmentSubmission") {
					return { kind: "fulfilled" };
				}
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
		for (const { id, orderId } of cases)
			await submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				{ ...printInput, orderId, session: { ...session, id } },
			);
		const expected = (id: string) => ({
			externalId: id,
			storeId: 123,
			shippingMethod: "default",
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
					file: { imageUrl: `https://worker.example/image/prints/bordered/${id}/0.jpg` },
					orderItemOptions: [39],
				},
			],
		});
		expect(mockProcessBorderedPrints.mock.calls.map(([, id]) => id)).toEqual(sessions);
		expect(mockCreateLumaPrintsOrder.mock.calls.map(([payload]) => payload)).toEqual(
			sessions.map(expected),
		);
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
		expect(convex.mutation).toHaveBeenNthCalledWith(1, "orders.claimPrintFulfillmentV2", {
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
		expect(mockBuildOrderItemsFromSnapshot).toHaveBeenLastCalledWith(checkoutSnapshot, session.id, [
			expect.objectContaining({ quantity: 3 }),
		]);
		expect(mockBuildOrderItemsFromSession).not.toHaveBeenCalled();
	});

	it("holds the claim during bordered-image effects and releases it after preparation failure", async () => {
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
		mockProcessBorderedPrints.mockRejectedValueOnce(new Error("R2 unavailable"));

		await expect(
			submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				printInput,
			),
		).rejects.toThrow("R2 unavailable");
		expect(convex.mutation.mock.invocationCallOrder[0]).toBeLessThan(
			mockProcessBorderedPrints.mock.invocationCallOrder[0],
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
			if (reference === "orders.claimPrintFulfillmentV2") {
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
			if (reference !== "orders.claimPrintFulfillmentV2") return;
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

	it("clears only a definitely rejected POST fence before entering refund recovery", async () => {
		const { LumaPrintsSubmissionError } = (await import("$lib/server/lumaprints")) as unknown as {
			LumaPrintsSubmissionError: new (
				message: string,
				disposition: "definitely_rejected" | "uncertain",
			) => Error;
		};
		const { submitPrintFulfillment } = await import("../printFulfillment");
		mockCreateLumaPrintsOrder.mockRejectedValueOnce(
			new LumaPrintsSubmissionError("rejected", "definitely_rejected"),
		);

		await expect(
			submitPrintFulfillment(
				{ convex, createLumaPrintsOrder: mockCreateLumaPrintsOrder },
				printInput,
			),
		).rejects.toThrow("rejected");
		const claim = convex.mutation.mock.calls.find(
			([reference]: unknown[]) => reference === "orders.claimPrintFulfillmentV2",
		)?.[1] as { claimToken: string } | undefined;
		if (!claim) throw new Error("Expected a print claim");
		expect(convex.mutation).toHaveBeenCalledWith("orders.rejectPrintFulfillmentSubmission", {
			orderId,
			claimToken: claim.claimToken,
			externalId: session.id,
			webhookSecret: "test-webhook-secret",
		});
		expect(convex.mutation).not.toHaveBeenCalledWith(
			"orders.completePrintFulfillmentSubmission",
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
		expect(convex.mutation).not.toHaveBeenCalledWith(
			"orders.rejectPrintFulfillmentSubmission",
			expect.anything(),
		);
	});

	it("retries only transient reconciliation failures and records a later GET result", async () => {
		const { LumaPrintsReconciliationError } = await import("$lib/server/lumaprints");
		const { submitPrintFulfillment } = await import("../printFulfillment");
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.claimPrintFulfillmentV2") {
				return { kind: "reconcile", externalId: session.id };
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
		expect(mockCreateLumaPrintsOrder).not.toHaveBeenCalled();
		expect(convex.mutation).toHaveBeenLastCalledWith("orders.reconcilePrintFulfillmentSubmission", {
			orderId,
			externalId: session.id,
			webhookSecret: "test-webhook-secret",
			lumaprintsOrderNumber: "456",
		});
	});

	it("durably blocks deterministic reconciliation faults and stops automatic GET retries", async () => {
		const { LumaPrintsReconciliationError } = await import("$lib/server/lumaprints");
		const { submitPrintFulfillment } = await import("../printFulfillment");
		let blocked = false;
		let alertAvailable = true;
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.claimPrintFulfillmentV2") {
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

	it("keeps a blocked reconciliation retryable while another alert lease is active", async () => {
		const { submitPrintFulfillment } = await import("../printFulfillment");
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.claimPrintFulfillmentV2") {
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
			if (reference === "orders.claimPrintFulfillmentV2") return claimResults.shift();
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

	it("records a fenced provider success after a manual refund commits", async () => {
		const { submitPrintFulfillment } = await import("../printFulfillment");
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.claimPrintFulfillmentV2") {
				return { kind: "claimed", externalId: session.id };
			}
			if (reference === "orders.beginPrintFulfillmentSubmission") {
				return { kind: "submitting", externalId: session.id };
			}
			if (reference === "orders.completePrintFulfillmentSubmission") {
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
			(call: unknown[]) => call[0] === "orders.claimPrintFulfillmentV2",
		)?.[1] as { claimToken: string } | undefined;
		if (!claimArgs) throw new Error("Expected a print fulfillment claim");
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.completePrintFulfillmentSubmission",
			expect.objectContaining({
				claimToken: claimArgs.claimToken,
				externalId: session.id,
				lumaprintsOrderNumber: "123",
			}),
		);
		expect(mockCreateLumaPrintsOrder).toHaveBeenCalledOnce();
	});

	it("GET-reconciles a refunded uncertain submission without another POST", async () => {
		const { submitPrintFulfillment } = await import("../printFulfillment");
		convex.mutation.mockImplementation(async (reference: string) => {
			if (reference === "orders.claimPrintFulfillmentV2") {
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
			"orders.claimAutomatedFulfillmentRefund",
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
			"orders.completeAutomatedFulfillmentRefund",
			expect.objectContaining({
				orderId,
				stripeRefundId: "re_test_123",
			}),
		);
		expect(convex.mutation).toHaveBeenNthCalledWith(
			3,
			"orders.claimFulfillmentFailureNotification",
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

		expect(convex.mutation).toHaveBeenCalledTimes(2);
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.claimAutomatedFulfillmentRefund",
			expect.objectContaining({
				fulfillmentError: "Fulfillment validation rejected",
			}),
		);
		expect(convex.mutation).toHaveBeenCalledWith(
			"orders.releaseAutomatedFulfillmentRefund",
			expect.objectContaining({ orderId, claimToken: expect.any(String) }),
		);
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
			expect(mockProcessBorderedPrints).not.toHaveBeenCalled();
			expect(mockCreateLumaPrintsOrder).not.toHaveBeenCalled();
			expect(convex.mutation).not.toHaveBeenCalledWith(
				"orders.beginPrintFulfillmentSubmission",
				expect.anything(),
			);
		});
	});
});
