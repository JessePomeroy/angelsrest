import { beforeEach, describe, expect, it, vi } from "vitest";
import { load } from "../+layout.server";

const { mockRequireAuthWithIdentity, mockGetSiteAdminAccess, privateEnv } = vi.hoisted(() => ({
	mockRequireAuthWithIdentity: vi.fn(),
	mockGetSiteAdminAccess: vi.fn(),
	privateEnv: {
		GALLERY_WORKER_URL: "https://staging-worker.example",
		GALLERY_ADMIN_SECRET: "synthetic-private-worker-key",
	} as Record<string, string | undefined>,
}));

vi.mock("$env/dynamic/private", () => ({ env: privateEnv }));

vi.mock("$lib/server/adminAuth", () => ({
	requireAuthWithIdentity: mockRequireAuthWithIdentity,
}));

vi.mock("$lib/server/siteAdminAuthorization", () => ({
	getSiteAdminAccess: mockGetSiteAdminAccess,
}));

describe("admin layout authorization", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		privateEnv.GALLERY_WORKER_URL = "https://staging-worker.example";
	});

	it("returns unauthenticated when the session is invalid", async () => {
		mockRequireAuthWithIdentity.mockRejectedValue(new Error("invalid session"));

		await expect(load({ cookies: {} } as never)).resolves.toEqual({
			galleryWorkerUrl: "https://staging-worker.example",
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
			galleryWorkerUrl: "https://staging-worker.example",
			adminSession: { status: "unauthorized", email: "other@example.com" },
		});
	});

	it("returns creator capabilities only for a stored site admin", async () => {
		mockRequireAuthWithIdentity.mockResolvedValue({
			token: "session-token",
			identity: { email: "creator@example.com", name: null, subject: "user-1" },
		});
		mockGetSiteAdminAccess.mockResolvedValue({
			authorized: true,
			tier: "full",
			enabledFeatures: ["editor"],
		});

		await expect(load({ cookies: {} } as never)).resolves.toEqual({
			galleryWorkerUrl: "https://staging-worker.example",
			adminSession: {
				status: "authorized",
				email: "creator@example.com",
				tier: "full",
				isCreator: true,
				enabledFeatures: ["editor"],
			},
		});
		expect(mockGetSiteAdminAccess).toHaveBeenCalledWith("session-token", "creator@example.com");
	});

	it("keeps unrelated admin access available without media configuration and never serializes its key", async () => {
		privateEnv.GALLERY_WORKER_URL = undefined;
		mockRequireAuthWithIdentity.mockRejectedValue(new Error("invalid session"));
		const data = await load({ cookies: {} } as never);
		expect(data.adminSession.status).toBe("unauthenticated");
		expect(data.galleryWorkerUrl).toBeUndefined();
		expect(JSON.stringify(data)).not.toContain(privateEnv.GALLERY_ADMIN_SECRET);
	});
});
