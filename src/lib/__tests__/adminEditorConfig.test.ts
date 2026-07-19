import { describe, expect, it, vi } from "vitest";
import { adminConfig } from "$lib/config/admin";

const { apiMock, contentApi, galleriesApi, mediaApi, portfolioApi } = vi.hoisted(() => {
	const contentApi = {
		getSiteSettingsEditorState: "content.getSiteSettingsEditorState",
		saveSiteSettingsDraft: "content.saveSiteSettingsDraft",
		publishSiteSettings: "content.publishSiteSettings",
		discardSiteSettingsDraft: "content.discardSiteSettingsDraft",
		getHomepageQuoteEditorState: "content.getHomepageQuoteEditorState",
	};
	const galleriesApi = { listBySite: "galleries.listBySite" };
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
		contentApi,
		galleriesApi,
		mediaApi,
		portfolioApi,
		apiMock: {
			content: contentApi,
			galleries: galleriesApi,
			galleryPassword: { setPassword: "galleryPassword.setPassword" },
			blogContent: { listForEditor: "blogContent.listForEditor" },
			postContent: { listForEditor: "postContent.listForEditor" },
			portfolioGalleries: portfolioApi,
			mediaAssets: mediaApi,
			crm: { getStats: "crm.getStats" },
		},
	};
});

vi.mock("$convex/api", () => ({ api: apiMock }));

describe("admin API aliases", () => {
	it("adds the CMS media registry without disturbing existing host aliases", () => {
		expect(adminConfig.api.blogContent).toBe(apiMock.blogContent);
		expect(adminConfig.api.postContent).toBe(apiMock.postContent);
		expect(adminConfig.api.mediaAssets?.getManyForEditor).toBe(mediaApi.getManyForEditor);
		expect(adminConfig.api.galleryDelivery?.listBySite).toBe(galleriesApi.listBySite);
		expect(adminConfig.api.galleryDelivery?.setPassword).toBe(apiMock.galleryPassword.setPassword);
		expect(adminConfig.api.crm).toBe(apiMock.crm);
		expect(adminConfig.api.siteEditor).not.toBe(contentApi);
		expect(adminConfig.api.siteEditor?.getSiteSettingsEditorState).toBe(
			contentApi.getSiteSettingsEditorState,
		);
		expect(adminConfig.api.siteEditor?.saveSiteSettingsDraft).toBe(
			contentApi.saveSiteSettingsDraft,
		);
		expect(adminConfig.api.siteEditor?.publishSiteSettings).toBeUndefined();
		expect(adminConfig.api.siteEditor?.discardSiteSettingsDraft).toBe(
			contentApi.discardSiteSettingsDraft,
		);
		expect(adminConfig.api.siteEditor?.getHomepageQuoteEditorState).toBe(
			contentApi.getHomepageQuoteEditorState,
		);

		const portfolioEditor = adminConfig.api.portfolioEditor;
		expect(portfolioEditor?.listForEditor).toBe(portfolioApi.listForEditor);
		expect(portfolioEditor?.getEditorState).toBe(portfolioApi.getEditorState);
		expect(portfolioEditor?.saveDraft).toBe(portfolioApi.saveDraft);
		expect(portfolioEditor?.publish).toBeUndefined();
		expect(portfolioEditor?.reorder).toBe(portfolioApi.reorder);
		expect(portfolioEditor?.listMediaAssets).toBe(mediaApi.listForEditor);
		expect(portfolioEditor?.getPlacedMediaAssets).toBe(mediaApi.getManyForEditor);
		expect(portfolioEditor?.registerReadyWebAsset).toBe(mediaApi.registerReadyWebAsset);
		expect(portfolioEditor?.requestDeletion).toBe(mediaApi.requestDeletion);
		expect(adminConfig.editor?.blog?.mediaBaseUrl).toBe("https://media.angelsrest.online");
		expect(adminConfig.editor?.siteSettings).toEqual({});
		expect(adminConfig.editor?.portfolio).toEqual({
			mediaBaseUrl: "https://media.angelsrest.online",
			uploadEndpoint: "/api/admin/media",
		});
	});
});
