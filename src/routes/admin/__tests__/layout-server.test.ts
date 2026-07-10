import { beforeEach, describe, expect, it, vi } from "vitest";
import { load } from "../+layout.server";

const { mockRequireAuthWithIdentity, mockGetSiteAdminAccess } = vi.hoisted(() => ({
	mockRequireAuthWithIdentity: vi.fn(),
	mockGetSiteAdminAccess: vi.fn(),
}));

vi.mock("$lib/server/adminAuth", () => ({
	requireAuthWithIdentity: mockRequireAuthWithIdentity,
}));

vi.mock("$lib/server/siteAdminAuthorization", () => ({
	getSiteAdminAccess: mockGetSiteAdminAccess,
}));

describe("admin layout authorization", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns unauthenticated when the session is invalid", async () => {
		mockRequireAuthWithIdentity.mockRejectedValue(new Error("invalid session"));

		await expect(load({ cookies: {} } as never)).resolves.toEqual({
			adminSession: { status: "unauthenticated" },
		});
	});

	it("returns unauthorized when identity lacks site membership", async () => {
		mockRequireAuthWithIdentity.mockResolvedValue({
			token: "session-token",
			identity: { email: "other@example.com", name: null, subject: "user-2" },
		});
		mockGetSiteAdminAccess.mockResolvedValue({ authorized: false, tier: "basic" });

		await expect(load({ cookies: {} } as never)).resolves.toEqual({
			adminSession: { status: "unauthorized", email: "other@example.com" },
		});
	});

	it("returns creator capabilities only for a stored site admin", async () => {
		mockRequireAuthWithIdentity.mockResolvedValue({
			token: "session-token",
			identity: { email: "creator@example.com", name: null, subject: "user-1" },
		});
		mockGetSiteAdminAccess.mockResolvedValue({ authorized: true, tier: "full" });

		await expect(load({ cookies: {} } as never)).resolves.toEqual({
			adminSession: {
				status: "authorized",
				email: "creator@example.com",
				tier: "full",
				isCreator: true,
			},
		});
		expect(mockGetSiteAdminAccess).toHaveBeenCalledWith("session-token", "creator@example.com");
	});
});
