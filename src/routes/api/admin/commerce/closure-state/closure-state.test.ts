import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	verify: vi.fn(),
	env: {
		ORDER_PRODUCERS_STATE: "open",
		CHECKOUT_SNAPSHOT_MODE: "handle-v2",
		CHECKOUT_CATALOG_PROVIDER: "convex",
		NEW_ORDER_CHECKOUT_CONTROL:
			'{"version":1,"tenants":[{"siteUrl":"angelsrest.online","state":"open","generation":1},{"siteUrl":"zippymiggy.com","state":"open","generation":1}]}',
	},
}));

vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/siteAdminAuthorization", () => ({
	verifySiteAdminRequest: mocks.verify,
}));

import { GET } from "./+server";

describe("normalized commerce closure state", () => {
	beforeEach(() => {
		mocks.verify.mockReset().mockResolvedValue(true);
	});

	it("requires stored site membership", async () => {
		mocks.verify.mockResolvedValue(false);
		await expect(GET({ request: new Request("https://example.test") })).rejects.toMatchObject({
			status: 401,
		});
	});

	it("returns classes and generations without the raw registry", async () => {
		const response = await GET({ request: new Request("https://example.test") });
		const text = await response.text();
		expect(JSON.parse(text)).toEqual({
			version: 1,
			emergencyOrderQuiescence: "open",
			newOrderCheckout: { state: "open", generation: 1, configuration: "exact" },
			checkoutSnapshotMode: "handle-v2",
			checkoutCatalogProvider: "convex",
		});
		expect(text).not.toContain("zippymiggy.com");
		expect(text).not.toContain("tenants");
	});
});
