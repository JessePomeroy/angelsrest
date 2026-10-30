import { createHmac } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	retrieve: vi.fn(),
	items: vi.fn(),
	tenant: vi.fn(),
	config: vi.fn(),
}));
vi.mock("$lib/server/checkoutBridgeConfig", () => ({
	getCheckoutBridgeTenantConfig: mocks.config,
}));
vi.mock("$lib/server/stripeTenant", () => ({ resolveStripeTenantForSite: mocks.tenant }));
vi.mock("$lib/server/stripeClient", () => ({
	getStripe: () => ({
		checkout: { sessions: { retrieve: mocks.retrieve, listLineItems: mocks.items } },
	}),
}));

import { POST } from "../+server";

const secret = "synthetic-bridge-confirmation-credential-123";
function request(valid = true) {
	const timestamp = Date.now();
	const body = JSON.stringify({ siteUrl: "fixture.example", sessionId: "cs_test_buyer" });
	const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
	return new Request("https://hub.example/api/tenant-checkout/confirmation", {
		method: "POST",
		headers: {
			"x-checkout-bridge-timestamp": String(timestamp),
			"x-checkout-bridge-signature": valid ? signature : "invalid",
		},
		body,
	});
}
beforeEach(() => {
	vi.resetAllMocks();
	mocks.config.mockReturnValue({ secrets: [secret] });
	mocks.tenant.mockResolvedValue({
		siteUrl: "fixture.example",
		tenantId: "tenant-fixture",
		stripeConnectedAccountId: "acct_fixture",
	});
	mocks.retrieve.mockResolvedValue({
		id: "cs_test_buyer",
		metadata: { commerceTenantSiteUrl: "fixture.example", commerceTenantId: "tenant-fixture" },
		payment_status: "paid",
		amount_total: 30000,
		currency: "usd",
		customer_details: { email: "private@example.test" },
	});
	mocks.items.mockResolvedValue({
		has_more: false,
		data: [{ description: "Portrait print", quantity: 1, amount_total: 30000 }],
	});
});
test("a confirmation read requires the tenant bridge signature", async () => {
	await expect(POST({ request: request(false) })).rejects.toMatchObject({ status: 401 });
	expect(mocks.retrieve).not.toHaveBeenCalled();
});
test("a verified read is scoped to the connected account and returns no customer PII", async () => {
	const result = await POST({ request: request() });
	expect(mocks.retrieve).toHaveBeenCalledWith(
		"cs_test_buyer",
		{},
		{ stripeAccount: "acct_fixture" },
	);
	expect(await result.json()).toEqual({
		paymentStatus: "paid",
		amountTotal: 30000,
		currency: "usd",
		items: [{ description: "Portrait print", quantity: 1, amount: 30000 }],
	});
});
test("another tenant's Stripe session cannot be disclosed", async () => {
	mocks.retrieve.mockResolvedValue({ metadata: { commerceTenantSiteUrl: "another.example" } });
	await expect(POST({ request: request() })).rejects.toMatchObject({ status: 503 });
	expect(mocks.items).not.toHaveBeenCalled();
});
