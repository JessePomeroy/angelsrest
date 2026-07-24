import { beforeEach, describe, expect, it, vi } from "vitest";

const { privateEnv, publicEnv, verifySiteAdminRequest } = vi.hoisted(() => ({
	privateEnv: {
		CMS_MEDIA_WORKER_SECRET: "worker-secret",
		CMS_MEDIA_DELETION_COMPLETION_SECRET: "completion-secret",
		CATALOG_PRIVATE_EDITOR_UPLOAD_HOST_JOURNAL_SECRET: "h".repeat(32),
		CATALOG_PRIVATE_EDITOR_UPLOAD_STORAGE_CALLER_SECRET: "s".repeat(32),
	} as Record<string, string | undefined>,
	publicEnv: {
		PUBLIC_CONVEX_URL: "https://loyal-swan-967.convex.cloud",
		PUBLIC_CONVEX_SITE_URL: "https://tenant.convex.site",
	},
	verifySiteAdminRequest: vi.fn(),
}));

const adminConfig = { siteUrl: "angelsrest.online", api: {} };

vi.mock("$env/dynamic/private", () => ({ env: privateEnv }));

vi.mock("$env/dynamic/public", () => ({ env: publicEnv }));

vi.mock("$lib/server/adminAuth", () => ({
	adminAuth: { getTokenFromRequest: vi.fn() },
}));
vi.mock("$lib/server/galleryWorkerUrl", () => ({
	getGalleryWorkerUrl: () => "https://gallery-worker.example",
}));
vi.mock("$lib/server/siteAdminAuthorization", () => ({ verifySiteAdminRequest }));
vi.mock("$lib/config/admin", () => ({ adminConfig }));

