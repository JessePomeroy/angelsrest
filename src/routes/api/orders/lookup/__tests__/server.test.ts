import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	convexQuery: vi.fn(),
	verifyTurnstileToken: vi.fn(),
	env: { ORDER_LOOKUP_SECRET: "test-order-lookup-secret" as string | undefined },
}));

vi.mock("$lib/server/convexClient", () => ({
	getConvex: () => ({ query: mocks.convexQuery }),
}));

vi.mock("$convex/api", () => ({
	api: {
		orders: { lookupForCustomer: "orders.lookupForCustomer" },
	},
}));

vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));

vi.mock("$lib/server/turnstile", () => ({
	verifyTurnstileToken: mocks.verifyTurnstileToken,
}));

vi.mock("$lib/config/site", () => ({
	SITE_DOMAIN: "angelsrest.online",
}));

import { fallback, POST } from "../+server";

function postRequest(body: unknown) {
	return {
		request: new Request("https://angelsrest.test/api/orders/lookup", {
			method: "POST",
			body: JSON.stringify(body),
		}),
		getClientAddress: () => "203.0.113.4",
	};
}

describe("order lookup API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.env.ORDER_LOOKUP_SECRET = "test-order-lookup-secret";
		mocks.verifyTurnstileToken.mockResolvedValue({ success: true });
	});

	it("rejects non-POST lookups so email is not accepted in URLs", async () => {
		const response = fallback();

		await expect(response.json()).resolves.toEqual({ error: "Use POST to look up orders" });
		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("POST");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(mocks.convexQuery).not.toHaveBeenCalled();
	});

	it("looks up orders from POST body email and order number", async () => {
		mocks.convexQuery.mockResolvedValue({
			orderNumber: "ORD-001",
			status: "shipped",
		});

		const response = await POST(
			postRequest({
				email: " Buyer@Example.com ",
				orderNumber: " ORD-001 ",
				"cf-turnstile-response": "challenge-token",
			}) as never,
		);

		await expect(response.json()).resolves.toEqual({
			order: { orderNumber: "ORD-001", status: "shipped" },
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(mocks.verifyTurnstileToken).toHaveBeenCalledWith({
			token: "challenge-token",
			remoteIp: "203.0.113.4",
		});
		expect(mocks.convexQuery).toHaveBeenCalledWith("orders.lookupForCustomer", {
			siteUrl: "angelsrest.online",
			email: "buyer@example.com",
			orderNumber: "ORD-001",
			lookupSecret: "test-order-lookup-secret",
		});
	});

	it("rejects malformed POST bodies before querying Convex", async () => {
		const response = await POST(
			postRequest({ email: "not-an-email", orderNumber: "ORD-001" }) as never,
		);

		await expect(response.json()).resolves.toEqual({ error: "Invalid email" });
		expect(response.status).toBe(400);
		expect(mocks.verifyTurnstileToken).not.toHaveBeenCalled();
		expect(mocks.convexQuery).not.toHaveBeenCalled();
	});

	it.each([
		[{ success: false, reason: "missing" }, 403],
		[{ success: false, reason: "rejected" }, 403],
		[{ success: false, reason: "unavailable" }, 503],
	] as const)("fails closed when challenge verification returns %j", async (verification, status) => {
		mocks.verifyTurnstileToken.mockResolvedValue(verification);

		const response = await POST(
			postRequest({ email: "buyer@example.com", orderNumber: "ORD-001" }) as never,
		);

		await expect(response.json()).resolves.toEqual({ error: "Verification failed" });
		expect(response.status).toBe(status);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(mocks.convexQuery).not.toHaveBeenCalled();
	});

	it("fails closed after verification when the server capability is missing", async () => {
		mocks.env.ORDER_LOOKUP_SECRET = undefined;

		const response = await POST(
			postRequest({
				email: "buyer@example.com",
				orderNumber: "ORD-001",
				"cf-turnstile-response": "challenge-token",
			}) as never,
		);

		await expect(response.json()).resolves.toEqual({
			error: "Order lookup is temporarily unavailable",
		});
		expect(response.status).toBe(503);
		expect(mocks.convexQuery).not.toHaveBeenCalled();
	});
});
