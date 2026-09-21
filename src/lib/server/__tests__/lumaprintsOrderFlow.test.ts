import { ConvexHttpClient } from "convex/browser";
import { Resend } from "resend";
import Stripe from "stripe";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "$convex/api";
import { secret, setup } from "../../../../packages/crm-api/test/lumaprintsOrderContextFixtures";
import { createOrderLumaPrintsClient } from "../lumaprints";
import { PrintReconciliationPendingError } from "../printFulfillment";
import { finishRecordedPrintOrder } from "../webhookOrders";

const { privateEnv } = vi.hoisted(() => ({ privateEnv: {} as Record<string, string | undefined> }));
vi.mock("$env/dynamic/private", () => ({ env: privateEnv }));
vi.mock("$lib/server/logger", () => ({
	logStructured: vi.fn(),
	timed: async (_metadata: unknown, action: () => Promise<unknown>) => action(),
}));

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
	vi.stubEnv("WEBHOOK_SECRET", secret);
	vi.stubEnv("ORDER_PRODUCERS_STATE", "open");
	for (const key of Object.keys(privateEnv)) delete privateEnv[key];
	Object.assign(privateEnv, {
		WEBHOOK_SECRET: secret,
		LUMAPRINTS_API_KEY: "central-fixture-key",
		LUMAPRINTS_API_SECRET: "central-fixture-secret",
		LUMAPRINTS_STORE_ID: "999",
		LUMAPRINTS_USE_SANDBOX: "false",
	});
	vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected provider request")));
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

async function fixture() {
	const s = await setup();
	const a = await s.paid(1);
	const b = await s.paid(2);
	const connections = [a, b].map((entry, index) => ({
		...entry.connection,
		credentialRef: `CLIENT${index + 1}`,
	}));
	privateEnv.LUMAPRINTS_CONNECTIONS = JSON.stringify({ version: 1, connections });
	for (const connection of connections) {
		privateEnv[`LUMAPRINTS_CONNECTION_${connection.credentialRef}_API_KEY`] =
			`fixture-${connection.credentialRef}-key`;
		privateEnv[`LUMAPRINTS_CONNECTION_${connection.credentialRef}_API_SECRET`] =
			`fixture-${connection.credentialRef}-secret`;
	}
	const convex = new ConvexHttpClient("https://test.convex.cloud");
	vi.spyOn(convex, "mutation").mockImplementation(
		(...parameters: Parameters<ConvexHttpClient["mutation"]>) =>
			s.t.mutation(parameters[0], parameters[1]),
	);
	vi.spyOn(convex, "query").mockImplementation(
		(...parameters: Parameters<ConvexHttpClient["query"]>) =>
			s.t.query(parameters[0], parameters[1]),
	);
	const stripe = new Stripe("sk_test_fixture");
	const refund = vi
		.spyOn(stripe.refunds, "create")
		.mockRejectedValue(new Error("Unexpected refund"));
	const getLumaPrintsClient = vi.fn(createOrderLumaPrintsClient);
	const adapters = { convex, stripe, resend: new Resend("re_fixture"), getLumaPrintsClient };
	const finish = async (paid: typeof a) => {
		const order = await s.t.run((ctx) => ctx.db.get(paid.order._id));
		if (!order) throw new Error("Missing paid order");
		return finishRecordedPrintOrder(adapters, {
			orderResult: { ...order, alreadyExisted: true },
			siteUrl: paid.args.siteUrl,
			tenantId: paid.connection.tenantId,
			printJob: {
				jobId: paid.jobId,
				leaseToken: paid.lease.leaseToken,
				items: [
					{
						imageUrl: "https://example.invalid/synthetic.jpg",
						sourcePolicy: "opaque_capability",
						paperSubcategoryId: 103007,
						width: 4,
						height: 6,
						quantity: 1,
						product: { subcategoryId: 103007, orderItemOptions: [39] },
					},
				],
			},
			lineItems: [],
			shippingDetails: {
				name: "Test Buyer",
				address: {
					line1: "1 Test Street",
					line2: null,
					city: "Detroit",
					state: "MI",
					postal_code: "48201",
					country: "US",
				},
			},
			session: {
				id: paid.args.stripeSessionId,
				metadata: {},
				payment_intent: "pi_test_fixture12345678",
				amount_total: 1000,
				payment_status: "paid",
				customer_details: { name: "Test Buyer", email: paid.args.customerEmail },
			},
		});
	};
	return { ...s, a, b, finish, refund, getLumaPrintsClient, connections };
}

