import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import { Resend } from "resend";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ensureTenantAliases } from "../../../../packages/crm-api/convex/helpers/tenantContext";
import { secret, setup } from "../../../../packages/crm-api/test/lumaprintsOrderContextFixtures";
import { POST as centralPost } from "../../../routes/api/webhooks/lumaprints/+server";
import { POST as clientPost } from "../../../routes/api/webhooks/lumaprints/[connectionRef]/+server";

const mocks = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>,
	convex: undefined as ConvexHttpClient | undefined,
	resend: undefined as Resend | undefined,
}));
vi.mock("$env/dynamic/private", () => ({ env: mocks.privateEnv }));
vi.mock("$lib/server/convexClient", () => ({
	getConvex: () => {
		if (!mocks.convex) throw new Error("Fixture not ready");
		return mocks.convex;
	},
}));
vi.mock("$lib/server/resendClient", () => ({ getResend: () => mocks.resend }));
vi.mock("$lib/server/logger", () => ({ logStructured: vi.fn() }));

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
	vi.stubEnv("WEBHOOK_SECRET", secret);
	vi.stubEnv("ORDER_PRODUCERS_STATE", "open");
	for (const key of Object.keys(mocks.privateEnv)) delete mocks.privateEnv[key];
	Object.assign(mocks.privateEnv, {
		WEBHOOK_SECRET: secret,
		LUMAPRINTS_WEBHOOK_USERNAME: "central",
		LUMAPRINTS_WEBHOOK_PASSWORD: "central-password",
	});
	vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Unexpected provider request")));
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

async function fixture(secondOrderNumber = "12345") {
	const s = await setup();
	const a = await s.submitted(1);
	const b = await s.submitted(2, secondOrderNumber);
	const legacyId = await s.t.run((ctx) =>
		ctx.db.insert("orders", {
			siteUrl: "angelsrest.online",
			orderNumber: "ORD-001",
			stripeSessionId: "cs_test_legacy1234567890",
			customerEmail: "central@example.invalid",
			total: 1000,
			status: "new",
			fulfillmentType: "lumaprints",
			items: [{ productName: "Legacy print", quantity: 1, price: 1000 }],
			lumaprintsOrderNumber: "12345",
			printFulfillmentResolution: "resolved",
		}),
	);
	const connections = [a, b].map((entry, index) => ({
		...entry.connection,
		credentialRef: `CLIENT${index + 1}`,
	}));
	mocks.privateEnv.LUMAPRINTS_CONNECTIONS = JSON.stringify({ version: 1, connections });
	for (let index = 1; index <= 2; index++) {
		mocks.privateEnv[`LUMAPRINTS_CONNECTION_CLIENT${index}_WEBHOOK_USERNAME`] = `client${index}`;
		mocks.privateEnv[`LUMAPRINTS_CONNECTION_CLIENT${index}_WEBHOOK_PASSWORD`] = `password${index}`;
	}
	// No outbound provider API credentials are available or needed for shipment intake.
	const convex = new ConvexHttpClient("https://test.convex.cloud");
	const mutate = (...parameters: Parameters<ConvexHttpClient["mutation"]>) =>
		s.t.mutation(parameters[0], parameters[1]);
	const mutation = vi.spyOn(convex, "mutation").mockImplementation(mutate);
	vi.spyOn(convex, "query").mockImplementation(
		(...parameters: Parameters<ConvexHttpClient["query"]>) =>
			s.t.query(parameters[0], parameters[1]),
	);
	const resend = new Resend("re_fixture");
	const send = vi
		.spyOn(resend.emails, "send")
		.mockResolvedValue({ data: { id: "fixture-delivery" }, error: null, headers: null });
	mocks.convex = convex;
	mocks.resend = resend;
	return { ...s, a, b, legacyId, connections, convex, mutation, mutate, send };
}

function request(
	connectionRef?: string,
	credentials = "client1:password1",
	body: unknown = {
		orderNumber: "12345",
		shipments: [{ carrier: "FedEx", trackingNumber: "TRACK-1" }],
	},
) {
	return new Request(
		`https://angelsrest.online/api/webhooks/lumaprints${connectionRef === undefined ? "" : `/${connectionRef}`}`,
		{
			method: "POST",
			headers: { authorization: `Basic ${btoa(credentials)}`, "content-type": "application/json" },
			body: JSON.stringify(body),
		},
	);
}
function deliver(connectionRef?: string, credentials?: string) {
	const incoming = request(connectionRef, credentials);
	return connectionRef === undefined
		? centralPost({ request: incoming })
		: clientPost({ request: incoming, params: { connectionRef } });
}

