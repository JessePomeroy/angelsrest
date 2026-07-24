import type { AdminServerConfig } from "@jessepomeroy/admin/server";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { adminAuth } from "$lib/server/adminAuth";
import { getGalleryWorkerUrl } from "$lib/server/galleryWorkerUrl";
import { verifySiteAdminRequest } from "$lib/server/siteAdminAuthorization";
import { adminConfig } from "./admin";

const TOKEN68_BEARER_PATTERN = /^[-A-Za-z0-9._~+/]+={0,}$/;

function isValidBearerCredential(value: string | undefined): value is string {
	return (
		typeof value === "string" &&
		value.length >= 32 &&
		value.length <= 512 &&
		TOKEN68_BEARER_PATTERN.test(value)
	);
}

const hostJournalSecret = privateEnv.CATALOG_PRIVATE_EDITOR_UPLOAD_HOST_JOURNAL_SECRET;
const storageCallerSecret = privateEnv.CATALOG_PRIVATE_EDITOR_UPLOAD_STORAGE_CALLER_SECRET;
const catalogPrivateEditorUpload =
	publicEnv.PUBLIC_CONVEX_URL === "https://loyal-swan-967.convex.cloud" &&
	isValidBearerCredential(hostJournalSecret) &&
	isValidBearerCredential(storageCallerSecret) &&
	hostJournalSecret !== storageCallerSecret
		? {
				convexJournalOrigin: "https://loyal-swan-967.convex.site",
				hostJournalSecret,
				workerOrigin: "https://cms-media-worker.thinkingofview.workers.dev" as const,
				storageCallerSecret,
				browserOrigin: "https://www.angelsrest.online",
			}
		: undefined;

export const adminServerConfig: AdminServerConfig = {
	...adminConfig,
	galleryWorkerUrl: getGalleryWorkerUrl(),
	galleryAdminSecret: privateEnv.GALLERY_ADMIN_SECRET ?? "",
	cmsMediaWorkerUrl: "https://cms-media-worker.thinkingofview.workers.dev",
	cmsMediaTenantSecret: privateEnv.CMS_MEDIA_WORKER_SECRET ?? "",
	cmsMediaConvexSiteUrl: publicEnv.PUBLIC_CONVEX_SITE_URL ?? "",
	cmsMediaDeletionCompletionSecret: privateEnv.CMS_MEDIA_DELETION_COMPLETION_SECRET ?? "",
	catalogPrivateEditorUpload,
	convexUrl: publicEnv.PUBLIC_CONVEX_URL ?? "",
	resendApiKey: privateEnv.RESEND_API_KEY ?? "",
	verifyAdmin: verifySiteAdminRequest,
	getConvexToken: adminAuth.getTokenFromRequest,
};