describe("admin server secret custody", () => {
	beforeEach(() => {
		vi.resetModules();
		publicEnv.PUBLIC_CONVEX_URL = "https://loyal-swan-967.convex.cloud";
		privateEnv.CATALOG_PRIVATE_EDITOR_UPLOAD_HOST_JOURNAL_SECRET = "h".repeat(32);
		privateEnv.CATALOG_PRIVATE_EDITOR_UPLOAD_STORAGE_CALLER_SECRET = "s".repeat(32);
	});

	it("keeps CMS media deletion capability server-side", async () => {
		const { adminServerConfig } = await import("$lib/config/admin.server");

		expect(adminServerConfig).toMatchObject({
			siteUrl: "angelsrest.online",
			cmsMediaWorkerUrl: "https://cms-media-worker.thinkingofview.workers.dev",
			cmsMediaTenantSecret: "worker-secret",
			cmsMediaConvexSiteUrl: "https://tenant.convex.site",
			cmsMediaDeletionCompletionSecret: "completion-secret",
			convexUrl: "https://loyal-swan-967.convex.cloud",
		});
	});

	it("enables the private Editor upload authorities for the exact authorization deployment", async () => {
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

	it.each([
		"https://other-deployment.convex.cloud",
		"https://loyal-swan-967.convex.cloud/",
	])("disables only the Editor upload authorities for mismatched %s", async (convexUrl) => {
		publicEnv.PUBLIC_CONVEX_URL = convexUrl;
		const { adminServerConfig } = await import("$lib/config/admin.server");

		expect(adminServerConfig.catalogPrivateEditorUpload).toBeUndefined();
		expect(adminServerConfig.convexUrl).toBe(convexUrl);
		expect(adminServerConfig.verifyAdmin).toBe(verifySiteAdminRequest);
		expect(adminServerConfig.cmsMediaDeletionCompletionSecret).toBe("completion-secret");
	});

	it.each([
		{
			name: "missing host-journal credential",
			hostJournalSecret: undefined,
			storageCallerSecret: "s".repeat(32),
		},
		{
			name: "missing storage-caller credential",
			hostJournalSecret: "h".repeat(32),
			storageCallerSecret: undefined,
		},
		{
			name: "short credential",
			hostJournalSecret: "h".repeat(31),
			storageCallerSecret: "s".repeat(32),
		},
		{
			name: "too-long credential",
			hostJournalSecret: "h".repeat(32),
			storageCallerSecret: "s".repeat(513),
		},
		{
			name: "equal credentials",
			hostJournalSecret: "x".repeat(32),
			storageCallerSecret: "x".repeat(32),
		},
		{
			name: "embedded carriage return",
			hostJournalSecret: `${"h".repeat(16)}\r${"h".repeat(16)}`,
			storageCallerSecret: "s".repeat(32),
		},
		{
			name: "embedded line feed",
			hostJournalSecret: "h".repeat(32),
			storageCallerSecret: `${"s".repeat(16)}\n${"s".repeat(16)}`,
		},
		{
			name: "embedded control character",
			hostJournalSecret: `${"h".repeat(16)}\u0000${"h".repeat(16)}`,
			storageCallerSecret: "s".repeat(32),
		},
		{
			name: "embedded whitespace",
			hostJournalSecret: "h".repeat(32),
			storageCallerSecret: `${"s".repeat(16)}\t${"s".repeat(16)}`,
		},
		{
			name: "leading equals sign",
			hostJournalSecret: `=${"h".repeat(32)}`,
			storageCallerSecret: "s".repeat(32),
		},
		{
			name: "embedded equals sign",
			hostJournalSecret: "h".repeat(32),
			storageCallerSecret: `${"s".repeat(16)}=${"s".repeat(16)}`,
		},
		{
			name: "character outside the token68 alphabet",
			hostJournalSecret: `${"h".repeat(31)}:`,
			storageCallerSecret: "s".repeat(32),
		},
	])("omits Editor upload authorities for $name", async ({
		hostJournalSecret,
		storageCallerSecret,
	}) => {
		privateEnv.CATALOG_PRIVATE_EDITOR_UPLOAD_HOST_JOURNAL_SECRET = hostJournalSecret;
		privateEnv.CATALOG_PRIVATE_EDITOR_UPLOAD_STORAGE_CALLER_SECRET = storageCallerSecret;
		const { adminServerConfig } = await import("$lib/config/admin.server");

		expect(adminServerConfig.catalogPrivateEditorUpload).toBeUndefined();
		expect(adminServerConfig.verifyAdmin).toBe(verifySiteAdminRequest);
		expect(adminServerConfig.cmsMediaDeletionCompletionSecret).toBe("completion-secret");
	});

	it.each([
		{
			name: "minimum-length hexadecimal",
			hostJournalSecret: "0123456789abcdef".repeat(2),
			storageCallerSecret: "fedcba9876543210".repeat(2),
		},
		{
			name: "padded base64",
			hostJournalSecret: Buffer.from("host journal credential material").toString("base64"),
			storageCallerSecret: Buffer.from("storage caller credential material").toString("base64"),
		},
		{
			name: "unpadded base64url",
			hostJournalSecret: Buffer.from("host journal base64url credential").toString("base64url"),
			storageCallerSecret: Buffer.from("storage caller base64url credential").toString("base64url"),
		},
		{
			name: "maximum-length token material",
			hostJournalSecret: "h".repeat(512),
			storageCallerSecret: "s".repeat(512),
		},
	])("preserves and enables $name credentials", async ({
		hostJournalSecret,
		storageCallerSecret,
	}) => {
		privateEnv.CATALOG_PRIVATE_EDITOR_UPLOAD_HOST_JOURNAL_SECRET = hostJournalSecret;
		privateEnv.CATALOG_PRIVATE_EDITOR_UPLOAD_STORAGE_CALLER_SECRET = storageCallerSecret;
		const { adminServerConfig } = await import("$lib/config/admin.server");

		expect(adminServerConfig.catalogPrivateEditorUpload).toMatchObject({
			hostJournalSecret,
			storageCallerSecret,
		});
	});
});
