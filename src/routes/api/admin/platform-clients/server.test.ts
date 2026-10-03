import { error, type RequestEvent } from "@sveltejs/kit";
import { ConvexError } from "convex/values";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	access: vi.fn(),
	query: vi.fn(),
	mutation: vi.fn(),
	password: vi.fn(),
}));
vi.mock("$lib/server/adminAuth", () => ({ requireAuthWithIdentity: mocks.auth }));
vi.mock("$lib/server/siteAdminAuthorization", () => ({ getSiteAdminAccess: mocks.access }));
vi.mock("$lib/server/convexClient", () => ({
	createAuthenticatedConvexClient: () => ({ query: mocks.query, mutation: mocks.mutation }),
}));
vi.mock("$lib/server/temporaryPassword", () => ({ createTemporaryPassword: mocks.password }));
vi.mock("$lib/config/admin", () => ({ adminConfig: { siteUrl: "angelsrest.online" } }));
vi.mock("$env/dynamic/public", () => ({
	env: {
		PUBLIC_CONVEX_URL: "https://fixture.convex.cloud",
		PUBLIC_CONVEX_SITE_URL: "https://fixture.convex.site",
	},
}));

import { POST } from "./+server";
import { POST as STATUS } from "./status/+server";

const input = {
	name: "Cedar Finch",
	email: "owner@cedar.example",
	siteUrl: "https://www.cedar.example/",
	tier: "basic",
};
const absent = { kind: "absent", siteUrl: "cedar.example" };
const matching = {
	kind: "matching",
	siteUrl: "cedar.example",
	clientId: "client",
	tenantId: "tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b",
};
const plan = {
	version: 1,
	kind: "client-setup",
	identity: {
		repository: "operator/cedar",
		siteUrl: "cedar.example",
		expectedTenantId: null,
		environmentId: "staging",
		sourceRevision: "a".repeat(40),
		sourceFingerprint: "b".repeat(64),
		contractFingerprint: "c".repeat(64),
	},
	target: {
		publicOrigin: "https://stage.cedar.example",
		convexUrl: "https://fixture.convex.cloud",
		convexSiteUrl: "https://fixture.convex.site",
	},
};
type SetupRouteId = "/api/admin/platform-clients" | "/api/admin/platform-clients/status";
function request<RouteId extends SetupRouteId>(
	routeId: RouteId,
	body: unknown = input,
	origin = "https://angelsrest.online",
): RequestEvent<Record<string, never>, RouteId> {
	const url = new URL(routeId, "https://angelsrest.online");
	return {
		cookies: { get: vi.fn(), getAll: () => [], set: vi.fn(), delete: vi.fn(), serialize: () => "" },
		fetch: async () => {
			throw new Error("Unexpected external request");
		},
		getClientAddress: () => "127.0.0.1",
		locals: {},
		params: {},
		platform: undefined,
		route: { id: routeId },
		setHeaders: vi.fn(),
		url,
		isDataRequest: false,
		isSubRequest: false,
		isRemoteRequest: false,
		get tracing(): never {
			throw new Error("Tracing is outside this handler fixture");
		},
		request: new Request(url, {
			method: "POST",
			headers: { origin, "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	};
}
function create(body: unknown = input, origin?: string) {
	return POST(request("/api/admin/platform-clients", body, origin));
}
function status(body: unknown = input, origin?: string) {
	return STATUS(request("/api/admin/platform-clients/status", body, origin));
}
beforeEach(() => {
	vi.resetAllMocks();
	mocks.auth.mockResolvedValue({
		token: "operator-token",
		identity: { email: "operator@example.invalid" },
	});
	mocks.access.mockResolvedValue({ authorized: true });
	mocks.query.mockResolvedValue(absent);
	mocks.password.mockResolvedValue({ password: "fixture-password", passwordHash: "fixture-hash" });
	mocks.mutation.mockResolvedValue({ clientId: "client", passwordCreated: true });
});
it("checks first, returns the password only with its successful creation and forbids caching", async () => {
	const response = await create({ ...input, password: "browser-chosen", role: "creator" });
	expect(response.status).toBe(200);
	expect(response.headers.get("cache-control")).toBe("private, no-store");
	expect(response.headers.get("referrer-policy")).toBe("no-referrer");
	expect(await response.json()).toEqual({
		kind: "created",
		email: input.email,
		temporaryPassword: "fixture-password",
	});
	expect(mocks.query.mock.calls[0][1]).toEqual({ ...input, siteUrl: "cedar.example" });
	expect(mocks.query.mock.invocationCallOrder[0]).toBeLessThan(
		mocks.password.mock.invocationCallOrder[0],
	);
	expect(mocks.mutation.mock.calls[0][1]).toEqual({
		...input,
		siteUrl: "cedar.example",
		passwordHash: "fixture-hash",
	});
});
it("does not return an unused password for an existing login", async () => {
	mocks.mutation.mockResolvedValue({ clientId: "client", passwordCreated: false });
	expect(await (await create()).json()).toEqual({
		kind: "created",
		email: input.email,
		temporaryPassword: null,
	});
});
it("rejects cross-origin, unauthenticated and unauthorized reads and writes before querying or generating credentials", async () => {
	for (const handler of [create, status]) {
		expect((await handler(input, "https://attacker.example")).status).toBe(403);
		mocks.auth.mockImplementationOnce(() => error(401, "Sign in"));
		expect((await handler()).status).toBe(401);
		mocks.access.mockResolvedValueOnce({ authorized: false });
		expect((await handler()).status).toBe(403);
	}
	expect(mocks.query).not.toHaveBeenCalled();
	expect(mocks.password).not.toHaveBeenCalled();
	expect(mocks.mutation).not.toHaveBeenCalled();
});
it("reads exact normalized identity and returns no credentials", async () => {
	mocks.query.mockResolvedValue(matching);
	const response = await status();
	expect(await response.json()).toEqual(matching);
	expect(response.headers.get("cache-control")).toBe("private, no-store");
	expect(mocks.query.mock.calls[0][1]).toEqual({ ...input, siteUrl: "cedar.example" });
	expect(mocks.password).not.toHaveBeenCalled();
	expect(mocks.mutation).not.toHaveBeenCalled();
});
it.each([
	matching,
	{ ...matching, kind: "conflict", conflicts: ["email"] },
])("observes an existing setup without another credential generation: $kind", async (status) => {
	mocks.query.mockResolvedValue(status);
	expect(await (await create()).json()).toEqual({ kind: "observed", status });
	expect(mocks.password).not.toHaveBeenCalled();
	expect(mocks.mutation).not.toHaveBeenCalled();
});
it.each([
	new ConvexError("PLATFORM_CLIENT_SITE_IN_USE"),
	new Error("sensitive-provider-detail"),
])("reads after a duplicate or uncertain write without replaying or exposing the losing password", async (cause) => {
	mocks.query.mockResolvedValueOnce(absent).mockResolvedValueOnce(matching);
	mocks.mutation.mockRejectedValue(cause);
	expect(await (await create()).json()).toEqual({ kind: "observed", status: matching });
	expect(mocks.password).toHaveBeenCalledTimes(1);
	expect(mocks.mutation).toHaveBeenCalledTimes(1);
	expect(mocks.query).toHaveBeenCalledTimes(2);
});
it("leaves an absent read after an uncertain mutation available only for an explicit new request", async () => {
	mocks.mutation.mockRejectedValue(new Error("lost connection"));
	expect(await (await create()).json()).toEqual({ kind: "observed", status: absent });
	expect(mocks.mutation).toHaveBeenCalledTimes(1);
	// The previous write can commit after readback; the next request must observe it first.
	mocks.query.mockResolvedValue(matching);
	expect(await (await create()).json()).toEqual({ kind: "observed", status: matching });
	expect(mocks.password).toHaveBeenCalledTimes(1);
	expect(mocks.mutation).toHaveBeenCalledTimes(1);
});
it("does not create when status is unavailable and hides exception bodies", async () => {
	mocks.query.mockRejectedValue(new Error("sensitive-provider-detail"));
	const response = await create();
	expect(response.status).toBe(500);
	expect(await response.text()).not.toContain("sensitive-provider-detail");
	expect(mocks.password).not.toHaveBeenCalled();
	expect(mocks.mutation).not.toHaveBeenCalled();
});
it("does not expose a password when uncertain write readback also fails", async () => {
	mocks.query.mockResolvedValueOnce(absent).mockRejectedValueOnce(new Error("private"));
	mocks.mutation.mockRejectedValue(new Error("private"));
	const response = await create();
	expect(response.status).toBe(500);
	expect(await response.text()).not.toContain("fixture-password");
	expect(mocks.mutation).toHaveBeenCalledTimes(1);
});
it("explains a rejected unverified login without returning credentials", async () => {
	mocks.mutation.mockRejectedValue(new ConvexError("PLATFORM_CLIENT_LOGIN_UNVERIFIED"));
	const response = await create();
	expect(response.status).toBe(409);
	expect(await response.json()).toEqual({ error: "PLATFORM_CLIENT_LOGIN_UNVERIFIED" });
});
it("binds prepared identity to the configured backend and forwards expected identity only to status", async () => {
	const setupPlan = {
		...plan,
		identity: { ...plan.identity, expectedTenantId: matching.tenantId },
	};
	mocks.query.mockResolvedValue(matching);
	expect((await status({ ...input, setupPlan })).status).toBe(200);
	expect(mocks.query.mock.calls[0][1]).toEqual({
		...input,
		siteUrl: "cedar.example",
		expectedTenantId: matching.tenantId,
	});
	for (const badPlan of [
		{ ...plan, identity: { ...plan.identity, siteUrl: "different.example" } },
		{
			...plan,
			target: {
				...plan.target,
				convexUrl: "https://other.convex.cloud",
				convexSiteUrl: "https://other.convex.site",
			},
		},
	])
		expect((await create({ ...input, setupPlan: badPlan })).status).toBe(409);
	expect(mocks.query).toHaveBeenCalledTimes(1);
	expect(mocks.password).not.toHaveBeenCalled();
	expect(mocks.mutation).not.toHaveBeenCalled();
});
it("rejects invalid, credential-bearing and oversized plan inputs before querying", async () => {
	expect((await create({ ...input, tier: "creator" })).status).toBe(400);
	expect((await status({ ...input, setupPlan: { ...plan, token: "credential" } })).status).toBe(
		400,
	);
	expect((await create({ ...input, name: "a".repeat(40_000) })).status).toBe(413);
	expect(mocks.query).not.toHaveBeenCalled();
	expect(mocks.password).not.toHaveBeenCalled();
});
