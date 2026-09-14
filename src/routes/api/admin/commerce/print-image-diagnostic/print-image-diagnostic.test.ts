import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	authorize: vi.fn(),
	client: vi.fn(),
	query: vi.fn(),
	diagnose: vi.fn(),
}));
vi.mock("$lib/server/siteAdminAuthorization", () => ({
	authorizeSiteAdminRequest: mocks.authorize,
}));
vi.mock("$lib/server/convexClient", () => ({ createAuthenticatedConvexClient: mocks.client }));
vi.mock("$lib/server/printImageDiagnostic", async (original) => ({
	...(await original<typeof import("$lib/server/printImageDiagnostic")>()),
	diagnosePreparedPrintImage: mocks.diagnose,
}));

import { POST } from "./+server";

const endpoint = "https://www.angelsrest.online/api/admin/commerce/print-image-diagnostic";
const orderId = "a".repeat(32);
function request(body = JSON.stringify({ orderId }), origin = "https://www.angelsrest.online") {
	return new Request(endpoint, {
		method: "POST",
		headers: { origin, "content-type": "application/json" },
		body,
	});
}
beforeEach(() => {
	mocks.authorize.mockReset().mockResolvedValue({ convexToken: "private-session-token" });
	mocks.client.mockReset().mockReturnValue({ query: mocks.query });
	mocks.query.mockReset().mockResolvedValue({ prepared: true });
	mocks.diagnose.mockReset().mockResolvedValue({ version: 1, outcome: "passed" });
});

test("requires stored site-admin authorization before querying artwork or issuing a capability", async () => {
	mocks.authorize.mockResolvedValue(null);
	expect((await POST({ request: request() })).status).toBe(401);
	expect(mocks.client).not.toHaveBeenCalled();
	expect(mocks.diagnose).not.toHaveBeenCalled();
});

test("rejects cross-origin requests before authorization", async () => {
	expect((await POST({ request: request(undefined, "https://attacker.example") })).status).toBe(
		403,
	);
	expect(mocks.authorize).not.toHaveBeenCalled();
});

test.each([
	JSON.stringify({ orderId, imageUrl: "https://attacker.example" }),
	"not json",
	"x".repeat(513),
])("rejects arbitrary URLs, malformed or oversized bodies", async (body) => {
	expect((await POST({ request: request(body) })).status).toBe(400);
	expect(mocks.query).not.toHaveBeenCalled();
});

test("uses a fresh authenticated client and only the saved query result", async () => {
	const response = await POST({ request: request() });
	expect(response.status).toBe(200);
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(mocks.client).toHaveBeenCalledExactlyOnceWith("private-session-token");
	expect(mocks.query.mock.calls[0][1]).toEqual({ orderId });
	expect(mocks.diagnose).toHaveBeenCalledExactlyOnceWith({ prepared: true });
});

test("missing artwork and backend errors never fall back to caller-supplied inputs", async () => {
	mocks.query.mockResolvedValue(null);
	expect((await POST({ request: request() })).status).toBe(404);
	mocks.query.mockRejectedValue(new Error("private backend details"));
	const response = await POST({ request: request() });
	expect(response.status).toBe(503);
	expect(await response.text()).not.toContain("private");
	expect(mocks.diagnose).not.toHaveBeenCalled();
});
