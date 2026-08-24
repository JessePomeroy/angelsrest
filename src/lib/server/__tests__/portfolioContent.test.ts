import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({ env: {} }));
vi.mock("$env/dynamic/public", () => ({
	env: { PUBLIC_CONVEX_URL: "https://convex.test" },
}));
vi.mock("$lib/sanity/client.server", () => ({ getSanityClient: vi.fn() }));
vi.mock("$lib/server/logger", () => ({ logStructured: vi.fn() }));
vi.mock("$lib/sanity/client", () => ({
	urlFor: (source: { asset: { _ref: string } }) => {
		let width = 0;
		let quality = 0;
		return {
			width(value: number) {
				width = value;
				return this;
			},
			format() {
				return this;
			},
			quality(value: number) {
				quality = value;
				return this;
			},
			url() {
				return `https://sanity.test/${source.asset._ref}/${width}/${quality}`;
			},
		};
	},
}));

import {
	adaptConvexPortfolioDetail,
	adaptConvexPortfolioList,
	adaptSanityPortfolioDetail,
	adaptSanityPortfolioList,
	createPortfolioContentProvider,
	parsePortfolioProviderMode,
} from "$lib/server/portfolioContent.server";

const SOURCE_ID = "gallery-source";
const SOURCE_REVISION = "gallery-revision";
const SOURCE_REF = "image-abcdef-1800x1200-jpg";
const WORKER_ID = "123e4567-e89b-42d3-a456-426614174000";

function sanityImage() {
	return {
		_key: "hero",
		alt: "Portrait in window light",
		crop: null,
		hotspot: null,
		assetRef: SOURCE_REF,
		width: 1800,
		height: 1200,
	};
}

function sanityList() {
	return [
		{
			_id: SOURCE_ID,
			_rev: SOURCE_REVISION,
			title: "Selected work",
			slug: "selected-work",
			orderRank: "a0",
			previewImage: sanityImage(),
		},
	];
}

function sanityDetail() {
	return [
		{
			_id: SOURCE_ID,
			_rev: SOURCE_REVISION,
			title: "Selected work",
			slug: "selected-work",
			description: "A deliberate sequence.",
			images: [sanityImage()],
			seo: null,
		},
	];
}

function derivatives() {
	const prefix = `sites/angelsrest.online/web/${WORKER_ID}/`;
	return {
		thumb: { key: `${prefix}thumb.webp`, contentType: "image/webp", width: 320, height: 213 },
		card: { key: `${prefix}card.webp`, contentType: "image/webp", width: 768, height: 512 },
		display1280: {
			key: `${prefix}display-1280.webp`,
			contentType: "image/webp",
			width: 1280,
			height: 853,
		},
		display2048: {
			key: `${prefix}display-2048.webp`,
			contentType: "image/webp",
			width: 1800,
			height: 1200,
		},
		display2560: {
			key: `${prefix}display-2560.webp`,
			contentType: "image/webp",
			width: 1800,
			height: 1200,
		},
	};
}

function convexGallery() {
	return {
		galleryId: "gallery-id",
		revisionId: "revision-id",
		sourceDocumentId: SOURCE_ID,
		sourceDocumentRevision: SOURCE_REVISION,
		title: "Selected work",
		description: "A deliberate sequence.",
		slug: "selected-work",
		portfolioOrder: 0,
		isVisible: true,
		publishedAt: 1,
		seo: { description: null, ogImage: null },
		placements: [
			{
				key: "hero",
				order: 0,
				altText: "Portrait in window light",
				caption: null,
				focalPoint: null,
				sourceAssetRef: SOURCE_REF,
				sourceCropCanonical: "null",
				sourceHotspotCanonical: "null",
				asset: {
					assetId: WORKER_ID,
					source: { width: 1800, height: 1200, sha256: "a".repeat(64) },
					derivatives: derivatives(),
				},
			},
		],
	};
}

