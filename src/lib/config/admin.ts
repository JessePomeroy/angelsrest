import type { AdminConfig } from "@jessepomeroy/admin";
import { api } from "$convex/api";
import {
	calculateCatalogProductMargin,
	resolveCatalogProductVariantOptions,
} from "$lib/catalogProductMargin";
import { contactPageSeed } from "$lib/content/contactPageSeed";
import { createAdminBrowserCapabilities } from "./adminPlatformCapabilities";

export const adminConfig: AdminConfig = {
	siteUrl: "angelsrest.online",
	siteName: "angel's rest",
	fromEmail: "Angel's Rest <noreply@angelsrest.online>",
	isCreator: true,
	sanityStudioUrl: "https://angelsrest.sanity.studio",
	galleryWorkerUrl: "https://gallery-worker.thinkingofview.workers.dev",
	api: createAdminBrowserCapabilities(api),
	editor: {
		siteSettings: {},
		contactPage: {
			initialPayload: contactPageSeed,
		},
		aboutPage: {
			// The route does not mount the shared editor until migration creates the draft.
			initialPayload: {},
			mediaBaseUrl: "https://media.angelsrest.online",
			uploadEndpoint: "/api/admin/media",
		},
		blog: {
			mediaBaseUrl: "https://media.angelsrest.online",
		},
		products: {
			publicationEnabled: true,
			publicShopEnabled: true,
			marginCalculator: calculateCatalogProductMargin,
			variantOptionResolver: resolveCatalogProductVariantOptions,
			privateAssetReplacementEnabled: true,
			privateAssetUpload: {
				prepareEndpoint: "/api/admin/catalog-private-assets/editor-uploads/prepare",
				completeEndpoint: "/api/admin/catalog-private-assets/editor-uploads/complete",
			},
			enabledKinds: [
				"print",
				"print_set",
				"postcard",
				"merchandise",
				"tapestry",
				"digital_download",
			],
			mediaBaseUrl: "https://media.angelsrest.online",
			uploadEndpoint: "/api/admin/media",
		},
		portfolio: {
			mediaBaseUrl: "https://media.angelsrest.online",
			uploadEndpoint: "/api/admin/media",
		},
	},
	// Route mutations through the SvelteKit proxy at /api/admin/mutation.
	// Queries use the manually authenticated browser WebSocket; the HTTP path
	// gives each mutation a fresh authenticated ConvexHttpClient and avoids the
	// older Better Auth adapter's navigation-pause behavior.
	mutationTransport: "http",
};
