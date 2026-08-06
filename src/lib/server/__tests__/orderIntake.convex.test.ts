/// <reference types="vite/client" />

import type { ConvexHttpClient } from "convex/browser";
import { convexTest } from "convex-test";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "$convex/api";
import schema from "../../../../packages/crm-api/convex/schema";
import { processStripeWebhookEvent } from "../orderIntake";

const modules = import.meta.glob("../../../../packages/crm-api/convex/**/*.ts");
const WEBHOOK_SECRET = "test-webhook-secret";
const SITE_URL = "angelsrest.online";
const SESSION_ID = "cs_test_1234567890abcdef";
const PAYMENT_INTENT_ID = "pi_1234567890abcdef";
const REFUND_ID = "re_1234567890abcdef";
const CHARGE_ID = "ch_1234567890abcdef";
const CLAIM_TOKEN = "123e4567-e89b-42d3-a456-426614174000";

const privateEnv = vi.hoisted(() => ({
	WEBHOOK_SECRET: "test-webhook-secret",
	CHECKOUT_SNAPSHOT_MODE: "handle-v2",
	LUMAPRINTS_API_KEY: "test-key",
	LUMAPRINTS_API_SECRET: "test-secret",
	LUMAPRINTS_STORE_ID: "123",
	LUMAPRINTS_USE_SANDBOX: "false",
	NOTIFICATION_EMAIL: "operator@example.com",
}));

const email = vi.hoisted(() => ({
	admin: vi.fn(),
	automatedRefundFailure: vi.fn(),
	confirmation: vi.fn(),
	fulfillmentCustomer: vi.fn(),
	fulfillmentAdmin: vi.fn(),
	failureAlert: vi.fn(),
	paymentFailure: vi.fn(),
	reconciliationBlocked: vi.fn(),
}));

vi.mock("$env/dynamic/private", () => ({ env: privateEnv }));
vi.mock("$lib/server/logger", () => ({
	logStructured: vi.fn(),
	timed: async (_metadata: unknown, operation: () => Promise<unknown>) => operation(),
}));
vi.mock("$lib/server/snapshotFulfillment", () => ({
	buildOrderItemsFromSnapshot: vi.fn(),
}));
vi.mock("$lib/server/webhookEmails", async (importOriginal) => {
	const original = await importOriginal<typeof import("../webhookEmails")>();
	return {
		...original,
		sendAdminNotification: email.admin,
		sendAutomatedRefundFailureAlert: email.automatedRefundFailure,
		sendCustomerConfirmation: email.confirmation,
		sendCustomerFulfillmentFailure: email.fulfillmentCustomer,
		sendFailureAlert: email.failureAlert,
		sendFulfillmentFailureAlert: email.fulfillmentAdmin,
		sendPaymentFailedEmail: email.paymentFailure,
		sendPrintReconciliationBlockedAlert: email.reconciliationBlocked,
	};
});

const checkoutSnapshot = {
	schemaVersion: 1 as const,
	catalogProvider: "sanity" as const,
	items: [
		{
			productKey: "sanity.print.integration",
			revisionId: "immutable-revision-1",
			productKind: "print" as const,
			variantKey: "8x10",
			materialOptionKey: "archival-paper",
			sizeOptionKey: "8x10",
			borderOptionKey: null,
			frameOptionKey: null,
		},
	],
};

function checkoutSession(): Stripe.Checkout.Session {
	return {
		id: SESSION_ID,
		object: "checkout.session",
		mode: "payment",
		status: "complete",
		payment_status: "paid",
		payment_intent: PAYMENT_INTENT_ID,
		amount_total: 4200,
		amount_subtotal: 4200,
		currency: "usd",
		livemode: false,
		customer_details: {
			email: "buyer@example.com",
			name: "Buyer",
			address: null,
			business_name: null,
			individual_name: null,
			phone: null,
			tax_exempt: "none",
			tax_ids: [],
		},
		metadata: {},
	} as unknown as Stripe.Checkout.Session;
}

function checkoutEvent(session: Stripe.Checkout.Session): Stripe.Event {
	return {
		id: "evt_checkout1234567890",
		type: "checkout.session.completed",
		livemode: false,
		data: { object: session },
	} as Stripe.Event;
}

