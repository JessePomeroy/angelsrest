import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	env: {
		LUMAPRINTS_WEBHOOK_USERNAME: "lumaprints" as string | undefined,
		LUMAPRINTS_WEBHOOK_PASSWORD: "provider-password" as string | undefined,
		LUMAPRINTS_WEBHOOK_PASSWORD_PREVIOUS: undefined as string | undefined,
		WEBHOOK_SECRET: "convex-secret" as string | undefined,
	},
	mutation: vi.fn(),
	query: vi.fn(),
	sendNotification: vi.fn(),
}));

vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/convexClient", () => ({
	getConvex: () => ({ mutation: mocks.mutation, query: mocks.query }),
}));
vi.mock("$lib/server/resendClient", () => ({ getResend: () => ({}) }));
vi.mock("$lib/server/webhookEmails", () => ({
	sendCustomerShipmentNotification: mocks.sendNotification,
}));
vi.mock("$lib/config/site", () => ({ SITE_DOMAIN: "angelsrest.online" }));
vi.mock("$lib/server/commerceTenant", () => ({
	ANGELS_REST_COMMERCE_PROFILE: {
		siteName: "Angel's Rest",
		siteUrl: "angelsrest.online",
		adminEmail: "admin@angelsrest.online",
	},
}));
vi.mock("$convex/api", () => ({
	api: {
		orders: {
			claimShipmentEmailNotificationV2: "orders.claimV2",
			completeShipmentEmailNotificationV2: "orders.completeV2",
			releaseShipmentEmailNotificationV2: "orders.releaseV2",
		},
		platform: { getCommerceProfileForSite: "platform.getCommerceProfile" },
	},
}));

import { POST } from "./+server";

function request(options: { authorization?: string; body?: unknown } = {}) {
	const authorization =
		options.authorization ??
		`Basic ${Buffer.from("lumaprints:provider-password").toString("base64")}`;
	return new Request("https://www.angelsrest.online/api/webhooks/lumaprints", {
		method: "POST",
		headers: { authorization, "content-type": "application/json" },
		body: JSON.stringify(
			options.body ?? {
				orderNumber: "123",
				shipments: [{ carrier: "FedEx", trackingNumber: "TRACK-1" }],
			},
		),
	});
}

function streamingRequest(body: ReadableStream<Uint8Array>) {
	return new Request("https://www.angelsrest.online/api/webhooks/lumaprints", {
		method: "POST",
		headers: {
			authorization: `Basic ${Buffer.from("lumaprints:provider-password").toString("base64")}`,
			"content-type": "application/json",
		},
		body,
		duplex: "half",
	} as RequestInit & { duplex: "half" });
}

