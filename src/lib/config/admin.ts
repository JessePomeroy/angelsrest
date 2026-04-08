import type { AdminConfig, AdminServerConfig } from "@jessepomeroy/admin";
import { api } from "$convex/api";

export const adminConfig: AdminConfig = {
	siteUrl: "angelsrest.online",
	siteName: "angel's rest",
	fromEmail: "Angel's Rest <noreply@angelsrest.online>",
	isCreator: true,
	sanityStudioUrl: "https://angelsrest.sanity.studio",
	api,
};
