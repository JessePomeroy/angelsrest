import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockConstructClient, mockSetAuth } = vi.hoisted(() => ({
	mockConstructClient: vi.fn(),
	mockSetAuth: vi.fn(),
}));

vi.mock("convex/browser", () => ({
	ConvexHttpClient: class MockConvexHttpClient {
		constructor(convexUrl: string) {
			mockConstructClient(convexUrl);
		}

		setAuth(token: string) {
			mockSetAuth(this, token);
		}
	},
}));

vi.mock("$env/dynamic/public", () => ({
	env: { PUBLIC_CONVEX_URL: "https://convex.test" },
}));

describe("Convex server clients", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.resetModules();
	});

	it("reuses one unauthenticated client for server-secret call paths", async () => {
		const { getConvex } = await import("$lib/server/convexClient");

		const first = getConvex();
		const second = getConvex();

		expect(first).toBe(second);
		expect(mockConstructClient).toHaveBeenCalledTimes(1);
		expect(mockSetAuth).not.toHaveBeenCalled();
	});

	it("creates an isolated client for every authenticated request", async () => {
		const { createAuthenticatedConvexClient } = await import("$lib/server/convexClient");

		const first = createAuthenticatedConvexClient("token-a");
		const second = createAuthenticatedConvexClient("token-b");

		expect(first).not.toBe(second);
		expect(mockConstructClient).toHaveBeenCalledTimes(2);
		expect(mockSetAuth).toHaveBeenNthCalledWith(1, first, "token-a");
		expect(mockSetAuth).toHaveBeenNthCalledWith(2, second, "token-b");
	});
});