function manualRefundEvent(): Stripe.Event {
	return {
		id: "evt_manualrefund123456",
		type: "refund.updated",
		livemode: false,
		data: {
			object: {
				id: REFUND_ID,
				object: "refund",
				status: "succeeded",
				amount: 4200,
				currency: "usd",
				charge: CHARGE_ID,
				payment_intent: PAYMENT_INTENT_ID,
				metadata: {},
			},
		},
	} as Stripe.Event;
}

function reconciliationPage(orders: unknown[]) {
	const body = JSON.stringify({
		orders,
		totalOrders: orders.length,
		currentPage: 1,
		totalPages: orders.length === 0 ? 0 : 1,
	});
	return new Response(body, {
		headers: {
			"content-type": "application/json",
			"content-length": String(new TextEncoder().encode(body).byteLength),
		},
	});
}

describe("order intake with real Convex state", () => {
	beforeEach(() => {
		process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
		vi.clearAllMocks();
	});

	afterEach(() => {
		delete process.env.WEBHOOK_SECRET;
		vi.unstubAllGlobals();
	});

	test("reconciles a refunded uncertain claim through empty and late GETs without side effects", async () => {
		const t = convexTest(schema, modules);
		const convex = {
			mutation: (reference: Parameters<typeof t.mutation>[0], args: unknown) =>
				t.mutation(reference, args as never),
			query: (reference: Parameters<typeof t.query>[0], args: unknown) =>
				t.query(reference, args as never),
		} as unknown as ConvexHttpClient;
		const session = checkoutSession();
		const created = await t.mutation(api.orders.create, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			stripeSessionId: SESSION_ID,
			stripePaymentIntentId: PAYMENT_INTENT_ID,
			customerEmail: "buyer@example.com",
			customerName: "Buyer",
			checkoutSnapshot,
			items: [{ productName: "Immutable print", quantity: 1, price: 4200 }],
			total: 4200,
			fulfillmentType: "lumaprints",
		});
		await t.run((ctx) =>
			ctx.db.patch(created._id, {
				printFulfillmentClaim: true,
				printFulfillmentClaimToken: CLAIM_TOKEN,
				printFulfillmentPhase: "submitting",
				printFulfillmentClaimedAt: Date.now() - 60_000,
				printFulfillmentCoordinatorVersion: 3,
				printFulfillmentResolution: "submission_uncertain",
			}),
		);
		const snapshotBefore = (await t.run((ctx) => ctx.db.get(created._id)))?.checkoutSnapshot;

		const stripe = {
			checkout: {
				sessions: {
					list: vi.fn().mockResolvedValue({ data: [session], has_more: false }),
					retrieve: vi.fn().mockResolvedValue(session),
					listLineItems: vi.fn().mockResolvedValue({
						data: [
							{
								id: "li_123",
								description: "Mutable Stripe display name",
								quantity: 1,
								amount_total: 4200,
							},
						],
						has_more: false,
					}),
				},
			},
			refunds: {
				create: vi.fn(),
				retrieve: vi.fn(),
			},
		} as unknown as Stripe;
		const resend = { emails: { send: vi.fn() } };
		const createLumaPrintsOrder = vi.fn();
		const adapters = {
			stripe,
			convex,
			resend: resend as never,
			createLumaPrintsOrder,
		};
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(reconciliationPage([]))
			.mockResolvedValueOnce(
				reconciliationPage([{ externalId: SESSION_ID, orderNumber: "456", storeId: "123" }]),
			);
		vi.stubGlobal("fetch", fetchMock);

		await processStripeWebhookEvent(manualRefundEvent(), adapters);
		await expect(processStripeWebhookEvent(checkoutEvent(session), adapters)).rejects.toMatchObject(
			{ status: 500 },
		);
		await processStripeWebhookEvent(checkoutEvent(session), adapters);

		const orders = await t.run((ctx) => ctx.db.query("orders").collect());
		expect(orders).toHaveLength(1);
		expect(orders[0]).toMatchObject({
			_id: created._id,
			status: "refunded",
			stripeRefundId: REFUND_ID,
			lumaprintsOrderNumber: "456",
			printFulfillmentResolution: "resolved",
		});
		expect(orders[0]?.checkoutSnapshot).toEqual(snapshotBefore);
		expect(orders[0]?.printFulfillmentClaim).toBeUndefined();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		for (const [, init] of fetchMock.mock.calls) {
			expect(init?.method).toBeUndefined();
		}
		for (const send of Object.values(email)) expect(send).not.toHaveBeenCalled();
		expect(resend.emails.send).not.toHaveBeenCalled();
	});

	test("preserves ambiguous_result into durable Convex state and emits one alert", async () => {
		const t = convexTest(schema, modules);
		const convex = {
			mutation: (reference: Parameters<typeof t.mutation>[0], args: unknown) =>
				t.mutation(reference, args as never),
			query: (reference: Parameters<typeof t.query>[0], args: unknown) =>
				t.query(reference, args as never),
		} as unknown as ConvexHttpClient;
		const session = checkoutSession();
		const created = await t.mutation(api.orders.create, {
			siteUrl: SITE_URL,
			webhookSecret: WEBHOOK_SECRET,
			stripeSessionId: SESSION_ID,
			stripePaymentIntentId: PAYMENT_INTENT_ID,
			customerEmail: "buyer@example.com",
			checkoutSnapshot,
			items: [{ productName: "Immutable print", quantity: 1, price: 4200 }],
			total: 4200,
			fulfillmentType: "lumaprints",
		});
		await t.run((ctx) =>
			ctx.db.patch(created._id, {
				printFulfillmentClaim: true,
				printFulfillmentClaimToken: CLAIM_TOKEN,
				printFulfillmentPhase: "submitting",
				printFulfillmentClaimedAt: Date.now() - 60_000,
				printFulfillmentCoordinatorVersion: 3,
				printFulfillmentResolution: "submission_uncertain",
			}),
		);
		const stripe = {
			checkout: {
				sessions: {
					retrieve: vi.fn().mockResolvedValue(session),
					listLineItems: vi.fn().mockResolvedValue({
						data: [
							{
								id: "li_ambiguous",
								description: "Print",
								quantity: 1,
								amount_total: 4200,
							},
						],
						has_more: false,
					}),
				},
			},
			refunds: { create: vi.fn(), retrieve: vi.fn() },
		} as unknown as Stripe;
		const createLumaPrintsOrder = vi.fn();
		const resend = { emails: { send: vi.fn() } };
		const adapters = {
			stripe,
			convex,
			resend: resend as never,
			createLumaPrintsOrder,
		};
		const fetchMock = vi.fn().mockResolvedValue(
			reconciliationPage([
				{ externalId: SESSION_ID, orderNumber: "456", storeId: "123" },
				{ externalId: SESSION_ID, orderNumber: "457", storeId: "123" },
			]),
		);
		vi.stubGlobal("fetch", fetchMock);

		await processStripeWebhookEvent(checkoutEvent(session), adapters);
		await processStripeWebhookEvent(checkoutEvent(session), adapters);

		const stored = await t.run((ctx) => ctx.db.get(created._id));
		expect(stored).toMatchObject({
			status: "new",
			printFulfillmentClaim: true,
			printFulfillmentPhase: "submitting",
			printFulfillmentResolution: "reconciliation_blocked",
			printFulfillmentReconciliationClass: "ambiguous_result",
			printFulfillmentReconciliationAlertSentAt: expect.any(Number),
		});
		expect(stored?.lumaprintsOrderNumber).toBeUndefined();
		expect(email.reconciliationBlocked).toHaveBeenCalledOnce();
		expect(email.reconciliationBlocked).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ reconciliationClass: "ambiguous_result" }),
		);
		for (const send of [
			email.admin,
			email.automatedRefundFailure,
			email.confirmation,
			email.fulfillmentCustomer,
			email.fulfillmentAdmin,
			email.failureAlert,
			email.paymentFailure,
		]) {
			expect(send).not.toHaveBeenCalled();
		}
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(createLumaPrintsOrder).not.toHaveBeenCalled();
		expect(stripe.refunds.create as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
	});
});
