import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetToken = vi.fn();
const mockConvexQuery = vi.fn();
const mockSetAuth = vi.fn();

vi.mock("@mmailaender/convex-better-auth-svelte/sveltekit", () => ({
	getToken: mockGetToken,
}));

vi.mock("convex/browser", () => ({
	ConvexHttpClient: class MockConvexHttpClient {
		setAuth = mockSetAuth;
		query = mockConvexQuery;
	},
}));

vi.mock("$convex/api", () => ({
	api: { adminAuth: { whoami: "adminAuth.whoami" } },
}));

// Mock @sveltejs/kit error() to throw like it does at runtime
vi.mock("@sveltejs/kit", () => ({
	error: (status: number, message: string) => {
		const err = new Error(message) as Error & { status: number };
		err.status = status;
		throw err;
	},
}));

describe("requireAuth", () => {
	let requireAuth: typeof import("../adminAuth").requireAuth;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockConvexQuery.mockReset();
		const mod = await import("../adminAuth");
		requireAuth = mod.requireAuth;
	});

	it("returns the token when Convex validates the session", async () => {
		mockGetToken.mockReturnValue("valid-session-token-123");
		mockConvexQuery.mockResolvedValue({
			email: "admin@example.com",
			name: "Admin",
			subject: "user-1",
		});

		const mockCookies = {} as any;
		const result = await requireAuth(mockCookies);

		expect(result).toBe("valid-session-token-123");
		expect(mockGetToken).toHaveBeenCalledWith(mockCookies);
		expect(mockSetAuth).toHaveBeenCalledWith("valid-session-token-123");
		expect(mockConvexQuery).toHaveBeenCalledWith("adminAuth.whoami", {});
	});

	it("throws 401 when no session token is present", async () => {
		mockGetToken.mockReturnValue(null);

		const mockCookies = {} as any;

		await expect(requireAuth(mockCookies)).rejects.toMatchObject({
			status: 401,
			message: "Unauthorized",
		});
	});

	it("throws 401 when the token exists but Convex returns null identity", async () => {
		mockGetToken.mockReturnValue("stale-token");
		mockConvexQuery.mockResolvedValue(null);

		const mockCookies = {} as any;
		await expect(requireAuth(mockCookies)).rejects.toMatchObject({ status: 401 });
	});

	it("throws 401 when the Convex call itself fails", async () => {
		mockGetToken.mockReturnValue("some-token");
		mockConvexQuery.mockRejectedValue(new Error("network dropped"));

		const mockCookies = {} as any;
		await expect(requireAuth(mockCookies)).rejects.toMatchObject({ status: 401 });
	});

	it("throws 401 when getToken returns empty string", async () => {
		mockGetToken.mockReturnValue("");

		const mockCookies = {} as any;
		await expect(requireAuth(mockCookies)).rejects.toMatchObject({ status: 401 });
	});
});
