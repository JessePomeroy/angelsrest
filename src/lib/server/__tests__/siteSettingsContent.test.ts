import { describe, expect, it, vi } from "vitest";
import { createSiteSettingsContentProvider } from "$lib/server/current/siteSettingsContent.server";
import { assetId, assetRoot, sourceSha256 } from "./fixtures/publicContent";

function settings() {
	return {
		revisionId: "settings-revision",
		publishedAt: 1000,
		payload: {
			artistName: "Jesse",
			siteTitle: "Angels Rest",
			tagline: "Photographs and stories",
			socialLinks: [{ platform: "instagram", url: "https://instagram.com/example" }],
			seoDescription: "A photography portfolio",
			seoOgImage: { url: `${assetRoot}/display-2048.webp`, assetId, sourceSha256 },
		},
	};
}

function provider(value: unknown) {
	return createSiteSettingsContentProvider({
		createReader: () => ({ loadPublished: async () => value }),
	});
}

describe("published Site Settings", () => {
	it("projects the accepted revision into public layout metadata", async () => {
		await expect(provider(settings()).load()).resolves.toEqual({
			artistName: "Jesse",
			siteTitle: "Angels Rest",
			tagline: "Photographs and stories",
			logoUrl: null,
			socialLinks: [{ platform: "instagram", url: "https://instagram.com/example" }],
			seo: {
				description: "A photography portfolio",
				ogImageUrl: `${assetRoot}/display-2048.webp`,
				keywords: [],
			},
		});
	});

	it("allows an explicitly empty social-link selection", async () => {
		const state = settings();
		await expect(
			provider({ ...state, payload: { ...state.payload, socialLinks: null } }).load(),
		).resolves.toMatchObject({ socialLinks: [] });
	});

	it.each([
		{ url: "https://example.com/unverified.webp" },
		{ assetId: "10000000-0000-4000-8000-000000000002" },
		{ sourceSha256: "not-a-digest" },
	])("rejects inconsistent public-image evidence: %j", async (image) => {
		const state = settings();
		Object.assign(state.payload.seoOgImage, image);
		await expect(provider(state).load()).rejects.toMatchObject({ status: 503 });
	});

	it("reports unavailable content instead of supplying an empty published page", async () => {
		await expect(provider(null).load()).rejects.toMatchObject({ status: 503 });
	});

	it("passes a cancellation signal to the reader and normalizes backend failure", async () => {
		const loadPublished = vi.fn().mockRejectedValue(new Error("Backend unavailable"));
		const content = createSiteSettingsContentProvider({ createReader: () => ({ loadPublished }) });
		await expect(content.load()).rejects.toMatchObject({ status: 503 });
		expect(loadPublished).toHaveBeenCalledWith(expect.any(AbortSignal));
	});
});
