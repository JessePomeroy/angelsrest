import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	query: vi.fn(),
	mutation: vi.fn(),
	create: vi.fn(),
	retrieve: vi.fn(),
	balance: vi.fn(),
	link: vi.fn(),
}));

vi.mock("$lib/server/adminAuth", () => ({ requireAuth: mocks.auth }));
vi.mock("$lib/server/convexClient", () => ({
	createAuthenticatedConvexClient: () => ({ query: mocks.query, mutation: mocks.mutation }),
}));
vi.mock("$lib/server/runtimeConfig", () => ({ getPublicSiteOrigin: () => "https://hub.example" }));
vi.mock("$lib/server/stripeClient", () => ({
	getStripe: () => ({
		accounts: { create: mocks.create, retrieve: mocks.retrieve },
		balance: { retrieve: mocks.balance },
		accountLinks: { create: mocks.link },
	}),
}));

import { POST } from "./+server";

function call(body: string) {
	return POST({
		request: new Request("https://hub.example/api/stripe-connect/onboard", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
		}),
	} as Parameters<typeof POST>[0]);
}

describe("Stripe onboarding request boundary", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.auth.mockResolvedValue("session-token");
	});

	it("requires a session before reading the client or contacting Stripe", async () => {
		mocks.auth.mockRejectedValueOnce(new Error("unauthenticated"));
		await expect(call('{"siteUrl":"client.example"}')).rejects.toThrow("unauthenticated");
		expect(mocks.query).not.toHaveBeenCalled();
		expect(mocks.retrieve).not.toHaveBeenCalled();
	});

	it("requires creator authorization before contacting Stripe", async () => {
		mocks.query.mockRejectedValueOnce(new Error("not a creator"));
		await expect(call('{"siteUrl":"client.example"}')).rejects.toThrow("not a creator");
		expect(mocks.retrieve).not.toHaveBeenCalled();
		expect(mocks.balance).not.toHaveBeenCalled();
		expect(mocks.create).not.toHaveBeenCalled();
	});

	it.each([
		"{",
		"null",
		"[]",
		"{}",
		'{"siteUrl":17}',
	])("rejects malformed input before client/provider access: %s", async (body) => {
		expect((await call(body)).status).toBe(400);
		expect(mocks.query).not.toHaveBeenCalled();
		expect(mocks.create).not.toHaveBeenCalled();
	});

	it("persists through hub-authorized mutations and keeps the link response private", async () => {
		const platformAccountId = "acct_platform1234567890";
		const accountId = "acct_client12345678901";
		const prepared = {
			clientId: "test-client-id",
			tenantId: "test-tenant-id",
			stripeConnectedAccountId: null,
			attempt: {
				id: "test-attempt",
				model: "full-v1",
				startedAt: Date.now(),
				email: "owner@example.com",
				siteUrl: "client.example",
				platformAccountId,
				livemode: false,
			},
		};
		mocks.query.mockResolvedValue({ ...prepared, siteUrl: "client.example" });
		mocks.retrieve.mockResolvedValue({ id: platformAccountId });
		mocks.balance.mockResolvedValue({ livemode: false });
		mocks.mutation
			.mockResolvedValueOnce(prepared)
			.mockResolvedValueOnce({ stripeConnectedAccountId: accountId });
		mocks.create.mockResolvedValue({
			id: accountId,
			controller: {
				fees: { payer: "account" },
				losses: { payments: "stripe" },
				requirement_collection: "stripe",
				stripe_dashboard: { type: "full" },
			},
			metadata: {
				platformClientId: prepared.clientId,
				commerceTenantId: prepared.tenantId,
				stripeConnectAttemptId: prepared.attempt.id,
			},
			charges_enabled: false,
			payouts_enabled: false,
			details_submitted: false,
		});
		mocks.link.mockResolvedValue({ url: "https://connect.stripe.test/private-link" });
		const response = await call('{"siteUrl":"client.example"}');
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		const body = await response.text();
		expect(body).toContain("setup_required");
		expect(body).not.toContain("test-webhook-secret");
		for (const call of mocks.mutation.mock.calls) {
			expect(call[1]).toMatchObject({
				webhookSecret: "test-webhook-secret",
				clientId: prepared.clientId,
				platformAccountId,
				livemode: false,
			});
		}
		expect(mocks.mutation).toHaveBeenCalledTimes(2);
	});
});
