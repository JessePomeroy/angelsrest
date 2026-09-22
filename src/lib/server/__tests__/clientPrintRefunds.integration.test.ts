/// <reference types="vite/client" />
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import { convexTest } from "convex-test";
import { Resend } from "resend";
import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "../../../../packages/crm-api/convex/_generated/api";
import { CLIENT_PRINT_REFUND_RETRY_MS } from "../../../../packages/crm-api/convex/helpers/clientPrintRefunds";
import schema from "../../../../packages/crm-api/convex/schema";
import { runClientPrintRefund } from "../clientPrintRefunds.server";
import { STRIPE_API_VERSION } from "../stripeApiVersion";

const env = vi.hoisted(() => ({
	WEBHOOK_SECRET: "client-print-refund-secret-0123456789abcdef",
	STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_offline_fixture",
	CLIENT_PRINT_REFUNDS_ENABLED: "true",
	CLIENT_REFUND_EVIDENCE_ENABLED: "true",
}));
vi.mock("$env/dynamic/private", () => ({ env }));
const runtime = vi.hoisted(() => ({
	stripe: undefined as unknown,
	convex: undefined as unknown,
	failureAlert: vi.fn(),
	fulfill: vi.fn(),
}));
vi.mock("$lib/server/logger", () => ({ logStructured: vi.fn() }));
vi.mock("$lib/server/convexClient", () => ({ getConvex: () => runtime.convex }));
vi.mock("$lib/server/stripeClient", () => ({ getStripe: () => runtime.stripe }));
vi.mock("$lib/server/resendClient", () => ({ getResend: () => ({}) }));
vi.mock("$lib/server/lumaprints", async (original) => ({
	...(await original<typeof import("../lumaprints")>()),
	createOrderLumaPrintsClient: runtime.fulfill,
}));
vi.mock("$lib/server/webhookEmails", async (original) => ({
	...(await original<typeof import("../webhookEmails")>()),
	sendFailureAlert: runtime.failureAlert,
}));
vi.mock("$lib/server/clientPrintRefunds.server", async (original) => ({
	...(await original<typeof import("../clientPrintRefunds.server")>()),
	getClientPrintRefundStripe: () => runtime.stripe,
}));
const modules = import.meta.glob("../../../../packages/crm-api/convex/**/*.ts");
const TENANT = "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b";
const ACCOUNT = "acct_client12345678901",
	PLATFORM = "acct_platform1234567890",
	SESSION = "cs_test_original1234567890",
	PI = "pi_original1234567890",
	CHARGE = "ch_original1234567890",
	FEE = "fee_original1234567890",
	APP = "ca_original1234567890";
const metadata = { commerceTenantId: TENANT, commerceTenantSiteUrl: "client.example" };
// Partial Stripe fixtures allow adversarial malformed responses without making network calls.
const response = <T>(value: unknown) => value as Stripe.Response<T>;
const list = <T>(data: T[], has_more = false) =>
	response<Stripe.ApiList<T>>({ object: "list", data, has_more, url: "/offline" });
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
	vi.stubEnv("WEBHOOK_SECRET", env.WEBHOOK_SECRET);
	env.CLIENT_PRINT_REFUNDS_ENABLED = "true";
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			throw new Error("Unexpected network access");
		}),
	);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
