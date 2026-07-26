import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getBridgeConfig: vi.fn(),
	getStripe: vi.fn(() => ({})),
	resolveTenant: vi.fn(),
}));

vi.mock("$lib/server/checkoutBridgeConfig", () => ({
	getCheckoutBridgeTenantConfig: mocks.getBridgeConfig,
}));
vi.mock("$lib/server/stripeClient", () => ({ getStripe: mocks.getStripe }));
vi.mock("$lib/server/stripeTenant", () => ({
	resolveStripeTenantForSite: mocks.resolveTenant,
}));

import { POST } from "../+server";

const unauthorized = {
	status: 401,
	body: { message: "Unauthorized checkout bridge request" },
};

function request(headers?: HeadersInit) {
	return new Request("https://angelsrest.test/api/tenant-checkout/print", {
		method: "POST",
		headers,
		body: JSON.stringify({ siteUrl: "tenant.test" }),
	});
}

async function expectUnauthorized(request: Request) {
	await expect(POST({ request } as Parameters<typeof POST>[0])).rejects.toMatchObject(unauthorized);
	expect(mocks.resolveTenant).not.toHaveBeenCalled();
	expect(mocks.getStripe).not.toHaveBeenCalled();
}

describe("tenant print checkout route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getBridgeConfig.mockReturnValue({
			secrets: ["s".repeat(32)],
			redirectOrigins: ["https://tenant.test"],
		});
	});

	it("rejects a missing signature before resolving the tenant", async () => {
		await expectUnauthorized(request());
	});

	it("rejects an invalid signature before resolving the tenant", async () => {
		await expectUnauthorized(
			request({
				"x-checkout-bridge-timestamp": String(Date.now()),
				"x-checkout-bridge-signature": "invalid",
			}),
		);
	});

	it("uses the same unauthorized response for an unknown local tenant", async () => {
		mocks.getBridgeConfig.mockReturnValueOnce(null);
		await expectUnauthorized(request());
	});
});
