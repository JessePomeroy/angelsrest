import { describe, expect, it, vi } from "vitest";
import { adminConfig } from "$lib/config/admin";

const { apiMock, catalogApi, catalogGraphApi, contentApi, galleriesApi, mediaApi, portfolioApi } =
	vi.hoisted(() => {
		const catalogApi = {
			listForEditor: "catalogProducts.listForEditor",
			getEditorState: "catalogProducts.getEditorState",
			createDraft: "catalogProducts.createDraft",
			saveDraft: "catalogProducts.saveDraft",
			discardDraft: "catalogProducts.discardDraft",
		};
		const catalogGraphApi = {
			listForEditor: "catalogProductGraphs.listForEditor",
			getEditorState: "catalogProductGraphs.getEditorState",
			createDraft: "catalogProductGraphs.createDraft",
			saveDraft: "catalogProductGraphs.saveDraft",
			discardDraft: "catalogProductGraphs.discardDraft",
		};
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
			catalogApi,
			catalogGraphApi,
			contentApi,
			galleriesApi,
			mediaApi,
			portfolioApi,
			apiMock: {
				catalogProducts: catalogApi,
				catalogProductGraphs: catalogGraphApi,
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
		expect(adminConfig.api.catalogProducts).toBe(catalogApi);
		expect(adminConfig.api.catalogProducts).not.toHaveProperty("publish");
		expect(adminConfig.api.catalogProductGraphs).toBe(catalogGraphApi);
		expect(adminConfig.api.catalogProductGraphs).not.toHaveProperty("publish");
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
		expect(adminConfig.api.siteEditor?.getContactPageEditorState).toBe(
			contentApi.getContactPageEditorState,
		);
		expect(adminConfig.api.siteEditor?.saveContactPageDraft).toBe(contentApi.saveContactPageDraft);
		expect(adminConfig.api.siteEditor?.publishContactPage).toBeUndefined();
		expect(adminConfig.api.siteEditor?.discardContactPageDraft).toBe(
			contentApi.discardContactPageDraft,
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
		expect(adminConfig.editor?.products).toEqual({
			enabledKinds: [
				"print",
				"print_set",
				"postcard",
				"merchandise",
				"tapestry",
				"digital_download",
			],
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
		expect(adminConfig.editor?.portfolio).toEqual({
			mediaBaseUrl: "https://media.angelsrest.online",
			uploadEndpoint: "/api/admin/media",
		});
	});
});
