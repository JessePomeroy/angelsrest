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
	api: createAdminBrowserCapabilities(api),
	editor: {
		siteSettings: { previewEndpoint: "/api/admin/draft-preview/settings" },
		contactPage: {
			publicationEnabled: false,
			previewEndpoint: "/api/admin/draft-preview/contact",
			initialPayload: contactPageSeed,
		},
		aboutPage: {
			previewEndpoint: "/api/admin/draft-preview/about",
			// The route does not mount the shared editor until migration creates the draft.
			initialPayload: {},
			mediaBaseUrl: "https://media.angelsrest.online",
			uploadEndpoint: "/api/admin/media",
		},
		blog: {
			mode: "compact",
			mediaBaseUrl: "https://media.angelsrest.online",
		},
		products: {
			previewEndpoint: "/api/admin/draft-preview/product",
			publicationEnabled: true,
			publicShopEnabled: true,
			marginCalculator: calculateCatalogProductMargin,
			variantOptionResolver: resolveCatalogProductVariantOptions,
			privateAssetReplacementEnabled: true,
			privateAssetDeleteEndpoint: "/api/admin/catalog-private-assets/delete",
			mediaDeleteEndpoint: "/api/admin/media/delete",
			privateAssetUpload: {
				prepareEndpoint: "/api/admin/catalog-private-assets/editor-uploads/prepare",
				completeEndpoint: "/api/admin/catalog-private-assets/editor-uploads/complete",
			},
			enabledKinds: [
				"print",
				"print_set",
				"postcard",
				"zine",
				"merchandise",
				"tapestry",
				"digital_download",
			],
			mediaBaseUrl: "https://media.angelsrest.online",
			uploadEndpoint: "/api/admin/media",
		},
		portfolio: {
			previewEndpoint: "/api/admin/draft-preview/portfolio",
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
