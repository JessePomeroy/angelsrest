import { error } from "@sveltejs/kit";
import { ConvexError } from "convex/values";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	access: vi.fn(),
	mutation: vi.fn(),
	password: vi.fn(),
}));
vi.mock("$lib/server/adminAuth", () => ({ requireAuthWithIdentity: mocks.auth }));
vi.mock("$lib/server/siteAdminAuthorization", () => ({ getSiteAdminAccess: mocks.access }));
vi.mock("$lib/server/convexClient", () => ({
	createAuthenticatedConvexClient: () => ({ mutation: mocks.mutation }),
}));
vi.mock("$lib/server/temporaryPassword", () => ({ createTemporaryPassword: mocks.password }));
vi.mock("$lib/config/admin", () => ({ adminConfig: { siteUrl: "angelsrest.online" } }));

import { POST } from "./+server";

const input = {
	name: "Cedar Finch",
	email: "owner@cedar.example",
	siteUrl: "https://www.cedar.example/",
	tier: "basic",
};
function request(body: unknown = input, origin = "https://angelsrest.online") {
	return {
		cookies: {},
		url: new URL("https://angelsrest.online/api/admin/platform-clients"),
		request: new Request("https://angelsrest.online/api/admin/platform-clients", {
			method: "POST",
			headers: { origin, "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	} as Parameters<typeof POST>[0];
}
beforeEach(() => {
	vi.resetAllMocks();
	mocks.auth.mockResolvedValue({
		token: "operator-token",
		identity: { email: "operator@example.invalid" },
	});
	mocks.access.mockResolvedValue({ authorized: true });
	mocks.password.mockResolvedValue({ password: "fixture-password", passwordHash: "fixture-hash" });
	mocks.mutation.mockResolvedValue({ clientId: "client", passwordCreated: true });
});
it("returns the generated password once, sends only its hash to Convex and forbids caching", async () => {
	const response = await POST(request({ ...input, password: "browser-chosen", role: "creator" }));
	expect(response.status).toBe(200);
	expect(response.headers.get("cache-control")).toBe("private, no-store");
	expect(await response.json()).toEqual({
		email: input.email,
		temporaryPassword: "fixture-password",
	});
	expect(mocks.mutation.mock.calls[0][1]).toEqual({
		name: input.name,
		email: input.email,
		siteUrl: "cedar.example",
		tier: "basic",
		passwordHash: "fixture-hash",
	});
});
it("does not return an unused password for an existing login", async () => {
	mocks.mutation.mockResolvedValue({ clientId: "client", passwordCreated: false });
	expect(await (await POST(request())).json()).toEqual({
		email: input.email,
		temporaryPassword: null,
	});
});
it("rejects cross-origin, unauthenticated and unauthorized requests before generating credentials", async () => {
	expect((await POST(request(input, "https://attacker.example"))).status).toBe(403);
	mocks.auth.mockImplementationOnce(() => error(401, "Sign in"));
	expect((await POST(request())).status).toBe(401);
	mocks.access.mockResolvedValue({ authorized: false });
	expect((await POST(request())).status).toBe(403);
	expect(mocks.password).not.toHaveBeenCalled();
	expect(mocks.mutation).not.toHaveBeenCalled();
});
it("rejects invalid form details and translates duplicate websites without exposing credentials", async () => {
	expect((await POST(request({ ...input, tier: "creator" }))).status).toBe(400);
	mocks.mutation.mockRejectedValue(new ConvexError("PLATFORM_CLIENT_SITE_IN_USE"));
	const response = await POST(request());
	expect(response.status).toBe(409);
	expect(await response.json()).toEqual({ error: "PLATFORM_CLIENT_SITE_IN_USE" });
});
it("does not expose backend exception details on an uncertain result", async () => {
	mocks.mutation.mockRejectedValue(new Error("sensitive-provider-detail"));
	const response = await POST(request());
	expect(response.status).toBe(500);
	expect(await response.text()).not.toContain("sensitive-provider-detail");
});

it("explains a rejected unverified login without returning credentials", async () => {
	mocks.mutation.mockRejectedValue(new ConvexError("PLATFORM_CLIENT_LOGIN_UNVERIFIED"));
	const response = await POST(request());
	expect(response.status).toBe(409);
	expect(await response.json()).toEqual({ error: "PLATFORM_CLIENT_LOGIN_UNVERIFIED" });
});
