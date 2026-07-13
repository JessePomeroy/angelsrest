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
			claimShipmentEmailNotificationByOrderNumber: "orders.claimGlobal",
			recordShipmentEmailDeliveryByOrderNumber: "orders.recordGlobal",
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
				orderNumber: "LP-123",
				shipments: [{ carrier: "FedEx", trackingNumber: "TRACK-1" }],
			},
		),
	});
}

describe("hub LumaPrints webhook", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.env.LUMAPRINTS_WEBHOOK_USERNAME = "lumaprints";
		mocks.env.LUMAPRINTS_WEBHOOK_PASSWORD = "provider-password";
		mocks.env.LUMAPRINTS_WEBHOOK_PASSWORD_PREVIOUS = undefined;
		mocks.env.WEBHOOK_SECRET = "convex-secret";
		mocks.mutation.mockImplementation((reference) => {
			if (reference === "orders.claimGlobal") {
				return Promise.resolve({
					claimed: true,
					order: {
						siteUrl: "tenant.example",
						orderNumber: "ORD-001",
						customerEmail: "buyer@example.com",
					},
				});
			}
			return Promise.resolve({ recorded: true });
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
		expect(mocks.mutation).toHaveBeenNthCalledWith(1, "orders.claimGlobal", {
			webhookSecret: "convex-secret",
			lumaprintsOrderNumber: "LP-123",
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
				carrier: "FedEx",
				notificationProfile: expect.objectContaining({ siteName: "Tenant Studio" }),
			}),
		);
		expect(mocks.mutation).toHaveBeenNthCalledWith(2, "orders.recordGlobal", {
			webhookSecret: "convex-secret",
			lumaprintsOrderNumber: "LP-123",
			status: "sent",
			error: undefined,
		});
	});

	it("rejects the legacy nested payload instead of silently acknowledging it", async () => {
		const response = await POST({
			request: request({ body: { event: "shipment.created", data: { orderNumber: "LP-123" } } }),
		});
		expect(response.status).toBe(400);
		expect(mocks.mutation).not.toHaveBeenCalled();
	});
});
