import type { AdminConfig } from "@jessepomeroy/admin";
import { api } from "$convex/api";

export const adminConfig: AdminConfig = {
	siteUrl: "angelsrest.online",
	siteName: "angel's rest",
	fromEmail: "Angel's Rest <noreply@angelsrest.online>",
	isCreator: true,
	sanityStudioUrl: "https://angelsrest.sanity.studio",
	galleryWorkerUrl: "https://gallery-worker.thinkingofview.workers.dev",
	// Map Convex's `galleries` namespace to the package's `galleryDelivery`
	// key — the admin package renamed this to match the feature flag name.
	// Convex module names stay as `galleries` since they predate the rename.
	api: {
		...api,
		galleryDelivery: api.galleries,
	},
};