it("isolates two client receipts and the central order with equal provider numbers and distinct email keys", async () => {
	const s = await fixture();
	for (const [reference, credentials] of [
		[s.a.connection.connectionRef, "client1:password1"],
		[s.b.connection.connectionRef, "client2:password2"],
		[undefined, "central:central-password"],
	]) {
		const response = await deliver(reference, credentials);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ received: true, status: "processed" });
		expect(await (await deliver(reference, credentials)).json()).toEqual({
			received: true,
			status: "already_processed",
		});
	}
	expect(s.send).toHaveBeenCalledTimes(3);
	expect(s.send.mock.calls.map(([payload]) => payload.to)).toEqual([
		[s.a.args.customerEmail],
		[s.b.args.customerEmail],
		["central@example.invalid"],
	]);
	expect(s.send.mock.calls.map(([, options]) => options?.idempotencyKey)).toEqual([
		`shipment-email:${s.a.connection.connectionRef}:12345`,
		`shipment-email:${s.b.connection.connectionRef}:12345`,
		"shipment-email:12345",
	]);
	for (const id of [s.a.order._id, s.b.order._id, s.legacyId]) {
		expect(await s.t.run((ctx) => ctx.db.get(id))).toMatchObject({
			status: "shipped",
			lumaprintsOrderNumber: "12345",
			shipmentEmailDeliveryStatus: "sent",
		});
	}
	expect(fetch).not.toHaveBeenCalled();
});

it("rejects crossed credentials and unknown configuration before consuming a body or touching orders", async () => {
	const s = await fixture();
	const before = await s.t.run((ctx) => ctx.db.query("orders").take(5));
	for (const [reference, credentials, status] of [
		[s.b.connection.connectionRef, "client1:password1", 401],
		[s.a.connection.connectionRef, "central:central-password", 401],
		["lp_unknown_reference", "client1:password1", 503],
	] as const) {
		const incoming = request(reference, credentials, "malformed provider body");
		const response = await clientPost({ request: incoming, params: { connectionRef: reference } });
		expect(response.status).toBe(status);
		expect(incoming.bodyUsed).toBe(false);
	}
	expect((await deliver(undefined, "client1:password1")).status).toBe(401);
	expect(s.mutation).not.toHaveBeenCalled();
	expect(s.send).not.toHaveBeenCalled();
	expect(await s.t.run((ctx) => ctx.db.query("orders").take(5))).toEqual(before);
});

it("preserves delayed shipment ownership after detachment, domain change and password rotation", async () => {
	const s = await fixture();
	await s.t.run(async (ctx) => {
		await ensureTenantAliases(
			ctx,
			s.a.connection.tenantId,
			s.a.clientId,
			s.a.args.siteUrl,
			"operator",
		);
		await ensureTenantAliases(
			ctx,
			s.a.connection.tenantId,
			s.a.clientId,
			"renamed.example",
			"operator",
		);
		await ctx.db.patch(s.a.clientId, {
			lumaprintsConnectionRef: undefined,
			siteUrl: "renamed.example",
			name: "Renamed Studio",
		});
	});
	mocks.privateEnv.LUMAPRINTS_CONNECTION_CLIENT1_WEBHOOK_PASSWORD = "rotated-password";
	mocks.privateEnv.LUMAPRINTS_CONNECTION_CLIENT1_WEBHOOK_PASSWORD_PREVIOUS = "password1";
	expect((await deliver(s.a.connection.connectionRef)).status).toBe(200);
	expect(s.send.mock.calls[0]?.[0]).toMatchObject({
		to: [s.a.args.customerEmail],
		subject: expect.stringContaining("Renamed Studio"),
		text: expect.stringContaining("https://renamed.example/orders"),
	});
	expect(
		(await s.t.run((ctx) => ctx.db.get(s.b.order._id)))?.shipmentEmailDeliveryStatus,
	).toBeUndefined();
});

