import { describe, expect, it, vi } from "vitest";
import {
	calculateCatalogProductMargin,
	resolveCatalogProductVariantOptions,
} from "$lib/catalogProductMargin";
import { adminConfig } from "$lib/config/admin";

const {
	apiMock,
	blogApi,
	postApi,
	catalogApi,
	catalogGraphApi,
	contentApi,
	documentEmailApi,
	galleriesApi,
	mediaApi,
	portfolioApi,
} = vi.hoisted(() => {
	const editorRefs = (namespace: "blogContent" | "postContent") =>
		new Proxy({} as Record<string, string>, {
			get(_target, prop) {
				return typeof prop === "string" ? `${namespace}.${prop}` : undefined;
			},
		});
	const blogApi = editorRefs("blogContent");
	const postApi = editorRefs("postContent");
	const catalogApi = {
		listForEditor: "catalogProducts.listForEditor",
		getEditorState: "catalogProducts.getEditorState",
		createDraft: "catalogProducts.createDraft",
		saveDraft: "catalogProducts.saveDraft",
		discardDraft: "catalogProducts.discardDraft",
	};
	const catalogGraphRefs = {
		listForEditor: "catalogProductGraphs.listForEditor",
		getEditorState: "catalogProductGraphs.getEditorState",
		createDraft: "catalogProductGraphs.createDraft",
		saveDraft: "catalogProductGraphs.saveDraft",
		discardDraft: "catalogProductGraphs.discardDraft",
		listDraftPrivateAssetCandidates: "catalogProductGraphs.listDraftPrivateAssetCandidates",
		replaceDraftPrivateAsset: "catalogProductGraphs.replaceDraftPrivateAsset",
		publishDraft: "catalogProductGraphs.publishDraft",
		unpublish: "catalogProductGraphs.unpublish",
		listPublished: "catalogProductGraphs.listPublished",
		getPublishedBySlug: "catalogProductGraphs.getPublishedBySlug",
	};
	const catalogGraphApi = new Proxy({} as typeof catalogGraphRefs, {
		get(_target, prop) {
			if (typeof prop !== "string") return undefined;
			return (
				catalogGraphRefs[prop as keyof typeof catalogGraphRefs] ?? `catalogProductGraphs.${prop}`
			);
		},
	});
	const contentApi = {
		getSiteSettingsEditorState: "content.getSiteSettingsEditorState",
		saveSiteSettingsDraft: "content.saveSiteSettingsDraft",
		publishSiteSettings: "content.publishSiteSettings",
		discardSiteSettingsDraft: "content.discardSiteSettingsDraft",
		getHomepageQuoteEditorState: "content.getHomepageQuoteEditorState",
		getContactPageEditorState: "content.getContactPageEditorState",
		saveContactPageDraft: "content.saveContactPageDraft",
		publishContactPage: "content.publishContactPage",
		discardContactPageDraft: "content.discardContactPageDraft",
		getAboutPageEditorState: "content.getAboutPageEditorState",
		saveAboutPageDraft: "content.saveAboutPageDraft",
		publishAboutPage: "content.publishAboutPage",
		holdAboutPagePublication: "content.holdAboutPagePublication",
		discardAboutPageDraft: "content.discardAboutPageDraft",
	};
	const galleriesApi = { listBySite: "galleries.listBySite" };
	const documentEmailApi = {
		get: "documentEmailAttempts.get",
		getRecovery: "documentEmailAttempts.getRecovery",
		getOpenRecoveryByDocument: "documentEmailAttempts.getOpenRecoveryByDocument",
		prepare: "documentEmailAttempts.prepare",
		claim: "documentEmailAttempts.claim",
		complete: "documentEmailAttempts.complete",
		fail: "documentEmailAttempts.fail",
		resolve: "documentEmailAttempts.resolve",
	};
	const mediaApi = {
		listForEditor: "mediaAssets.listForEditor",
		getManyForEditor: "mediaAssets.getManyForEditor",
		registerReadyWebAsset: "mediaAssets.registerReadyWebAsset",
		requestDeletion: "mediaAssets.requestDeletion",
	};
	const portfolioApi = {
		listForEditor: "portfolioGalleries.listForEditor",
		getEditorState: "portfolioGalleries.getEditorState",
		saveDraft: "portfolioGalleries.saveDraft",
		publish: "portfolioGalleries.publish",
		reorder: "portfolioGalleries.reorder",
	};
	return {
		blogApi,
		postApi,
		catalogApi,
		catalogGraphApi,
		contentApi,
		documentEmailApi,
		galleriesApi,
		mediaApi,
		portfolioApi,
		apiMock: {
			catalogProducts: catalogApi,
			catalogProductGraphs: catalogGraphApi,
			content: contentApi,
			documentEmailAttempts: documentEmailApi,
			galleries: galleriesApi,
			galleryPassword: { setPassword: "galleryPassword.setPassword" },
			blogContent: blogApi,
			postContent: postApi,
			portfolioGalleries: portfolioApi,
			mediaAssets: mediaApi,
			crm: { getStats: "crm.getStats" },
		},
	};
});

