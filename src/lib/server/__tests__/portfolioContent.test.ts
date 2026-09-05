import { describe, expect, it, vi } from "vitest";
import { SITE_DOMAIN } from "$lib/config/site";
import { createPortfolioContentProvider } from "$lib/server/current/portfolioContent.server";
import { assetRoot, sourceSha256, webAsset } from "./fixtures/publicContent";

function gallery() {
	const asset = webAsset();
	return {
		galleryId: "gallery-1",
		revisionId: "gallery-revision",
		sourceDocumentId: null,
		sourceDocumentRevision: null,
		title: "Quiet Places",
		description: "Michigan landscapes",
		slug: "quiet-places",
		portfolioOrder: 0,
		isVisible: true,
		publishedAt: 1000,
		seo: { description: "Landscape photographs", ogImage: null },
		placements: [
			{
				key: "first",
				order: 0,
				altText: "Mist over the lake",
				caption: null,
				focalPoint: null,
				sourceAssetRef: null,
				sourceCropCanonical: null,
				sourceHotspotCanonical: null,
				asset: { ...asset, source: { ...asset.source, sha256: sourceSha256 } },
			},
		],
	};
}

function provider(value: unknown) {
	return createPortfolioContentProvider({
		createReader: () => ({
			listPublished: async () => [value],
			getPublishedBySlug: async () => value,
		}),
	});
}

describe("published portfolio galleries", () => {
	it("projects list previews and detail images from immutable public derivatives", async () => {
		const content = provider(gallery());
		await expect(content.list()).resolves.toEqual([
			{
				title: "Quiet Places",
				slug: "quiet-places",
				preview: `${assetRoot}/card.webp`,
			},
		]);
		await expect(content.getBySlug("quiet-places")).resolves.toEqual({
			title: "Quiet Places",
			description: "Michigan landscapes",
			canonicalUrl: `https://${SITE_DOMAIN}/gallery/quiet-places`,
			seo: { description: "Landscape photographs", ogImageUrl: null },
			images: [
				{
					thumbnail: `${assetRoot}/card.webp`,
					full: `${assetRoot}/display-2048.webp`,
					alt: "Mist over the lake",
				},
			],
		});
	});

	it("distinguishes an empty portfolio and a missing gallery from a failed read", async () => {
		const getPublishedBySlug = vi.fn().mockResolvedValue(null);
		const content = createPortfolioContentProvider({
			createReader: () => ({
				listPublished: async () => [],
				getPublishedBySlug,
			}),
		});
		await expect(content.list()).resolves.toEqual([]);
		await expect(content.getBySlug("missing")).resolves.toBeNull();
		expect(getPublishedBySlug).toHaveBeenCalledWith("missing", expect.any(AbortSignal));
	});

	it("supports published galleries without images", async () => {
		const content = provider({ ...gallery(), placements: [] });
		await expect(content.list()).resolves.toMatchObject([{ preview: null }]);
		await expect(content.getBySlug("quiet-places")).resolves.toMatchObject({ images: [] });
	});

	it.each([
		[
			"hidden gallery",
			(row: ReturnType<typeof gallery>) => {
				row.isVisible = false;
			},
		],
		[
			"out-of-order placement",
			(row: ReturnType<typeof gallery>) => {
				row.placements[0].order = 1;
			},
		],
		[
			"foreign derivative",
			(row: ReturnType<typeof gallery>) => {
				row.placements[0].asset.derivatives.card.key = "sites/another.example/web/other/card.webp";
			},
		],
		[
			"invalid source digest",
			(row: ReturnType<typeof gallery>) => {
				row.placements[0].asset.source.sha256 = "bad-digest";
			},
		],
	])("rejects a %s on both list and detail reads", async (_name, change) => {
		const row = gallery();
		change(row);
		const content = provider(row);
		await expect(content.list()).rejects.toMatchObject({ status: 503 });
		await expect(content.getBySlug("quiet-places")).rejects.toMatchObject({ status: 503 });
	});

	it("rejects a list that exceeds the published gallery limit", async () => {
		const content = createPortfolioContentProvider({
			createReader: () => ({
				listPublished: async () => Array.from({ length: 101 }, gallery),
				getPublishedBySlug: async () => null,
			}),
		});
		await expect(content.list()).rejects.toMatchObject({ status: 503 });
	});

	it("normalizes failed list and detail reads to unavailable", async () => {
		const read = vi.fn().mockRejectedValue(new DOMException("Read aborted", "AbortError"));
		const content = createPortfolioContentProvider({
			createReader: () => ({ listPublished: read, getPublishedBySlug: read }),
		});
		await expect(content.list()).rejects.toMatchObject({ status: 503 });
		await expect(content.getBySlug("quiet-places")).rejects.toMatchObject({ status: 503 });
	});
});
