import type { AdminServerConfig } from "@jessepomeroy/admin/server";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { adminAuth } from "$lib/server/adminAuth";
import { getGalleryWorkerUrl } from "$lib/server/galleryWorkerUrl";
import { verifySiteAdminRequest } from "$lib/server/siteAdminAuthorization";
import { adminConfig } from "./admin";

export const adminServerConfig: AdminServerConfig = {
	...adminConfig,
	galleryWorkerUrl: getGalleryWorkerUrl(),
	galleryAdminSecret: privateEnv.GALLERY_ADMIN_SECRET ?? "",
	cmsMediaWorkerUrl: "https://cms-media-worker.thinkingofview.workers.dev",
	cmsMediaTenantSecret: privateEnv.CMS_MEDIA_WORKER_SECRET ?? "",
	cmsMediaConvexSiteUrl: publicEnv.PUBLIC_CONVEX_SITE_URL ?? "",
	cmsMediaDeletionCompletionSecret: privateEnv.CMS_MEDIA_DELETION_COMPLETION_SECRET ?? "",
	convexUrl: publicEnv.PUBLIC_CONVEX_URL ?? "",
	resendApiKey: privateEnv.RESEND_API_KEY ?? "",
	verifyAdmin: verifySiteAdminRequest,
	getConvexToken: adminAuth.getTokenFromRequest,
};
