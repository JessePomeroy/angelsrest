import type { AdminServerConfig } from "@jessepomeroy/admin";
import { api } from "$convex/api";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";

export const adminServerConfig: AdminServerConfig = {
	siteUrl: "angelsrest.online",
	siteName: "angel's rest",
	fromEmail: "Angel's Rest <noreply@angelsrest.online>",
	isCreator: true,
	sanityStudioUrl: "https://angelsrest.sanity.studio",
	galleryWorkerUrl: "https://gallery-worker.thinkingofview.workers.dev",
	galleryAdminSecret: privateEnv.GALLERY_ADMIN_SECRET ?? "",
	// Map Convex's `galleries` namespace to the package's `galleryDelivery` key.
	api: {
		...api,
		galleryDelivery: api.galleries,
	},
	convexUrl: publicEnv.PUBLIC_CONVEX_URL ?? "",
	resendApiKey: privateEnv.RESEND_API_KEY ?? "",
};