describe("hub LumaPrints webhook", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.env.LUMAPRINTS_WEBHOOK_USERNAME = "lumaprints";
		mocks.env.LUMAPRINTS_WEBHOOK_PASSWORD = "provider-password";
		mocks.env.LUMAPRINTS_WEBHOOK_PASSWORD_PREVIOUS = undefined;
		mocks.env.WEBHOOK_SECRET = "convex-secret";
		mocks.mutation.mockImplementation((reference) => {
			if (reference === "orders.claimV2") {
				return Promise.resolve({
					kind: "claimed",
					leaseExpiresAt: Date.now() + 60_000,
					order: {
						_id: "order-id",
						siteUrl: "tenant.example",
						orderNumber: "ORD-001",
						customerEmail: "buyer@example.com",
					},
				});
			}
			return Promise.resolve(true);
		});
		mocks.query.mockResolvedValue({
			siteName: "Tenant Studio",
			siteUrl: "tenant.example",
			adminEmail: "owner@tenant.example",
		});
		mocks.sendNotification.mockResolvedValue(undefined);
	});

	it("fails closed before parsing or side effects when Basic auth is wrong", async () => {
		const response = await POST({ request: request({ authorization: "Basic bad" }) });
		expect(response.status).toBe(401);
		expect(response.headers.get("www-authenticate")).toContain("Basic");
		expect(mocks.mutation).not.toHaveBeenCalled();
	});

	it("fails closed when either provider or Convex server authentication is missing", async () => {
		mocks.env.WEBHOOK_SECRET = undefined;
		const response = await POST({ request: request() });
		expect(response.status).toBe(503);
		expect(mocks.mutation).not.toHaveBeenCalled();
	});

	it("accepts the previous password during a configured rotation window", async () => {
		mocks.env.LUMAPRINTS_WEBHOOK_PASSWORD = "new-provider-password";
		mocks.env.LUMAPRINTS_WEBHOOK_PASSWORD_PREVIOUS = "provider-password";
		const response = await POST({ request: request() });
		expect(response.status).toBe(200);
		expect(mocks.mutation).toHaveBeenCalled();
	});

	it("claims by provider-global number and sends with the resolved tenant identity", async () => {
		const response = await POST({ request: request() });

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ received: true, status: "processed" });
		expect(mocks.mutation).toHaveBeenNthCalledWith(1, "orders.claimV2", {
			webhookSecret: "convex-secret",
			lumaprintsOrderNumber: "123",
			claimToken: expect.any(String),
			trackingNumber: "TRACK-1",
		});
		expect(mocks.query).toHaveBeenCalledWith("platform.getCommerceProfile", {
			siteUrl: "tenant.example",
			webhookSecret: "convex-secret",
		});
		expect(mocks.sendNotification).toHaveBeenCalledWith(
			{},
			expect.objectContaining({
				customerEmail: "buyer@example.com",
				orderNumber: "ORD-001",
				lumaprintsOrderNumber: "123",
				carrier: "FedEx",
				notificationProfile: expect.objectContaining({ siteName: "Tenant Studio" }),
			}),
		);
		expect(mocks.mutation).toHaveBeenNthCalledWith(2, "orders.completeV2", {
			webhookSecret: "convex-secret",
			orderId: "order-id",
			lumaprintsOrderNumber: "123",
			claimToken: expect.any(String),
			deliveryStatus: "sent",
		});
	});

	it("returns retryable non-2xx while another shipment-email lease is active", async () => {
		mocks.mutation.mockImplementation((reference) =>
			reference === "orders.claimV2"
				? Promise.resolve({ kind: "busy", leaseExpiresAt: Date.now() + 30_000 })
				: Promise.resolve(true),
		);

		const response = await POST({ request: request() });
		expect(response.status).toBe(503);
		expect(response.headers.get("retry-after")).toBeTruthy();
		await expect(response.json()).resolves.toEqual({ received: false, status: "busy" });
		expect(mocks.sendNotification).not.toHaveBeenCalled();
		expect(mocks.mutation).toHaveBeenCalledTimes(1);
	});

	it("releases send failures with a bounded code and requests provider retry", async () => {
		mocks.sendNotification.mockRejectedValue(new Error("private Resend response"));

		const response = await POST({ request: request() });
		expect(response.status).toBe(502);
		await expect(response.json()).resolves.toEqual({
			received: false,
			status: "retryable_failure",
		});
		expect(mocks.mutation).toHaveBeenNthCalledWith(2, "orders.releaseV2", {
			webhookSecret: "convex-secret",
			orderId: "order-id",
			lumaprintsOrderNumber: "123",
			claimToken: expect.any(String),
			failureCode: "email_delivery_failed",
		});
		expect(JSON.stringify(mocks.mutation.mock.calls)).not.toContain("private Resend response");
	});

	it("releases the exact lease with a bounded code when profile resolution fails", async () => {
		mocks.query.mockRejectedValue(new Error("private tenant profile response"));

		const response = await POST({ request: request() });
		const claimToken = mocks.mutation.mock.calls[0]?.[1]?.claimToken;

		expect(response.status).toBe(502);
		await expect(response.json()).resolves.toEqual({
			received: false,
			status: "retryable_failure",
		});
		expect(claimToken).toEqual(expect.any(String));
		expect(mocks.mutation.mock.calls).toEqual([
			[
				"orders.claimV2",
				{
					webhookSecret: "convex-secret",
					lumaprintsOrderNumber: "123",
					claimToken,
					trackingNumber: "TRACK-1",
				},
			],
			[
				"orders.releaseV2",
				{
					webhookSecret: "convex-secret",
					orderId: "order-id",
					lumaprintsOrderNumber: "123",
					claimToken,
					failureCode: "notification_profile_unavailable",
				},
			],
		]);
		expect(JSON.stringify(mocks.mutation.mock.calls)).not.toContain(
			"private tenant profile response",
		);
		expect(mocks.sendNotification).not.toHaveBeenCalled();
	});

	it("returns non-2xx after a successful send when durable completion crashes", async () => {
		mocks.mutation.mockImplementation((reference) => {
			if (reference === "orders.claimV2") {
				return Promise.resolve({
					kind: "claimed",
					leaseExpiresAt: Date.now() + 60_000,
					order: {
						_id: "order-id",
						siteUrl: "tenant.example",
						orderNumber: "ORD-001",
						customerEmail: "buyer@example.com",
					},
				});
			}
			if (reference === "orders.completeV2") return Promise.reject(new Error("Convex crashed"));
			return Promise.resolve(true);
		});

		await expect(POST({ request: request() })).rejects.toThrow("Convex crashed");
		expect(mocks.sendNotification).toHaveBeenCalledOnce();
		expect(mocks.mutation).not.toHaveBeenCalledWith("orders.releaseV2", expect.anything());
	});

	it("rejects a non-canonical provider order number before Convex lookup", async () => {
		const response = await POST({
			request: request({ body: { orderNumber: "01", shipments: [{}] } }),
		});
		expect(response.status).toBe(400);
		expect(mocks.mutation).not.toHaveBeenCalled();
	});

	it("returns 413 for a chunked body that crosses the streaming byte bound", async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(200 * 1024));
				controller.enqueue(new Uint8Array(60 * 1024));
				controller.close();
			},
		});
		const response = await POST({ request: streamingRequest(body) });
		expect(response.status).toBe(413);
		expect(mocks.mutation).not.toHaveBeenCalled();
	});

	it("rejects the legacy nested payload instead of silently acknowledging it", async () => {
		const response = await POST({
			request: request({ body: { event: "shipment.created", data: { orderNumber: "123" } } }),
		});
		expect(response.status).toBe(400);
		expect(mocks.mutation).not.toHaveBeenCalled();
	});
});