async function setup(lines = [4000, 1000], other = 500) {
	const t = convexTest(schema, modules);
	const clientId = await t.run((ctx) =>
		ctx.db.insert("platformClients", {
			siteUrl: "client.example",
			tenantId: TENANT,
			name: "Client",
			email: "owner@example.invalid",
			adminEmails: ["owner@example.invalid"],
			tier: "full",
			subscriptionStatus: "active",
			stripeConnectedAccountId: ACCOUNT,
		}),
	);
	await t.run((ctx) =>
		ctx.db.insert("stripeAccountBindings", {
			clientId,
			tenantId: TENANT,
			stripeConnectedAccountId: ACCOUNT,
			platformAccountId: PLATFORM,
			livemode: false,
			boundAt: Date.now(),
			attemptId: "original-attempt",
		}),
	);
	const snapshot = {
		version: 1 as const,
		policy: "print_subtotal_5pct_floor_v1" as const,
		tenantId: TENANT,
		stripePlatformAccountId: PLATFORM,
		stripeConnectedAccountId: ACCOUNT,
		stripeLivemode: false,
		currency: "usd" as const,
		subtotalCents: 13000,
		printSubtotalCents: 10000,
		applicationFeeAmountCents: 500,
		lines: [
			{ productKind: "print" as const, unitPriceCents: 5000, quantity: 2 },
			{ productKind: "digital_download" as const, unitPriceCents: 3000, quantity: 1 },
		],
	};
	const orderId = await t.run((ctx) =>
		ctx.db.insert("orders", {
			siteUrl: "client.example",
			tenantId: TENANT,
			stripeSessionId: SESSION,
			stripePaymentIntentId: PI,
			stripeConnectedAccountId: ACCOUNT,
			stripePaymentCurrency: "usd",
			stripePaymentLivemode: false,
			checkoutFinancialSnapshot: snapshot,
			orderNumber: "ORD-001",
			customerEmail: "buyer@example.invalid",
			items: [],
			total: 14000,
			status: "new",
			fulfillmentType: "self",
		}),
	);
	const owner = t.withIdentity({
		subject: "owner",
		email: "owner@example.invalid",
		emailVerified: true,
	});
	const operationId = await owner.mutation(api.orders.requestClientPrintRefund, {
		orderId,
		requestToken: crypto.randomUUID(),
		allocation: { lineAmountsCents: lines, otherAmountCents: other },
		webhookSecret: env.WEBHOOK_SECRET,
	});
	const convex = new ConvexHttpClient("https://example.invalid");
	const mutation = vi
		.spyOn(convex, "mutation")
		.mockImplementation((...args: Parameters<ConvexHttpClient["mutation"]>) =>
			t.mutation(args[0], args[1]),
		);
	vi.spyOn(convex, "query").mockImplementation((...args: Parameters<ConvexHttpClient["query"]>) =>
		t.query(args[0], args[1]),
	);
	const stripe = new Stripe("sk_test_offline_fixture", { apiVersion: STRIPE_API_VERSION });
	const customers: Stripe.Refund[] = [],
		fees: Stripe.FeeRefund[] = [];
	const platform = vi
		.spyOn(stripe.accounts, "retrieve")
		.mockResolvedValue(response<Stripe.Account>({ object: "account", id: PLATFORM }));
	const balance = vi
		.spyOn(stripe.balance, "retrieve")
		.mockResolvedValue(response<Stripe.Balance>({ object: "balance", livemode: false }));
	const session = vi.spyOn(stripe.checkout.sessions, "retrieve").mockResolvedValue(
		response<Stripe.Checkout.Session>({
			object: "checkout.session",
			id: SESSION,
			metadata,
			mode: "payment",
			status: "complete",
			payment_status: "paid",
			currency: "usd",
			livemode: false,
			amount_subtotal: 13000,
			amount_total: 14000,
			payment_intent: PI,
		}),
	);
	const payment = vi.spyOn(stripe.paymentIntents, "retrieve").mockImplementation(async () =>
		response<Stripe.PaymentIntent>({
			object: "payment_intent",
			id: PI,
			metadata,
			amount: 14000,
			amount_received: 14000,
			currency: "usd",
			livemode: false,
			status: "succeeded",
			application: APP,
			application_fee_amount: 500,
			latest_charge: {
				object: "charge",
				id: CHARGE,
				payment_intent: PI,
				amount: 14000,
				amount_captured: 14000,
				paid: true,
				captured: true,
				status: "succeeded",
				currency: "usd",
				livemode: false,
				amount_refunded: customers
					.filter((row) => row.status === "succeeded")
					.reduce((sum, row) => sum + row.amount, 0),
				application: APP,
				application_fee: FEE,
				application_fee_amount: 500,
			},
		}),
	);
	vi.spyOn(stripe.applicationFees, "retrieve").mockImplementation(async () => {
		const amount_refunded = fees.reduce((sum, row) => sum + row.amount, 0);
		return response<Stripe.ApplicationFee>({
			object: "application_fee",
			id: FEE,
			account: ACCOUNT,
			charge: CHARGE,
			application: APP,
			originating_transaction: null,
			currency: "usd",
			livemode: false,
			amount: 500,
			amount_refunded,
			refunded: amount_refunded === 500,
		});
	});
	const customerList = vi.spyOn(stripe.refunds, "list").mockResolvedValue(list(customers));
	const feeList = vi.spyOn(stripe.applicationFees, "listRefunds").mockResolvedValue(list(fees));
	const customerRead = vi.spyOn(stripe.refunds, "retrieve").mockImplementation(async (id) => {
		const row = customers.find((row) => row.id === id);
		if (!row) throw new Error("Missing refund");
		return response<Stripe.Refund>({ ...row });
	});
	const state = {
		customerStatus: "succeeded",
		loseCustomerResponse: false,
		loseFeeResponse: false,
		rejectCustomer: false,
		rejectFee: false,
	};
	const customerPost = vi.spyOn(stripe.refunds, "create").mockImplementation(async (params) => {
		if (state.rejectCustomer) throw new Error("Provider unavailable");
		const row = response<Stripe.Refund>({
			object: "refund",
			id: `re_created000000000${customers.length}`,
			charge: CHARGE,
			payment_intent: PI,
			amount: params && "amount" in params ? params.amount : undefined,
			currency: "usd",
			status: state.customerStatus,
			metadata: params && "metadata" in params ? params.metadata : undefined,
		});
		customers.push(row);
		if (state.loseCustomerResponse) {
			state.loseCustomerResponse = false;
			throw new Error("Lost response");
		}
		return row;
	});
	const feePost = vi
		.spyOn(stripe.applicationFees, "createRefund")
		.mockImplementation(async (_id, params) => {
			if (state.rejectFee) throw new Error("Provider unavailable");
			const row = response<Stripe.FeeRefund>({
				object: "fee_refund",
				id: `fr_created000000000${fees.length}`,
				fee: FEE,
				amount: params && "amount" in params ? params.amount : undefined,
				currency: "usd",
				metadata: params && "metadata" in params ? params.metadata : undefined,
			});
			fees.push(row);
			if (state.loseFeeResponse) {
				state.loseFeeResponse = false;
				throw new Error("Lost response");
			}
			return row;
		});
	const run = () => runClientPrintRefund({ stripe, convex, operationId });
	const row = () => t.run((ctx) => ctx.db.get(operationId));
	return {
		t,
		owner,
		orderId,
		operationId,
		stripe,
		convex,
		mutation,
		platform,
		balance,
		session,
		payment,
		customers,
		fees,
		customerList,
		feeList,
		customerRead,
		customerPost,
		feePost,
		state,
		run,
		row,
	};
}
describe("guided refunds across the real host and Convex boundary", () => {
	test("refunds mixed principal on the original client account and the exact print fee on the platform", async () => {
		const s = await setup();
		await s.run();
		await s.run();
		expect(await s.row()).toMatchObject({
			state: "complete",
			amountCents: 5500,
			printAmountCents: 4000,
			feeAmountCents: 200,
		});
		expect(s.customerPost).toHaveBeenCalledOnce();
		expect(s.feePost).toHaveBeenCalledOnce();
		expect(s.customerPost).toHaveBeenCalledWith(
			expect.objectContaining({ charge: CHARGE, amount: 5500, refund_application_fee: false }),
			expect.objectContaining({
				stripeAccount: ACCOUNT,
				idempotencyKey: `client-print-refund:${s.operationId}:customer:v1`,
				maxNetworkRetries: 0,
				timeout: 5000,
			}),
		);
		expect(s.feePost).toHaveBeenCalledWith(
			FEE,
			expect.objectContaining({ amount: 200 }),
			expect.not.objectContaining({ stripeAccount: expect.anything() }),
		);
		expect(s.session).toHaveBeenCalledWith(SESSION, {}, { stripeAccount: ACCOUNT });
	});
	test("full refund closes the order and returns only the print fee", async () => {
		const s = await setup([10000, 3000], 1000);
		await s.run();
		expect(await s.t.run((ctx) => ctx.db.get(s.orderId))).toMatchObject({ status: "refunded" });
		expect(s.fees[0].amount).toBe(500);
	});
	test("non-print and shipping refunds do not send a fee POST", async () => {
		const s = await setup([0, 3000], 1000);
		await s.run();
		expect(await s.row()).toMatchObject({ state: "complete", feeAmountCents: 0 });
		expect(s.feePost).not.toHaveBeenCalled();
	});
	test.each([
		"loseCustomerResponse",
		"loseFeeResponse",
	] as const)("recovers %s using private persisted proof, without duplicate money movement", async (key) => {
		const s = await setup();
		s.state[key] = true;
		await expect(s.run()).rejects.toThrow();
		await s.run();
		expect(await s.row()).toMatchObject({ state: "complete" });
		expect(s.customerPost).toHaveBeenCalledOnce();
		expect(s.feePost).toHaveBeenCalledOnce();
	});
	test.each([
		"customer",
		"fee",
	] as const)("recovers a lost %s database acknowledgement", async (stage) => {
		const s = await setup();
		let lose = true;
		s.mutation.mockImplementation(async (...args: Parameters<ConvexHttpClient["mutation"]>) => {
			const result = await s.t.mutation(args[0], args[1]);
			if (
				lose &&
				getFunctionName(args[0]) === "orders:recordClientPrintRefund" &&
				args[1]?.result?.stage === stage
			) {
				lose = false;
				throw new Error("Lost database reply");
			}
			return result;
		});
		await expect(s.run()).rejects.toThrow();
		await s.run();
		expect(await s.row()).toMatchObject({ state: "complete" });
		expect(s.customerPost).toHaveBeenCalledOnce();
		expect(s.feePost).toHaveBeenCalledOnce();
	});
	test("a fee-only retry never posts another customer refund", async () => {
		const s = await setup();
		s.state.rejectFee = true;
		await expect(s.run()).rejects.toThrow();
		expect((await s.row())?.customerStatus).toBe("succeeded");
		s.state.rejectFee = false;
		await s.run();
		expect(s.customerPost).toHaveBeenCalledOnce();
		expect(s.fees).toHaveLength(1);
	});
	test.each([
		"pending",
		"requires_action",
		"failed",
		"canceled",
	])("does not return a fee while customer status is %s", async (status) => {
		const s = await setup();
		s.state.customerStatus = status;
		await s.run();
		expect(s.feePost).not.toHaveBeenCalled();
		expect((await s.row())?.customerStatus).toBe(status);
		if (status === "pending" || status === "requires_action") {
			s.customers[0].status = "succeeded";
			await s.run();
			expect(s.customerPost).toHaveBeenCalledOnce();
			expect(s.feePost).toHaveBeenCalledOnce();
		}
	});
	test.each([
		"customer",
		"fee",
	])("blocks unknown Dashboard %s refunds before posting", async (kind) => {
		const s = await setup();
		if (kind === "customer")
			s.customers.push(
				response<Stripe.Refund>({
					object: "refund",
					id: "re_unknown0000000000",
					charge: CHARGE,
					payment_intent: PI,
					currency: "usd",
					amount: 10,
					status: "failed",
					metadata: {},
				}),
			);
		else
			s.fees.push(
				response<Stripe.FeeRefund>({
					object: "fee_refund",
					id: "fr_unknown0000000000",
					fee: FEE,
					currency: "usd",
					amount: 10,
					metadata: {},
				}),
			);
		await expect(s.run()).rejects.toMatchObject({ issue: "manual_review" });
		expect(s.customerPost).not.toHaveBeenCalled();
		expect(s.feePost).not.toHaveBeenCalled();
	});
	test.each(["customer", "fee"])("requires complete bounded %s history", async (kind) => {
		const s = await setup();
		if (kind === "customer") s.customerList.mockResolvedValue(list([], true));
		else s.feeList.mockResolvedValue(list([], true));
		await expect(s.run()).rejects.toThrow();
		expect(s.customerPost).not.toHaveBeenCalled();
	});
	test("rejects duplicated recovery proof", async () => {
		const s = await setup();
		s.state.loseCustomerResponse = true;
		await expect(s.run()).rejects.toThrow();
		s.customers.push({ ...s.customers[0], id: "re_duplicate00000000" });
		await expect(s.run()).rejects.toMatchObject({ issue: "manual_review" });
		expect(s.customerPost).toHaveBeenCalledOnce();
		expect(s.feePost).not.toHaveBeenCalled();
	});
	test.each(["platform", "mode"])("rejects a changed %s before any POST", async (kind) => {
		const s = await setup();
		if (kind === "platform")
			s.platform.mockResolvedValue(
				response<Stripe.Account>({ object: "account", id: "acct_foreign000000000" }),
			);
		else
			s.balance.mockResolvedValue(response<Stripe.Balance>({ object: "balance", livemode: true }));
		await expect(s.run()).rejects.toMatchObject({ issue: "provider_mismatch" });
		expect(s.customerPost).not.toHaveBeenCalled();
	});
	test("does not retry an uncertain POST after the idempotency window", async () => {
		const s = await setup();
		s.state.rejectCustomer = true;
		await expect(s.run()).rejects.toThrow();
		vi.setSystemTime(Date.now() + CLIENT_PRINT_REFUND_RETRY_MS);
		s.state.rejectCustomer = false;
		await expect(s.run()).rejects.toMatchObject({ issue: "retry_window_expired" });
		expect(s.customerPost).toHaveBeenCalledOnce();
	});
	test("can recover an existing provider result after the retry window", async () => {
		const s = await setup();
		s.state.loseCustomerResponse = true;
		await expect(s.run()).rejects.toThrow();
		vi.setSystemTime(Date.now() + CLIENT_PRINT_REFUND_RETRY_MS);
		await s.run();
		expect(await s.row()).toMatchObject({ state: "complete" });
		expect(s.customerPost).toHaveBeenCalledOnce();
	});
	test("serializes simultaneous workers", async () => {
		const s = await setup();
		const results = await Promise.allSettled([s.run(), s.run()]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(s.customerPost).toHaveBeenCalledOnce();
		expect(s.feePost).toHaveBeenCalledOnce();
	});
	test("signed refund events complete a pending fee and preserve later failure without another POST", async () => {
		const s = await setup();
		s.state.customerStatus = "pending";
		await s.run();
		runtime.stripe = s.stripe;
		runtime.convex = s.convex;
		vi.spyOn(s.stripe.checkout.sessions, "list").mockResolvedValue(
			list([await s.stripe.checkout.sessions.retrieve(SESSION)]),
		);
		vi.spyOn(s.stripe.charges, "retrieve").mockImplementation(async () =>
			response<Stripe.Charge>((await s.stripe.paymentIntents.retrieve(PI)).latest_charge),
		);
		const { POST } = await import("../../../routes/api/webhooks/stripe/+server");
		const send = async () => {
			const payload = JSON.stringify({
				id: "evt_guided0000000000",
				object: "event",
				type: "refund.updated",
				api_version: STRIPE_API_VERSION,
				account: ACCOUNT,
				livemode: false,
				data: { object: s.customers[0] },
			});
			return POST({
				request: new Request("https://angelsrest.test/api/webhooks/stripe", {
					method: "POST",
					headers: {
						"stripe-signature": s.stripe.webhooks.generateTestHeaderString({
							payload,
							secret: env.STRIPE_CONNECT_WEBHOOK_SECRET,
						}),
					},
					body: payload,
				}),
			} as Parameters<typeof POST>[0]);
		};
		s.customers[0].status = "succeeded";
		vi.mocked(s.convex.query).mockImplementation(
			async (...args: Parameters<ConvexHttpClient["query"]>) => {
				if (getFunctionName(args[0]) === "orders:getClientPrintRefundForWebhook")
					throw new Error("Temporary database failure");
				return s.t.query(args[0], args[1]);
			},
		);
		await expect(send()).rejects.toMatchObject({ status: 500 });
		expect(runtime.failureAlert).not.toHaveBeenCalled();
		vi.mocked(s.convex.query).mockImplementation((...args: Parameters<ConvexHttpClient["query"]>) =>
			s.t.query(args[0], args[1]),
		);
		s.state.rejectFee = true;
		await expect(send()).rejects.toMatchObject({ status: 500 });
		expect(runtime.failureAlert).not.toHaveBeenCalled();
		s.state.rejectFee = false;
		expect((await send()).status).toBe(200);
		expect(await s.row()).toMatchObject({ state: "complete" });
		expect(s.customerPost).toHaveBeenCalledOnce();
		expect(s.fees).toHaveLength(1);
		s.customers[0].status = "failed";
		expect((await send()).status).toBe(200);
		expect(await s.row()).toMatchObject({
			state: "attention",
			issue: "customer_refund_failed",
			customerStatus: "failed",
			feeRefundId: s.fees[0].id,
		});
		expect(s.customerPost).toHaveBeenCalledOnce();
		expect(s.fees).toHaveLength(1);
		expect(runtime.fulfill).not.toHaveBeenCalled();
		await s.t.finishAllScheduledFunctions(vi.runAllTimers);
	});

	test("supplier failure after a guided partial refund cannot run the old full refund", async () => {
		const s = await setup();
		await s.run();
		const { handlePermanentFulfillmentFailure } = await import("../printFulfillment");
		const resend = new Resend("re_offline_fixture");
		const mail = vi.spyOn(resend.emails, "send").mockRejectedValue(new Error("Unexpected email"));
		expect(
			await handlePermanentFulfillmentFailure(
				{ stripe: s.stripe, convex: s.convex, resend },
				{
					orderId: s.orderId,
					orderNumber: "ORD-001",
					error: new Error("Supplier rejected"),
					session: { id: SESSION, payment_intent: PI, amount_total: 14000 },
					customerEmail: "buyer@example.invalid",
				},
			),
		).toEqual({ kind: "guided_refund_review_required" });
		expect(await s.t.run((ctx) => ctx.db.get(s.orderId))).toMatchObject({
			status: "fulfillment_error",
		});
		expect(s.customerPost).toHaveBeenCalledOnce();
		expect(s.feePost).toHaveBeenCalledOnce();
		expect(mail).not.toHaveBeenCalled();
	});

	test("flag-off stops before backend or provider calls", async () => {
		const s = await setup();
		env.CLIENT_PRINT_REFUNDS_ENABLED = "false";
		await expect(s.run()).rejects.toThrow();
		expect(s.mutation).not.toHaveBeenCalled();
		expect(s.platform).not.toHaveBeenCalled();
	});
});
