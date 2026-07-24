import { describe, expect, it, vi } from "vitest";

const adminConfig = { siteUrl: "angelsrest.online", api: {} };

vi.mock("$env/dynamic/private", () => ({
	env: {
		CMS_MEDIA_WORKER_SECRET: "worker-secret",
		CMS_MEDIA_DELETION_COMPLETION_SECRET: "completion-secret",
		CATALOG_PRIVATE_EDITOR_UPLOAD_HOST_JOURNAL_SECRET: "h".repeat(32),
		CATALOG_PRIVATE_EDITOR_UPLOAD_STORAGE_CALLER_SECRET: "s".repeat(32),
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

describe("admin server secret custody", () => {
	it("keeps CMS media deletion capability server-side", async () => {
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

	it("holds only the private Editor upload host-journal and storage authorities", async () => {
		const { adminServerConfig } = await import("$lib/config/admin.server");
		const upload = adminServerConfig.catalogPrivateEditorUpload;

		expect(upload).toEqual({
			convexJournalOrigin: "https://loyal-swan-967.convex.site",
			hostJournalSecret: "h".repeat(32),
			workerOrigin: "https://cms-media-worker.thinkingofview.workers.dev",
			storageCallerSecret: "s".repeat(32),
			browserOrigin: "https://www.angelsrest.online",
		});
		expect(Object.keys(upload ?? {}).sort()).toEqual([
			"browserOrigin",
			"convexJournalOrigin",
			"hostJournalSecret",
			"storageCallerSecret",
			"workerOrigin",
		]);
		expect(JSON.stringify(upload)).not.toMatch(
			/control|inspect|receipt|seal|tenant|webhook|deletion/i,
		);
	});
});