it("releases a failed send with its saved context and retries the same email key", async () => {
	const s = await fixture();
	s.send.mockRejectedValueOnce(new Error("synthetic transport failure"));
	expect((await deliver(s.a.connection.connectionRef)).status).toBe(502);
	expect(await s.t.run((ctx) => ctx.db.get(s.a.order._id))).toMatchObject({
		shipmentEmailDeliveryStatus: "failed",
		shipmentEmailDeliveryError: "email_delivery_failed",
	});
	expect((await deliver(s.a.connection.connectionRef)).status).toBe(200);
	expect(s.send).toHaveBeenCalledTimes(2);
	expect(s.send.mock.calls[0]).toEqual(s.send.mock.calls[1]);
});

it.each([
	"within_window",
	"expired_window",
])("keeps an uncertain completion retry bounded and scoped to the original supplier (%s)", async (window) => {
	const s = await fixture();
	let loseCompletion = true;
	s.mutation.mockImplementation((...parameters: Parameters<ConvexHttpClient["mutation"]>) => {
		if (
			loseCompletion &&
			getFunctionName(parameters[0]) === "orders:completeShipmentEmailNotificationV2"
		) {
			loseCompletion = false;
			return Promise.reject(new Error("synthetic checkpoint loss"));
		}
		return s.mutate(...parameters);
	});
	await expect(deliver(s.a.connection.connectionRef)).rejects.toThrow("checkpoint loss");
	expect((await deliver(s.a.connection.connectionRef)).status).toBe(503);
	vi.setSystemTime(
		Date.now() + (window === "within_window" ? 16 * 60 * 1000 : 23 * 60 * 60 * 1000),
	);
	expect(await (await deliver(s.a.connection.connectionRef)).json()).toEqual({
		received: true,
		status: window === "within_window" ? "processed" : "delivery_uncertain",
	});
	const attempts = window === "within_window" ? 2 : 1;
	expect(s.send).toHaveBeenCalledTimes(attempts);
	if (window === "within_window") expect(s.send.mock.calls[0]).toEqual(s.send.mock.calls[1]);
	expect((await deliver(s.b.connection.connectionRef, "client2:password2")).status).toBe(200);
	expect(s.send).toHaveBeenCalledTimes(attempts + 1);
	expect(await s.t.run((ctx) => ctx.db.get(s.a.order._id))).toMatchObject({
		shipmentEmailDeliveryStatus: window === "within_window" ? "sent" : "uncertain",
	});
});

it("rejects registry identity drift before receipt attachment or email", async () => {
	const s = await fixture();
	mocks.privateEnv.LUMAPRINTS_CONNECTIONS = JSON.stringify({
		version: 1,
		connections: [{ ...s.connections[0], storeId: 999 }, s.connections[1]],
	});
	await expect(deliver(s.a.connection.connectionRef)).rejects.toThrow(/ownership/);
	expect(s.send).not.toHaveBeenCalled();
	expect(
		(await s.t.run((ctx) => ctx.db.get(s.a.order._id)))?.lumaprintsOrderNumber,
	).toBeUndefined();
});

it("cannot find another connection's distinct number and rejects malformed authenticated payloads", async () => {
	const s = await fixture("67890");
	const reference = s.a.connection.connectionRef;
	const wrongNumber = request(reference, "client1:password1", {
		orderNumber: "67890",
		shipments: [{}],
	});
	expect(
		await (await clientPost({ request: wrongNumber, params: { connectionRef: reference } })).json(),
	).toEqual({ received: true, status: "unknown_order" });
	const invalid = request(reference, "client1:password1", { orderNumber: "12345", shipments: [] });
	expect(
		(await clientPost({ request: invalid, params: { connectionRef: reference } })).status,
	).toBe(400);
	expect(s.send).not.toHaveBeenCalled();
	for (const paid of [s.a, s.b])
		expect(
			(await s.t.run((ctx) => ctx.db.get(paid.order._id)))?.lumaprintsOrderNumber,
		).toBeUndefined();
});

it("refuses shared central/client credentials in both directions before order lookup", async () => {
	const s = await fixture();
	mocks.privateEnv.LUMAPRINTS_WEBHOOK_USERNAME = "client1";
	mocks.privateEnv.LUMAPRINTS_WEBHOOK_PASSWORD = "password1";
	expect((await deliver(undefined, "client1:password1")).status).toBe(503);
	expect((await deliver(s.a.connection.connectionRef)).status).toBe(503);
	expect(s.mutation).not.toHaveBeenCalled();
	expect(s.send).not.toHaveBeenCalled();
});
