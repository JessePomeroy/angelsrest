import type { AdminAPI, AdminConfig } from "@jessepomeroy/admin";
import { api } from "$convex/api";

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
		if (prop === "listMediaAssets") return api.mediaAssets.listForEditor;
		if (prop === "getPlacedMediaAssets") return api.mediaAssets.getManyForEditor;
		if (prop === "registerReadyWebAsset") return api.mediaAssets.registerReadyWebAsset;
		if (prop === "requestDeletion") return api.mediaAssets.requestDeletion;
		return Reflect.get(portfolio, prop, receiver);
	},
});

const apiWithAliases = new Proxy(api, {
	get(target, prop, receiver) {
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
		blog: {
			mediaBaseUrl: "https://media.angelsrest.online",
		},
	},
	// Route mutations through the SvelteKit proxy at /api/admin/mutation.
	// Queries use the manually authenticated browser WebSocket; the HTTP path
	// gives each mutation a fresh authenticated ConvexHttpClient and avoids the
	// older Better Auth adapter's navigation-pause behavior.
	mutationTransport: "http",
};
