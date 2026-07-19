import type { AdminAPI, AdminConfig } from "@jessepomeroy/admin";
import { api } from "$convex/api";
import { contactPageSeed } from "$lib/content/contactPageSeed";

// Map Convex's `galleries` namespace to the package's `galleryDelivery` key —
// the admin package renamed this to match the feature flag name; Convex module
// names stay as `galleries` since they predate the rename.
//
// IMPORTANT: `api` is `anyApi` from `convex/server`, which is implemented as a
// Proxy with NO own enumerable properties. Spreading it with `{ ...api, ... }`
// produces a plain object that contains only the explicit overrides — every
// other namespace (`crm`, `orders`, `invoices`, ...) becomes undefined and the
// admin dashboard crashes on first render with
// `Cannot read properties of undefined (reading 'getStats')`.
//
// Use a Proxy wrapper instead so unknown property reads fall through to the
// real `api` Proxy and the alias is the only override.
const portfolioEditorApi = new Proxy(api.portfolioGalleries, {
	get(portfolio, prop, receiver) {
		// Angel's Rest is staging Portfolio content privately while the public
		// gallery remains Sanity-owned. Omitting this capability keeps the shared
		// editor in draft-only mode without weakening the underlying Convex API.
		if (prop === "publish") return undefined;
		if (prop === "listMediaAssets") return api.mediaAssets.listForEditor;
		if (prop === "getPlacedMediaAssets") return api.mediaAssets.getManyForEditor;
		if (prop === "registerReadyWebAsset") return api.mediaAssets.registerReadyWebAsset;
		if (prop === "requestDeletion") return api.mediaAssets.requestDeletion;
		return Reflect.get(portfolio, prop, receiver);
	},
});

const siteEditorApi = new Proxy(api.content, {
	get(content, prop, receiver) {
		// Angel's Rest keeps public site settings and Contact copy in Sanity during
		// this staged adoption. The shared editor may save private Convex drafts,
		// but it must not expose publishing until each public read boundary is connected.
		if (prop === "publishSiteSettings" || prop === "publishContactPage") return undefined;
		return Reflect.get(content, prop, receiver);
	},
});

const apiWithAliases = new Proxy(api, {
	get(target, prop, receiver) {
		if (prop === "siteEditor") return siteEditorApi;
		if (prop === "portfolioEditor") return portfolioEditorApi;
		if (prop === "galleryDelivery") {
			return new Proxy(target.galleries, {
				get(galleries, galleryProp, galleryReceiver) {
					if (galleryProp === "setPassword") return target.galleryPassword.setPassword;
					return Reflect.get(galleries, galleryProp, galleryReceiver);
				},
			});
		}
		if (prop === "blogContent") return target.blogContent;
		if (prop === "postContent") return target.postContent;
		return Reflect.get(target, prop, receiver);
	},
}) as unknown as AdminAPI;

export const adminConfig: AdminConfig = {
	siteUrl: "angelsrest.online",
	siteName: "angel's rest",
	fromEmail: "Angel's Rest <noreply@angelsrest.online>",
	isCreator: true,
	sanityStudioUrl: "https://angelsrest.sanity.studio",
	galleryWorkerUrl: "https://gallery-worker.thinkingofview.workers.dev",
	api: apiWithAliases,
	editor: {
		siteSettings: {},
		contactPage: {
			initialPayload: contactPageSeed,
		},
		blog: {
			mediaBaseUrl: "https://media.angelsrest.online",
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
