import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	auth: vi.fn(),
	query: vi.fn(),
	mutation: vi.fn(),
	client: vi.fn(),
}));
vi.mock("$lib/server/adminAuth", () => ({ requireAuth: mocks.auth }));
vi.mock("$lib/server/convexClient", () => ({ createAuthenticatedConvexClient: mocks.client }));

import { actions, load } from "./+page.server";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.auth.mockReset().mockResolvedValue("request-token");
	mocks.client.mockReturnValue({ query: mocks.query, mutation: mocks.mutation });
	mocks.query.mockReset();
	mocks.mutation.mockReset();
});
type LoadInput = Parameters<typeof load>[0];
function context(isCreator = true): Pick<LoadInput, "parent" | "cookies" | "url" | "setHeaders"> {
	return {
		parent: vi.fn().mockResolvedValue({
			adminSession: {
				status: "authorized" as const,
				email: "creator@example.invalid",
				tier: "full" as const,
				isCreator,
			},
		}),
		cookies: { get: vi.fn(), getAll: () => [], set: vi.fn(), delete: vi.fn(), serialize: vi.fn() },
		url: new URL(
			"https://angelsrest.online/admin/platform/intake?site=fixture.example&state=retry",
		),
		setHeaders: vi.fn(),
	};
}

test("non-creator pages read no records", async () => {
	const result = await load(context(false) as Parameters<typeof load>[0]);
	expect(result?.intake.status).toBe("unauthorized");
	expect(mocks.auth).not.toHaveBeenCalled();
	expect(mocks.query).not.toHaveBeenCalled();
});
test("loads bounded data using fresh authenticated transport and private cache headers", async () => {
	mocks.query
		.mockResolvedValueOnce([
			{ name: "Fixture", siteUrl: "fixture.example", email: "private@example.invalid" },
		])
		.mockResolvedValueOnce({ page: [], isDone: true, continueCursor: "" });
	const request = context();
	const result = await load(request as Parameters<typeof load>[0]);
	expect(mocks.client).toHaveBeenCalledWith("request-token");
	expect(mocks.query.mock.calls[1][1]).toEqual({
		siteUrl: "fixture.example",
		state: "retry",
		paginationOpts: { numItems: 25, cursor: null },
	});
	expect(result?.intake.clients).toEqual([{ name: "Fixture", siteUrl: "fixture.example" }]);
	expect(request.setHeaders).toHaveBeenCalledWith(
		expect.objectContaining({ "cache-control": "private, no-store" }),
	);
});
test("backend unavailability stays explicit without error or customer payloads", async () => {
	mocks.query.mockRejectedValue(new Error("private@example.invalid provider detail"));
	const result = await load(context() as Parameters<typeof load>[0]);
	expect(result?.intake.status).toBe("unavailable");
	expect(JSON.stringify(result)).not.toContain("private@example.invalid");
});
function recovery(changes: Record<string, string | undefined> = {}) {
	const data = new FormData();
	for (const [key, value] of Object.entries({
		siteUrl: "fixture.example",
		inboxId: "j1234567890123456789012345678901",
		expectedVersion: "3",
		reason: "dependencies_restored",
		...changes,
	}))
		if (value !== undefined) data.set(key, value);
	return {
		cookies: {},
		request: new Request("https://angelsrest.online/admin/platform/intake?/recover", {
			method: "POST",
			body: data,
		}),
	};
}
test("recovery forwards only the scoped current version and selected reason with authenticated authority", async () => {
	mocks.mutation.mockResolvedValue({ changed: true, state: "retry" });
	const result = await actions.recover(
		recovery({ isCreator: "true" }) as Parameters<typeof actions.recover>[0],
	);
	expect(result).toEqual({ message: "Another processing attempt is scheduled." });
	expect(mocks.mutation.mock.calls[0][1]).toEqual({
		siteUrl: "fixture.example",
		inboxId: "j1234567890123456789012345678901",
		expectedVersion: 3,
		reason: "dependencies_restored",
	});
});
test.each([
	{ expectedVersion: "NaN" },
	{ expectedVersion: "0" },
	{ reason: "reset_provider_claim" },
	{ inboxId: "arbitrary" },
])("rejects invalid recovery input", async (patch) => {
	const result = await actions.recover(recovery(patch) as Parameters<typeof actions.recover>[0]);
	expect(result).toMatchObject({ status: 400 });
	expect(mocks.mutation).not.toHaveBeenCalled();
});
test("stale version or backend creator denial cannot become a success message", async () => {
	mocks.mutation.mockRejectedValue(new Error("Not a creator; private detail"));
	const result = await actions.recover(recovery() as Parameters<typeof actions.recover>[0]);
	expect(result).toMatchObject({ status: 409 });
	expect(JSON.stringify(result)).not.toContain("private detail");
});
