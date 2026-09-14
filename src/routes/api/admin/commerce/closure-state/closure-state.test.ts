import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	verify: vi.fn(),
	env: {
		WEBHOOK_SECRET: "server-only-secret",
		ORDER_PRODUCERS_STATE: "open",
		CHECKOUT_SNAPSHOT_MODE: "handle-v2",
		NEW_ORDER_CHECKOUT_CONTROL:
			'{"version":1,"tenants":[{"siteUrl":"angelsrest.online","state":"open","generation":1},{"siteUrl":"zippymiggy.com","state":"open","generation":1}]}',
	},
}));

vi.mock("$env/dynamic/private", () => ({ env: mocks.env }));
vi.mock("$lib/server/siteAdminAuthorization", () => ({
	verifySiteAdminRequest: mocks.verify,
}));

import { r4ReadPurposes, r4ReadSignatureMessage } from "$lib/server/r4ReadAuthorization";
import { GET } from "./+server";

const endpoint = "https://example.test/api/admin/commerce/closure-state";

describe("normalized commerce closure state", () => {
	beforeEach(() => {
		mocks.verify.mockReset().mockResolvedValue(true);
	});

	it("requires stored site membership", async () => {
		mocks.verify.mockResolvedValue(false);
		await expect(GET({ request: new Request(endpoint) })).rejects.toMatchObject({
			status: 401,
		});
	});

	it("accepts the distinct fresh closure-state machine purpose", async () => {
		mocks.verify.mockResolvedValue(false);
		const timestamp = String(Math.floor(Date.now() / 1_000));
		const unsigned = new Request(endpoint);
		const signature = createHmac("sha256", mocks.env.WEBHOOK_SECRET)
			.update(r4ReadSignatureMessage(unsigned, r4ReadPurposes.closureState, "", timestamp))
			.digest("hex");
		const response = await GET({
			request: new Request(endpoint, {
				headers: { "x-r4-timestamp": timestamp, "x-r4-signature": signature },
			}),
		});
		expect(response.status).toBe(200);
	});

	it("returns classes and generations without the raw registry", async () => {
		const response = await GET({ request: new Request(endpoint) });
		const text = await response.text();
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(JSON.parse(text)).toEqual({
			version: 2,
			emergencyOrderQuiescence: "open",
			newOrderCheckout: { state: "open", generation: 1, configuration: "exact" },
			firstPartyCheckout: {
				catalogProvider: "convex",
				snapshotProtocol: "handle-v2",
			},
			compatibility: {
				tenantBridgeAndIntakeSnapshotMode: "handle-v2",
			},
		});
		expect(text).not.toContain("zippymiggy.com");
		expect(text).not.toContain("tenants");
	});
});
