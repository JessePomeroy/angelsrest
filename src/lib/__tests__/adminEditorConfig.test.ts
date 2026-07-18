import { describe, expect, it, vi } from "vitest";
import { adminConfig } from "$lib/config/admin";

const { apiMock, galleriesApi, mediaApi, portfolioApi } = vi.hoisted(() => {
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
	};
	return {
		galleriesApi,
		mediaApi,
		portfolioApi,
		apiMock: {
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
		expect(adminConfig.api.galleryDelivery?.listBySite).toBe(galleriesApi.listBySite);
		expect(adminConfig.api.galleryDelivery?.setPassword).toBe(apiMock.galleryPassword.setPassword);
		expect(adminConfig.api.crm).toBe(apiMock.crm);

		const portfolioEditor = adminConfig.api.portfolioEditor;
		expect(portfolioEditor?.listForEditor).toBe(portfolioApi.listForEditor);
		expect(portfolioEditor?.getEditorState).toBe(portfolioApi.getEditorState);
		expect(portfolioEditor?.listMediaAssets).toBe(mediaApi.listForEditor);
		expect(portfolioEditor?.getPlacedMediaAssets).toBe(mediaApi.getManyForEditor);
		expect(portfolioEditor?.registerReadyWebAsset).toBe(mediaApi.registerReadyWebAsset);
		expect(portfolioEditor?.requestDeletion).toBe(mediaApi.requestDeletion);
	});
});
