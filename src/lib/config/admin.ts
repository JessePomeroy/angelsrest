import type { AdminAPI, AdminConfig } from "@jessepomeroy/admin";
import { api } from "$convex/api";
import {
	calculateCatalogProductMargin,
	resolveCatalogProductVariantOptions,
} from "$lib/catalogProductMargin";
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
// Keep the dormant Portfolio editor on an exact browser-safe allowlist. Initial
// publication remains an internal fixed-manifest operation, so ordinary publish
// is intentionally absent until that graph has been published and accepted.
const portfolioEditorApi = {
	listForEditor: api.portfolioGalleries.listForEditor,
	getEditorState: api.portfolioGalleries.getEditorState,
	saveDraft: api.portfolioGalleries.saveDraft,
	reorder: api.portfolioGalleries.reorder,
	listMediaAssets: api.mediaAssets.listForEditor,
	getPlacedMediaAssets: api.mediaAssets.getManyForEditor,
	registerReadyWebAsset: api.mediaAssets.registerReadyWebAsset,
	requestDeletion: api.mediaAssets.requestDeletion,
};

// Keep the site editor on an explicit browser-safe capability surface. About's
// installed shared editors currently require their ordinary authenticated publish
// references for About and Site Settings, while Contact remains draft-only. Migration and
// restore operators are internal and cannot appear through this plain object.
const siteEditorApi = {
	getSiteSettingsEditorState: api.content.getSiteSettingsEditorState,
	saveSiteSettingsDraft: api.content.saveSiteSettingsDraft,
	publishSiteSettings: api.content.publishSiteSettings,
	discardSiteSettingsDraft: api.content.discardSiteSettingsDraft,
	getHomepageQuoteEditorState: api.content.getHomepageQuoteEditorState,
	getContactPageEditorState: api.content.getContactPageEditorState,
	saveContactPageDraft: api.content.saveContactPageDraft,
	discardContactPageDraft: api.content.discardContactPageDraft,
	getAboutPageEditorState: api.content.getAboutPageEditorState,
	saveAboutPageDraft: api.content.saveAboutPageDraft,
	publishAboutPage: api.content.holdAboutPagePublication,
	discardAboutPageDraft: api.content.discardAboutPageDraft,
	listMediaAssets: api.mediaAssets.listForEditor,
	getPlacedMediaAssets: api.mediaAssets.getManyForEditor,
};

// Keep the protected Product Editor capability plain and closed. Convex namespace
// proxies return truthy refs for arbitrary property reads, so publication must be
// limited to these concrete host-generated refs rather than inferred dynamically.
const catalogProductGraphsApi = {
	listForEditor: api.catalogProductGraphs.listForEditor,
	getEditorState: api.catalogProductGraphs.getEditorState,
	createDraft: api.catalogProductGraphs.createDraft,
	saveDraft: api.catalogProductGraphs.saveDraft,
	discardDraft: api.catalogProductGraphs.discardDraft,
	listDraftPrivateAssetCandidates: api.catalogProductGraphs.listDraftPrivateAssetCandidates,
	replaceDraftPrivateAsset: api.catalogProductGraphs.replaceDraftPrivateAsset,
	publishDraft: api.catalogProductGraphs.publishDraft,
	unpublish: api.catalogProductGraphs.unpublish,
};

// Keep the protected Blog editor on the exact author/category and Post
// capability set consumed by the shared UI. Convex namespaces are open-ended
// proxies, so passing either namespace through would also make future
// migration or restore operators appear reachable from the browser config.
const blogContentApi = {
	listForEditor: api.blogContent.listForEditor,
	getEditorState: api.blogContent.getEditorState,
	createDraft: api.blogContent.createDraft,
	saveDraft: api.blogContent.saveDraft,
	publish: api.blogContent.publish,
	discardDraft: api.blogContent.discardDraft,
	unpublish: api.blogContent.unpublish,
	archive: api.blogContent.archive,
	restore: api.blogContent.restore,
};

const postContentApi = {
	listForEditor: api.postContent.listForEditor,
	getEditorState: api.postContent.getEditorState,
	createDraft: api.postContent.createDraft,
	saveDraft: api.postContent.saveDraft,
	publish: api.postContent.publish,
	discardDraft: api.postContent.discardDraft,
	unpublish: api.postContent.unpublish,
	archive: api.postContent.archive,
	restore: api.postContent.restore,
};

// Keep the server-owned document-email journal on an exact eight-reference
// surface. The package's browser recovery UI consumes these opaque refs, while
// tenant authorization remains in the shared server handlers and Convex.
const documentEmailAttemptsApi = {
	get: api.documentEmailAttempts.get,
	getRecovery: api.documentEmailAttempts.getRecovery,
	getOpenRecoveryByDocument: api.documentEmailAttempts.getOpenRecoveryByDocument,
	prepare: api.documentEmailAttempts.prepare,
	claim: api.documentEmailAttempts.claim,
	complete: api.documentEmailAttempts.complete,
	fail: api.documentEmailAttempts.fail,
	resolve: api.documentEmailAttempts.resolve,
};

const apiWithAliases = new Proxy(api, {
	get(target, prop, receiver) {
		if (prop === "siteEditor") return siteEditorApi;
		if (prop === "portfolioEditor") return portfolioEditorApi;
		if (prop === "catalogProductGraphs") return catalogProductGraphsApi;
		if (prop === "galleryDelivery") {
			return new Proxy(target.galleries, {
				get(galleries, galleryProp, galleryReceiver) {
					if (galleryProp === "setPassword") return target.galleryPassword.setPassword;
					return Reflect.get(galleries, galleryProp, galleryReceiver);
				},
			});
		}
		if (prop === "blogContent") return blogContentApi;
		if (prop === "postContent") return postContentApi;
		if (prop === "documentEmailAttempts") return documentEmailAttemptsApi;
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
