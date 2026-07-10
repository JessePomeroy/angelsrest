import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSiteAdminAccess, verifySiteAdminRequest } from "$lib/server/siteAdminAuthorization";

const { mockGetTokenFromRequest, mockCreateClient, mockSetAuth, mockQuery } = vi.hoisted(() => ({
	mockGetTokenFromRequest: vi.fn(),
	mockCreateClient: vi.fn(),
	mockSetAuth: vi.fn(),
	mockQuery: vi.fn(),
}));

vi.mock("convex/browser", () => ({
	ConvexHttpClient: class MockConvexHttpClient {
		constructor(convexUrl: string) {
			mockCreateClient(convexUrl);
		}

		setAuth = mockSetAuth;
		query = mockQuery;
	},
}));

vi.mock("$convex/api", () => ({
	api: {
		adminAuth: {
			whoami: "adminAuth.whoami",
			checkAdminAccess: "adminAuth.checkAdminAccess",
		},
	},
}));

vi.mock("$env/dynamic/public", () => ({
	env: { PUBLIC_CONVEX_URL: "https://convex.test" },
}));

vi.mock("$lib/config/admin", () => ({
	adminConfig: { siteUrl: "angelsrest.online" },
}));

vi.mock("$lib/server/adminAuth", () => ({
	adminAuth: { getTokenFromRequest: mockGetTokenFromRequest },
}));

describe("site admin authorization", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("checks stored site membership with a fresh authenticated client", async () => {
		mockQuery.mockResolvedValue({ authorized: true, tier: "full" });

		await expect(getSiteAdminAccess("session-token", "creator@example.com")).resolves.toEqual({
			authorized: true,
			tier: "full",
		});

		expect(mockCreateClient).toHaveBeenCalledWith("https://convex.test");
		expect(mockSetAuth).toHaveBeenCalledWith("session-token");
		expect(mockQuery).toHaveBeenCalledWith("adminAuth.checkAdminAccess", {
			email: "creator@example.com",
			siteUrl: "angelsrest.online",
		});
	});

	it("fails closed when a handler request has no session token", async () => {
		mockGetTokenFromRequest.mockResolvedValue(null);

		await expect(verifySiteAdminRequest(new Request("https://example.test"))).resolves.toBe(false);
		expect(mockCreateClient).not.toHaveBeenCalled();
	});

	it("requires both a valid identity and stored site membership", async () => {
		mockGetTokenFromRequest.mockResolvedValue("session-token");
		mockQuery
			.mockResolvedValueOnce({ email: "creator@example.com", subject: "user-1" })
			.mockResolvedValueOnce({ authorized: true, tier: "full" });

		await expect(verifySiteAdminRequest(new Request("https://example.test"))).resolves.toBe(true);
		expect(mockQuery).toHaveBeenNthCalledWith(1, "adminAuth.whoami", {});
		expect(mockQuery).toHaveBeenNthCalledWith(2, "adminAuth.checkAdminAccess", {
			email: "creator@example.com",
			siteUrl: "angelsrest.online",
		});
	});

	it("rejects a valid identity without site membership", async () => {
		mockGetTokenFromRequest.mockResolvedValue("session-token");
		mockQuery
			.mockResolvedValueOnce({ email: "other@example.com", subject: "user-2" })
			.mockResolvedValueOnce({ authorized: false, tier: "basic" });

		await expect(verifySiteAdminRequest(new Request("https://example.test"))).resolves.toBe(false);
	});

	it("fails closed when Convex authorization is unavailable", async () => {
		mockGetTokenFromRequest.mockResolvedValue("session-token");
		mockQuery.mockRejectedValue(new Error("network unavailable"));

		await expect(verifySiteAdminRequest(new Request("https://example.test"))).resolves.toBe(false);
		await expect(getSiteAdminAccess("session-token", "creator@example.com")).resolves.toBeNull();
	});
});
