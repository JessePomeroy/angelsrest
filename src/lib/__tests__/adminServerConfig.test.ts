import { describe, expect, it, vi } from "vitest";

const adminConfig = { siteUrl: "angelsrest.online", api: {} };

vi.mock("$env/dynamic/private", () => ({
	env: {
		CMS_MEDIA_WORKER_SECRET: "worker-secret",
		CMS_MEDIA_DELETION_COMPLETION_SECRET: "completion-secret",
	},
}));

vi.mock("$env/dynamic/public", () => ({
	env: {
		PUBLIC_CONVEX_URL: "https://tenant.convex.cloud",
		PUBLIC_CONVEX_SITE_URL: "https://tenant.convex.site",
	},
}));

vi.mock("$lib/server/adminAuth", () => ({
	adminAuth: { getTokenFromRequest: vi.fn() },
}));
vi.mock("$lib/server/galleryWorkerUrl", () => ({
	getGalleryWorkerUrl: () => "https://gallery-worker.example",
}));
vi.mock("$lib/server/siteAdminAuthorization", () => ({
	verifySiteAdminRequest: vi.fn(),
}));
vi.mock("$lib/config/admin", () => ({ adminConfig }));

describe("admin server CMS media deletion config", () => {
	it("keeps the Convex site URL and completion capability server-side", async () => {
		const { adminServerConfig } = await import("$lib/config/admin.server");

		expect(adminServerConfig).toMatchObject({
			siteUrl: "angelsrest.online",
			cmsMediaWorkerUrl: "https://cms-media-worker.thinkingofview.workers.dev",
			cmsMediaTenantSecret: "worker-secret",
			cmsMediaConvexSiteUrl: "https://tenant.convex.site",
			cmsMediaDeletionCompletionSecret: "completion-secret",
			convexUrl: "https://tenant.convex.cloud",
		});
	});
});
