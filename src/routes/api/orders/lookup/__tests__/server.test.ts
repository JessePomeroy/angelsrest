import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	convexQuery: vi.fn(),
}));

vi.mock("$lib/server/convexClient", () => ({
	getConvex: () => ({ query: mocks.convexQuery }),
}));

vi.mock("$convex/api", () => ({
	api: {
		orders: { lookup: "orders.lookup" },
	},
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
	};
}

describe("order lookup API", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects non-POST lookups so email is not accepted in URLs", async () => {
		const response = fallback();

		await expect(response.json()).resolves.toEqual({ error: "Use POST to look up orders" });
		expect(response.status).toBe(405);
		expect(response.headers.get("allow")).toBe("POST");
		expect(mocks.convexQuery).not.toHaveBeenCalled();
	});

	it("looks up orders from POST body email and order number", async () => {
		mocks.convexQuery.mockResolvedValue({
			orderNumber: "ORD-001",
			status: "shipped",
		});

		const response = await POST(
			postRequest({ email: "buyer@example.com", orderNumber: "ORD-001" }) as never,
		);

		await expect(response.json()).resolves.toEqual({
			order: { orderNumber: "ORD-001", status: "shipped" },
		});
		expect(response.status).toBe(200);
		expect(mocks.convexQuery).toHaveBeenCalledWith("orders.lookup", {
			siteUrl: "angelsrest.online",
			email: "buyer@example.com",
			orderNumber: "ORD-001",
		});
	});

	it("rejects malformed POST bodies before querying Convex", async () => {
		const response = await POST(
			postRequest({ email: "not-an-email", orderNumber: "ORD-001" }) as never,
		);

		await expect(response.json()).resolves.toEqual({ error: "Invalid email" });
		expect(response.status).toBe(400);
		expect(mocks.convexQuery).not.toHaveBeenCalled();
	});
});