it("uses each paid order's original account through queued POST, credential rotation, detachment and confirmation", async () => {
	const s = await fixture();
	const fetchMock = vi.fn(async (input: string, init: RequestInit) => {
		const url = new URL(input);
		expect(url.origin).toBe("https://us.api-sandbox.lumaprints.com");
		if (init.method === "POST") {
			const order = JSON.parse(String(init.body));
			const paid = order.externalId === s.a.args.stripeSessionId ? s.a : s.b;
			const client = paid === s.a ? "CLIENT1" : "CLIENT2";
			expect(order.storeId).toBe(101);
			expect(new Headers(init.headers).get("authorization")).toBe(
				`Basic ${btoa(`fixture-${client}-key:fixture-${client}-secret`)}`,
			);
			return Response.json({ message: "Queued", orderNumber: "12345" }, { status: 201 });
		}
		expect(url.pathname).toBe("/api/v1/orders/12345");
		const authorization = new Headers(init.headers).get("authorization");
		const a = authorization === `Basic ${btoa("fixture-CLIENT1-key:fixture-rotated-secret")}`;
		expect(authorization).toBe(
			a
				? `Basic ${btoa("fixture-CLIENT1-key:fixture-rotated-secret")}`
				: `Basic ${btoa("fixture-CLIENT2-key:fixture-CLIENT2-secret")}`,
		);
		return Response.json({
			externalId: (a ? s.a : s.b).args.stripeSessionId,
			orderNumber: "12345",
			storeId: 101,
		});
	});
	vi.stubGlobal("fetch", fetchMock);
	for (const paid of [s.a, s.b])
		await expect(s.finish(paid)).rejects.toBeInstanceOf(PrintReconciliationPendingError);
	expect(fetchMock).toHaveBeenCalledTimes(2);
	privateEnv.LUMAPRINTS_CONNECTION_CLIENT1_API_SECRET = "fixture-rotated-secret";
	await s.t.run((ctx) => ctx.db.patch(s.a.clientId, { lumaprintsConnectionRef: undefined }));
	vi.setSystemTime(Date.now() + 60001);
	for (const paid of [s.a, s.b]) {
		expect((await s.finish(paid)).fulfillment).toEqual({
			kind: "fulfilled",
			lumaprintsOrderNumber: "12345",
		});
		expect((await s.t.run((ctx) => ctx.db.get(paid.order._id)))?.lumaprintsConnection).toEqual(
			paid.connection,
		);
	}
	expect(fetchMock).toHaveBeenCalledTimes(4);
	expect(fetchMock.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(2);
	expect(s.getLumaPrintsClient.mock.calls.map(([context]) => context)).toEqual([
		s.a.connection,
		s.b.connection,
		s.a.connection,
		s.b.connection,
	]);
	expect(s.refund).not.toHaveBeenCalled();
});

it.each([
	"missing",
	"changed_store",
	"wrong_tenant",
])("stops %s context before provider HTTP, claims, or refunds", async (fault) => {
	const s = await fixture();
	if (fault === "missing") delete privateEnv.LUMAPRINTS_CONNECTION_CLIENT1_API_SECRET;
	if (fault === "changed_store")
		privateEnv.LUMAPRINTS_CONNECTIONS = JSON.stringify({
			version: 1,
			connections: s.connections.map((entry) => ({ ...entry, storeId: 202 })),
		});
	if (fault === "wrong_tenant")
		await s.t.run((ctx) => ctx.db.patch(s.a.order._id, { lumaprintsConnection: s.b.connection }));
	await expect(s.finish(s.a)).rejects.toThrow("Print provider temporarily unavailable");
	expect(fetch).not.toHaveBeenCalled();
	expect(s.refund).not.toHaveBeenCalled();
	const stored = await s.t.run((ctx) => ctx.db.get(s.a.order._id));
	expect(stored?.printFulfillmentClaim).toBeUndefined();
	expect(stored?.printFulfillmentResolution).toBeUndefined();
});

it("does not reroute an uncertain receipt when its registry entry disappears", async () => {
	const s = await fixture();
	await s.t.mutation(api.orders.claimPrintFulfillmentV5, {
		...s.a.command,
		lumaprintsConnection: s.a.connection,
	});
	await s.t.mutation(api.orders.beginPrintFulfillmentSubmission, s.a.command);
	await s.t.mutation(api.orders.recordPrintFulfillmentSubmissionReceipt, {
		orderId: s.a.order._id,
		claimToken: s.a.command.claimToken,
		externalId: s.a.args.stripeSessionId,
		lumaprintsSubmissionOrderNumber: "12345",
		webhookSecret: secret,
	});
	const before = await s.t.run((ctx) => ctx.db.get(s.a.order._id));
	delete privateEnv.LUMAPRINTS_CONNECTIONS;
	vi.setSystemTime(Date.now() + 60001);
	await expect(s.finish(s.a)).rejects.toThrow("Print provider temporarily unavailable");
	expect(await s.t.run((ctx) => ctx.db.get(s.a.order._id))).toEqual(before);
	expect(fetch).not.toHaveBeenCalled();
	expect(s.refund).not.toHaveBeenCalled();
});
