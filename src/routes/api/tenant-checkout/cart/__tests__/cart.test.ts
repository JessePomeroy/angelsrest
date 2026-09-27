import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiErrorCode, apiError } from "$lib/server/apiError";

const mocks = vi.hoisted(() => ({
	getBridgeConfig: vi.fn(),
	getStripe: vi.fn(() => ({})),
	resolveTenant: vi.fn(),
	createSession: vi.fn(),
}));

vi.mock("$lib/server/checkoutBridgeConfig", () => ({
	getCheckoutBridgeTenantConfig: mocks.getBridgeConfig,
}));
vi.mock("$lib/server/stripeClient", () => ({ getStripe: mocks.getStripe }));
vi.mock("$lib/server/stripeTenant", () => ({
	resolveStripeTenantForSite: mocks.resolveTenant,
}));

vi.mock("$lib/server/tenantCartCheckout", () => ({
	createTenantCartCheckoutSession: mocks.createSession,
}));

import { POST } from "../+server";

const unauthorized = {
	status: 401,
	body: { message: "Unauthorized checkout bridge request" },
};

function request(headers?: HeadersInit) {
	return new Request("https://angelsrest.test/api/tenant-checkout/cart", {
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

describe("tenant basket checkout route", () => {
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

it("rejects an oversized streamed request before identity or Stripe resolution", async () => {
	vi.clearAllMocks();
	const oversized = new Request("https://angelsrest.test/api/tenant-checkout/cart", {
		method: "POST",
		body: new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(65 * 1024));
				controller.close();
			},
		}),
		duplex: "half",
	} as RequestInit & { duplex: "half" });
	await expect(POST({ request: oversized } as Parameters<typeof POST>[0])).rejects.toMatchObject({
		status: 413,
	});
	expect(mocks.resolveTenant).not.toHaveBeenCalled();
	expect(mocks.getStripe).not.toHaveBeenCalled();
});

describe("checkout attempt outcome projection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getBridgeConfig.mockReturnValue({
			secrets: ["s".repeat(32)],
			redirectOrigins: ["https://tenant.test"],
		});
		mocks.resolveTenant.mockResolvedValue({ siteUrl: "tenant.test" });
	});
	function signedRequest() {
		const timestamp = String(Date.now());
		const body = JSON.stringify({ siteUrl: "tenant.test" });
		const signature = createHmac("sha256", "s".repeat(32))
			.update(`${timestamp}.${body}`)
			.digest("hex");
		return request({
			"x-checkout-bridge-timestamp": timestamp,
			"x-checkout-bridge-signature": signature,
		});
	}
	it("offers a new attempt only for a confirmed durable no-session release", async () => {
		mocks.createSession.mockImplementation(() =>
			apiError(409, ApiErrorCode.CHECKOUT_ATTEMPT_REJECTED, "Rejected", {
				attemptState: "released_definite_no_session",
			}),
		);
		const response = await POST({ request: signedRequest() } as Parameters<typeof POST>[0]);
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({ code: "CHECKOUT_NEW_ATTEMPT_ALLOWED" });
	});
	it("preserves a generic uncertain conflict without adding retry permission", async () => {
		mocks.createSession.mockImplementation(() =>
			apiError(409, ApiErrorCode.CHECKOUT_ATTEMPT_REJECTED, "Unconfirmed"),
		);
		await expect(
			POST({ request: signedRequest() } as Parameters<typeof POST>[0]),
		).rejects.toMatchObject({ status: 409, body: { message: "Unconfirmed" } });
	});
});
