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
			claimPrintFulfillment: "orders.claimPrintFulfillment",
			create: "orders.create",
			resolveCheckoutRouting: "orders.resolveCheckoutRouting",
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
		...overrides,
	};
}

describe("processStripeWebhookEvent", () => {
	let orderCreateResults: Array<ReturnType<typeof makeOrderResult>>;
	let updateStatusResults: Array<undefined | Error>;
	let claimedExternalId: string | undefined;
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
				listLineItems: vi.fn(),
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
		claimedExternalId = undefined;
		convex.mutation.mockImplementation(
			async (reference: string, args: { update?: string; stripeSessionId?: string }) => {
				if (reference === "orders.create") {
					claimedExternalId = args.stripeSessionId;
					const result = orderCreateResults.shift();
					if (!result) throw new Error("Missing configured orders.create result");
					return result;
				}
				if (reference === "orders.claimPrintFulfillment")
					return { kind: "claimed", externalId: claimedExternalId };
				if (reference === "orders.updatePrintFulfillment") return { kind: args.update };
				if (reference === "orders.updateStatus") {
					const result = updateStatusResults.shift();
					if (result instanceof Error) throw result;
					return undefined;
				}
				return undefined;
			},
		);
		convex.query.mockReset();
		mockPrivateEnv.CHECKOUT_SNAPSHOT_MODE = undefined;
		stripe.checkout.sessions.retrieve.mockReset();
		stripe.checkout.sessions.listLineItems.mockReset();
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
			expect.objectContaining({ lumaprintsOrderNumber: "LP-123" }),
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

	it.each([
		undefined,
		"",
		"handle-v1",
		"HANDLE-V2",
	])("keeps current routing and makes no session-first call when mode is %s", async (mode) => {
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
		expect(convex.query).not.toHaveBeenCalledWith(
			"orders.resolveCheckoutRouting",
			expect.anything(),
		);
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

		expect(convex.mutation).not.toHaveBeenCalled();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create).not.toHaveBeenCalled();
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
		expect(mockSendAdminNotification).not.toHaveBeenCalled();
		expect(mockSendCustomerFulfillmentFailure).not.toHaveBeenCalled();
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
				lumaprintsOrderNumber: "LP-STORED",
				checkoutSnapshot: {
					schemaVersion: 1,
					catalogProvider: "convex",
					items: [],
				},
			}),
		];

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
			expect.objectContaining({ payment_intent: "pi_test_123" }),
			{ idempotencyKey: "fulfillment-refund:cs_test_123" },
		);
		expect(mockSendCustomerFulfillmentFailure).toHaveBeenCalledTimes(1);
		expect(mockSendCustomerConfirmation).not.toHaveBeenCalled();
	});

	it("recovers a pre-submit refund state-write failure without provider submission", async () => {
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
		const { processStripeWebhookEvent } = await import("../orderIntake");
		await expect(
			processStripeWebhookEvent(makeStripeEvent("checkout.session.completed", session), adapters()),
		).rejects.toMatchObject({ status: 500 });
		await processStripeWebhookEvent(
			makeStripeEvent("checkout.session.completed", session),
			adapters(),
		);

		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
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
				status: "refunded",
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
