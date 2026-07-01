import type { AdminServerConfig } from "@jessepomeroy/admin/server";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { adminAuth } from "$lib/server/adminAuth";
import { getGalleryWorkerUrl } from "$lib/server/galleryWorkerUrl";
import { adminConfig } from "./admin";

export const adminServerConfig: AdminServerConfig = {
	...adminConfig,
	galleryWorkerUrl: getGalleryWorkerUrl(),
	galleryAdminSecret: privateEnv.GALLERY_ADMIN_SECRET ?? "",
	convexUrl: publicEnv.PUBLIC_CONVEX_URL ?? "",
	resendApiKey: privateEnv.RESEND_API_KEY ?? "",
	verifyAdmin: adminAuth.verifyRequest,
	getConvexToken: adminAuth.getTokenFromRequest,
};
