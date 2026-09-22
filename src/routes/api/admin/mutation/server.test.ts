import { error } from "@sveltejs/kit";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const auth = vi.hoisted(() => vi.fn());
vi.mock("$lib/server/adminAuth", () => ({ requireAuth: auth }));
vi.mock("$lib/server/runtimeConfig", () => ({
	getConvexUrl: () => "https://fixture.convex.cloud",
}));

import { POST } from "./+server";

const request = (name = "platform:createClient") =>
	POST({
		request: new Request("https://hub.example/api/admin/mutation", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name, args: {} }),
		}),
		cookies: {},
	} as Parameters<typeof POST>[0]);

beforeEach(() => {
	auth.mockReset().mockResolvedValue("fixture-session");
});
afterEach(() => {
	vi.unstubAllGlobals();
});

test.each([
	["platform:createClient", "PLATFORM_CLIENT_SITE_IN_USE", "PLATFORM_CLIENT_SITE_IN_USE"],
	["platform:createClient", { internal: "must not leak" }, "[Request ID: fixture] Server Error"],
	["platform:updateClient", "PLATFORM_CLIENT_SITE_IN_USE", "[Request ID: fixture] Server Error"],
])("preserves only the expected creation conflict through the real SDK and proxy (%s / %j)", async (name, data, expected) => {
	const fetch = vi.fn(
		async () =>
			new Response(
				JSON.stringify({
					status: "error",
					errorMessage: "[Request ID: fixture] Server Error",
					errorData: data,
					logLines: [],
				}),
				{ status: 560, headers: { "Content-Type": "application/json" } },
			),
	);
	vi.stubGlobal("fetch", fetch);
	const response = await request(name);
	expect(response.status).toBe(500);
	expect(await response.json()).toEqual({ error: expected });
	expect(fetch).toHaveBeenCalledOnce();
});

test("keeps a fresh authenticated client for each successful request", async () => {
	const fetch = vi.fn(
		async () => new Response(JSON.stringify({ status: "success", value: "fixture-client" })),
	);
	vi.stubGlobal("fetch", fetch);
	auth.mockResolvedValueOnce("first-session").mockResolvedValueOnce("second-session");
	expect(await (await request()).json()).toEqual({ result: "fixture-client" });
	expect(await (await request()).json()).toEqual({ result: "fixture-client" });
	expect(fetch.mock.calls).toHaveLength(2);
	for (const [index, token] of ["first-session", "second-session"].entries()) {
		expect(fetch).toHaveBeenNthCalledWith(
			index + 1,
			"https://fixture.convex.cloud/api/mutation",
			expect.objectContaining({
				headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
			}),
		);
	}
});

test("denies unauthenticated requests before reaching Convex", async () => {
	const fetch = vi.fn();
	vi.stubGlobal("fetch", fetch);
	auth.mockImplementation(() => error(401, "Unauthorized"));
	expect((await request()).status).toBe(401);
	expect(fetch).not.toHaveBeenCalled();
});