function sanitySource() {
	return {
		list: vi.fn(async () => adaptSanityPortfolioList(sanityList())),
		getBySlug: vi.fn(async () => adaptSanityPortfolioDetail(sanityDetail())),
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("Portfolio provider boundary", () => {
	it("normalizes current Sanity rendering and fixed Convex derivatives", () => {
		const sanity = adaptSanityPortfolioDetail(sanityDetail());
		const convex = adaptConvexPortfolioDetail(convexGallery());
		expect(sanity?.content).toMatchObject({
			title: "Selected work",
			canonicalUrl: "https://angelsrest.online/gallery/selected-work",
			images: [
				{
					thumbnail: `https://sanity.test/${SOURCE_REF}/400/80`,
					full: `https://sanity.test/${SOURCE_REF}/1600/90`,
				},
			],
		});
		expect(convex?.content).toMatchObject({
			title: "Selected work",
			canonicalUrl: "https://angelsrest.online/gallery/selected-work",
			images: [
				{
					thumbnail: `https://media.angelsrest.online/sites/angelsrest.online/web/${WORKER_ID}/card.webp`,
					full: `https://media.angelsrest.online/sites/angelsrest.online/web/${WORKER_ID}/display-2048.webp`,
				},
			],
		});
		expect(adaptSanityPortfolioList(sanityList()).content[0]).not.toHaveProperty("category");
		expect(adaptConvexPortfolioList([convexGallery()]).content[0]).not.toHaveProperty("category");
		const canonicalMismatch = sanityDetail();
		const mismatchGallery = canonicalMismatch[0];
		if (!mismatchGallery) throw new Error("Missing canonical mismatch fixture");
		mismatchGallery.title = "Clownin~";
		mismatchGallery.slug = "clownin";
		expect(adaptSanityPortfolioDetail(canonicalMismatch)?.content.canonicalUrl).toBe(
			"https://angelsrest.online/gallery/clownin~",
		);

		const duplicate = sanityDetail();
		duplicate.push(structuredClone(duplicate[0]));
		expect(() => adaptSanityPortfolioDetail(duplicate)).toThrow(
			"Malformed public Portfolio projection",
		);
	});

	it("keeps preview on Sanity, defaults invalid modes to Sanity, and never falls back", async () => {
		expect(parsePortfolioProviderMode(undefined)).toBe("sanity");
		expect(parsePortfolioProviderMode(" convex ")).toBe("sanity");
		const sanity = sanitySource();
		const mode = vi.fn(() => "convex");
		const createReader = vi.fn(() => ({
			listPublished: vi.fn(),
			getPublishedBySlug: vi.fn(),
		}));
		const provider = createPortfolioContentProvider({ sanity, mode, createReader });
		await provider.list(true);
		expect(sanity.list).toHaveBeenCalledWith(true);
		expect(mode).not.toHaveBeenCalled();
		expect(createReader).not.toHaveBeenCalled();

		const unavailable = createPortfolioContentProvider({
			sanity,
			mode: () => "convex",
			createReader: () => ({
				listPublished: async () => {
					throw new Error("offline");
				},
				getPublishedBySlug: async () => null,
			}),
		});
		await expect(unavailable.list(false)).rejects.toMatchObject({ status: 503 });
		expect(sanity.list).toHaveBeenCalledTimes(1);
	});

	it("serves Sanity in shadow and logs only bounded mismatch metadata", async () => {
		const log = vi.fn();
		const changed = convexGallery();
		changed.title = "Private changed title";
		const provider = createPortfolioContentProvider({
			sanity: sanitySource(),
			mode: () => "shadow",
			createReader: () => ({
				listPublished: async () => [changed],
				getPublishedBySlug: async () => changed,
			}),
			log,
		});
		await expect(provider.getBySlug("selected-work", false)).resolves.toMatchObject({
			title: "Selected work",
		});
		expect(log).toHaveBeenCalledOnce();
		expect(log.mock.calls[0]?.[0]).toMatchObject({
			event: "portfolio.shadow_closed",
			meta: { codes: ["detail"], mismatchCount: 1, primaryCount: 1, secondaryCount: 1 },
		});
		expect(JSON.stringify(log.mock.calls[0]?.[0])).not.toContain("Private changed title");
	});
});