vi.mock("$convex/api", () => ({ api: apiMock }));

describe("admin API aliases", () => {
	it("adds the CMS media registry without disturbing existing host aliases", () => {
		for (const [configured, source] of [
			[adminConfig.api.blogContent, blogApi],
			[adminConfig.api.postContent, postApi],
		] as const) {
			expect(configured).not.toBe(source);
			expect(Object.getPrototypeOf(configured)).toBe(Object.prototype);
			expect(Object.keys(configured ?? {})).toEqual([
				"listForEditor",
				"getEditorState",
				"createDraft",
				"saveDraft",
				"publish",
				"discardDraft",
				"unpublish",
				"archive",
				"restore",
			]);
			expect(Reflect.get(configured ?? {}, "importSanityBlogDrafts")).toBeUndefined();
			expect(Reflect.get(configured ?? {}, "restorePublishedManifest")).toBeUndefined();
		}
		expect(adminConfig.api.catalogProducts).toBe(catalogApi);
		expect(adminConfig.api.catalogProducts).not.toHaveProperty("publish");
		const productGraphApi = adminConfig.api.catalogProductGraphs;
		expect(productGraphApi).not.toBe(catalogGraphApi);
		expect(Object.getPrototypeOf(productGraphApi)).toBe(Object.prototype);
		expect(productGraphApi).toEqual({
			listForEditor: catalogGraphApi.listForEditor,
			getEditorState: catalogGraphApi.getEditorState,
			createDraft: catalogGraphApi.createDraft,
			saveDraft: catalogGraphApi.saveDraft,
			discardDraft: catalogGraphApi.discardDraft,
			listDraftPrivateAssetCandidates: catalogGraphApi.listDraftPrivateAssetCandidates,
			replaceDraftPrivateAsset: catalogGraphApi.replaceDraftPrivateAsset,
			publishDraft: catalogGraphApi.publishDraft,
			unpublish: catalogGraphApi.unpublish,
		});
		expect(Object.keys(catalogGraphApi)).toEqual([]);
		expect(Reflect.get(catalogGraphApi, "unknownCapability")).toBeTruthy();
		expect(Reflect.get(productGraphApi ?? {}, "unknownCapability")).toBeUndefined();
		expect(Reflect.get(productGraphApi ?? {}, "listPublished")).toBeUndefined();
		expect(Reflect.get(productGraphApi ?? {}, "getPublishedBySlug")).toBeUndefined();
		expect(Object.hasOwn(productGraphApi ?? {}, "publishDraft")).toBe(true);
		expect(Object.hasOwn(productGraphApi ?? {}, "unpublish")).toBe(true);
		expect(productGraphApi).not.toHaveProperty("publish");
		expect(adminConfig.api.mediaAssets?.listForEditor).toBe(mediaApi.listForEditor);
		expect(adminConfig.api.mediaAssets?.getManyForEditor).toBe(mediaApi.getManyForEditor);
		expect(adminConfig.api.mediaAssets?.registerReadyWebAsset).toBe(mediaApi.registerReadyWebAsset);
		expect(adminConfig.api.galleryDelivery?.listBySite).toBe(galleriesApi.listBySite);
		expect(adminConfig.api.galleryDelivery?.setPassword).toBe(apiMock.galleryPassword.setPassword);
		expect(adminConfig.api.crm).toBe(apiMock.crm);
		expect(adminConfig.api.documentEmailAttempts).not.toBe(documentEmailApi);
		expect(adminConfig.api.documentEmailAttempts).toEqual(documentEmailApi);
		expect(Object.keys(adminConfig.api.documentEmailAttempts ?? {})).toEqual([
			"get",
			"getRecovery",
			"getOpenRecoveryByDocument",
			"prepare",
			"claim",
			"complete",
			"fail",
			"resolve",
		]);
		expect(Reflect.get(adminConfig.api.documentEmailAttempts ?? {}, "unknownCapability")).toBe(
			undefined,
		);
		expect(adminConfig.api.siteEditor).not.toBe(contentApi);
		expect(adminConfig.api.siteEditor?.getSiteSettingsEditorState).toBe(
			contentApi.getSiteSettingsEditorState,
		);
		expect(adminConfig.api.siteEditor?.saveSiteSettingsDraft).toBe(
			contentApi.saveSiteSettingsDraft,
		);
		expect(adminConfig.api.siteEditor?.publishSiteSettings).toBe(contentApi.publishSiteSettings);
		expect(adminConfig.api.siteEditor?.discardSiteSettingsDraft).toBe(
			contentApi.discardSiteSettingsDraft,
		);
		expect(adminConfig.api.siteEditor?.getHomepageQuoteEditorState).toBe(
			contentApi.getHomepageQuoteEditorState,
		);
		expect(adminConfig.api.siteEditor?.getContactPageEditorState).toBe(
			contentApi.getContactPageEditorState,
		);
		expect(adminConfig.api.siteEditor?.saveContactPageDraft).toBe(contentApi.saveContactPageDraft);
		expect(adminConfig.api.siteEditor?.publishContactPage).toBeUndefined();
		expect(adminConfig.api.siteEditor?.discardContactPageDraft).toBe(
			contentApi.discardContactPageDraft,
		);
		expect(adminConfig.api.siteEditor?.getAboutPageEditorState).toBe(
			contentApi.getAboutPageEditorState,
		);
		expect(adminConfig.api.siteEditor?.saveAboutPageDraft).toBe(contentApi.saveAboutPageDraft);
		expect(adminConfig.api.siteEditor?.publishAboutPage).toBe(contentApi.holdAboutPagePublication);
		expect(adminConfig.api.siteEditor?.discardAboutPageDraft).toBe(
			contentApi.discardAboutPageDraft,
		);
		expect(adminConfig.api.siteEditor?.listMediaAssets).toBe(mediaApi.listForEditor);
		expect(adminConfig.api.siteEditor?.getPlacedMediaAssets).toBe(mediaApi.getManyForEditor);
		expect(Reflect.get(adminConfig.api.siteEditor ?? {}, "importPinnedDrafts")).toBeUndefined();
		expect(
			Reflect.get(adminConfig.api.siteEditor ?? {}, "restorePinnedPublishedRevisions"),
		).toBeUndefined();

		const portfolioEditor = adminConfig.api.portfolioEditor;
		expect(Object.getPrototypeOf(portfolioEditor ?? {})).toBe(Object.prototype);
		expect(Object.keys(portfolioEditor ?? {})).toEqual([
			"listForEditor",
			"getEditorState",
			"saveDraft",
			"setVisibility",
			"remove",
			"reorder",
			"listMediaAssets",
			"getPlacedMediaAssets",
			"registerReadyWebAsset",
			"requestDeletion",
		]);
		expect(portfolioEditor?.listForEditor).toBe(portfolioApi.listForEditor);
		expect(portfolioEditor?.getEditorState).toBe(portfolioApi.getEditorState);
		expect(portfolioEditor?.saveDraft).toBe(portfolioApi.saveDraft);
		expect(portfolioEditor?.publish).toBeUndefined();
		expect(Reflect.get(portfolioEditor ?? {}, "setVisibility")).toBe(
			Reflect.get(portfolioApi, "setVisibility"),
		);
		expect(Reflect.get(portfolioEditor ?? {}, "remove")).toBe(Reflect.get(portfolioApi, "remove"));
		expect(portfolioEditor?.reorder).toBe(portfolioApi.reorder);
		expect(portfolioEditor?.listMediaAssets).toBe(mediaApi.listForEditor);
		expect(portfolioEditor?.getPlacedMediaAssets).toBe(mediaApi.getManyForEditor);
		expect(portfolioEditor?.registerReadyWebAsset).toBe(mediaApi.registerReadyWebAsset);
		expect(portfolioEditor?.requestDeletion).toBe(mediaApi.requestDeletion);
		expect(Reflect.get(portfolioEditor ?? {}, "restorePinnedPublishedRevisions")).toBeUndefined();
		expect(adminConfig.editor?.blog?.mediaBaseUrl).toBe("https://media.angelsrest.online");
		expect(adminConfig.editor?.products).toEqual({
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
		});
		expect(adminConfig.editor?.siteSettings).toEqual({});
		expect(adminConfig.editor?.contactPage).toEqual({
			initialPayload: {
				heading: "Get in Touch",
				intro:
					"I'd love to hear from you. Whether you're looking to book a photo session, pick up some prints, or want to chat about a web project, drop me a line below. I build custom websites for photographers and creatives, so if you're looking for something like that too, let's talk. I'll get back to you as soon as I can.",
				email: "hello@angelsrest.online",
				confirmationMessage: "message sent !",
				bookingEnabled: true,
				bookingUrl: "https://cal.com/jesse-s1wmio/photosession",
				bookingLabel: "book a time",
				bookingIntro: "want to book a session or schedule a call?",
				inquiryChoices: [],
			},
		});
		expect(adminConfig.editor?.contactPage).not.toHaveProperty("previewEndpoint");
		expect(adminConfig.editor?.contactPage?.initialPayload).not.toHaveProperty("phone");
		expect(adminConfig.editor?.contactPage?.initialPayload).not.toHaveProperty("availability");
		expect(adminConfig.editor?.contactPage?.initialPayload).not.toHaveProperty("responseTime");
		expect(adminConfig.editor?.aboutPage).toEqual({
			initialPayload: {},
			mediaBaseUrl: "https://media.angelsrest.online",
			uploadEndpoint: "/api/admin/media",
		});
		expect(adminConfig.editor?.portfolio).toEqual({
			mediaBaseUrl: "https://media.angelsrest.online",
			uploadEndpoint: "/api/admin/media",
		});
		expect(adminConfig.mutationTransport).toBe("http");
	});
});
