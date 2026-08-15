import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({ env: {} }));
vi.mock("$env/dynamic/public", () => ({
	env: {
		PUBLIC_CONVEX_URL: "https://convex.test",
		PUBLIC_SANITY_PROJECT_ID: "project",
		PUBLIC_SANITY_DATASET: "production",
	},
}));
vi.mock("$lib/sanity/client.server", () => ({ getSanityClient: vi.fn() }));
vi.mock("$lib/server/logger", () => ({ logStructured: vi.fn() }));

import type { BlogPostDetail, BlogPostSummary } from "$lib/blog/content";
import {
	adaptConvexBlogIndex,
	adaptConvexBlogPost,
	adaptSanityBlogIndex,
	adaptSanityBlogPost,
	compareBlogDetails,
	compareBlogIndexes,
	createBlogContentProvider,
	parseBlogProviderMode,
} from "$lib/server/blogContent.server";

const publishedAt = "2026-08-15T00:00:00.000Z";
const timestamp = Date.parse(publishedAt);

function sanityImage() {
	return {
		assetRef: "image-abcdef1234567890-3000x2000-jpg",
		assetWidth: 3000,
		assetHeight: 2000,
		crop: null,
		hotspot: null,
		alt: "A descriptive photograph",
		caption: null,
	};
}

function sanitySummary() {
	return {
		title: "A quiet post",
		slug: "a-quiet-post",
		publishedAt,
		postType: "standard",
		excerpt: "A short body...",
		mainImage: sanityImage(),
		author: { name: "Jesse" },
		categories: [{ title: "Journal" }],
	};
}

function sanityDetail() {
	return {
		title: "A quiet post",
		slug: "a-quiet-post",
		publishedAt,
		postType: "standard",
		excerpt: "A short body...",
		brief: null,
		approach: null,
		result: null,
		gearUsed: [],
		mainImage: sanityImage(),
		author: { name: "Jesse", image: null },
		categories: [{ title: "Journal" }],
		body: [
			{
				_key: "body-1",
				_type: "block",
				style: "normal",
				listItem: null,
				level: null,
				children: [
					{
						_key: "span-1",
						_type: "span",
						text: "A short body",
						marks: [],
					},
				],
				markDefs: [],
				alt: null,
				caption: null,
				assetRef: null,
				assetWidth: null,
				assetHeight: null,
				crop: null,
				hotspot: null,
			},
		],
	};
}

function convexAsset() {
	const prefix = "sites/angelsrest.online/web/10000000-0000-4000-8000-000000000001/";
	return {
		assetId: "10000000-0000-4000-8000-000000000001",
		source: { width: 3000, height: 2000 },
		derivatives: {
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
				width: 2048,
				height: 1365,
			},
			display2560: {
				key: `${prefix}display-2560.webp`,
				contentType: "image/webp",
				width: 2560,
				height: 1707,
			},
		},
	};
}

function convexPlacement() {
	return {
		key: "main-image",
		altText: "A quiet post",
		asset: convexAsset(),
	};
}

function convexSummary() {
	return {
		revisionId: "private-revision-id",
		rank: 0,
		publishedAt: timestamp,
		payload: {
			kind: "post",
			title: "A quiet post",
			slug: "a-quiet-post",
			format: "essay",
			presentation: "standard",
			displayPublishedAt: timestamp,
			summary: "A short body...",
			excerpt: "A short body...",
			author: { name: "Jesse", slug: "jesse" },
			categories: [{ title: "Journal", slug: "journal" }],
			mainImage: convexPlacement(),
		},
	};
}

function convexDetail() {
	return {
		revisionId: "private-revision-id",
		publishedAt: timestamp,
		payload: {
			kind: "post",
			title: "A quiet post",
			slug: "a-quiet-post",
			format: "essay",
			presentation: "standard",
			displayPublishedAt: timestamp,
			summary: "A short body...",
			excerpt: "A short body...",
			equipment: [],
			materials: [],
			author: { kind: "author", name: "Jesse", slug: "jesse" },
			categories: [{ kind: "category", title: "Journal", slug: "journal" }],
			mainImage: convexPlacement(),
			body: {
				version: 1,
				blocks: [
					{
						type: "paragraph",
						key: "body-1",
						children: [{ type: "text", key: "span-1", text: "A short body", marks: [] }],
					},
				],
			},
		},
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}

function fakeSanity(
	index: BlogPostSummary[] = adaptSanityBlogIndex([sanitySummary()]),
	detail: BlogPostDetail | null = adaptSanityBlogPost(sanityDetail()),
) {
	return {
		loadIndex: vi.fn(async () => index),
		loadPost: vi.fn(async () => detail),
	};
}

function fakeReader(
	options: {
		list?: Promise<unknown>;
		detail?: Promise<unknown>;
		resolution?: Promise<unknown>;
	} = {},
) {
	return {
		listPublished: vi.fn(() => options.list ?? Promise.resolve([convexSummary()])),
		getPublishedBySlug: vi.fn(() => options.detail ?? Promise.resolve(convexDetail())),
		resolvePublishedSlug: vi.fn(() => options.resolution ?? Promise.resolve(null)),
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe("Blog public adapters", () => {
	it.each([
		["sanity", "sanity"],
		["shadow", "shadow"],
		["convex", "convex"],
		[undefined, "sanity"],
		[null, "sanity"],
		["", "sanity"],
		[" convex ", "sanity"],
		["Convex", "sanity"],
		["other", "sanity"],
	])("parses %j as %s", (value, expected) => {
		expect(parseBlogProviderMode(value)).toBe(expected);
	});

	it("normalizes both providers to identifier-free DTOs with equivalent public semantics", () => {
		const sanityIndex = adaptSanityBlogIndex([{ ...sanitySummary(), mainImage: null }]);
		const convexIndexSource = convexSummary();
		delete (convexIndexSource.payload as { mainImage?: unknown }).mainImage;
		const convexIndex = adaptConvexBlogIndex([convexIndexSource]);
		expect(compareBlogIndexes(sanityIndex, convexIndex)).toMatchObject({
			codes: [],
			mismatchCount: 0,
			primaryCount: 1,
			secondaryCount: 1,
		});
		const sanityPost = adaptSanityBlogPost({ ...sanityDetail(), mainImage: null });
		const convexPostSource = convexDetail();
		delete (convexPostSource.payload as { mainImage?: unknown }).mainImage;
		const convexPost = adaptConvexBlogPost(convexPostSource);
		expect(compareBlogDetails(sanityPost, convexPost)).toMatchObject({
			codes: [],
			mismatchCount: 0,
		});
		const serialized = JSON.stringify({ convexIndex, convexPost });
		expect(serialized).not.toMatch(/private-revision-id|main-image|span-1/);
	});

	it("requires the real Convex invariant that published summary and excerpt are identical", () => {
		const index = convexSummary();
		index.payload.excerpt = "Impossible divergent excerpt";
		expect(() => adaptConvexBlogIndex([index])).toThrow("Malformed public Blog projection");

		const detail = convexDetail();
		detail.payload.excerpt = "Impossible divergent excerpt";
		expect(() => adaptConvexBlogPost(detail)).toThrow("Malformed public Blog projection");
	});

	it("reports delivered image dimensions instead of source dimensions", () => {
		expect(adaptSanityBlogIndex([sanitySummary()])[0]?.mainImage).toMatchObject({
			width: 600,
			height: 340,
		});
		expect(adaptSanityBlogPost(sanityDetail())?.mainImage).toMatchObject({
			width: 800,
			height: 533,
		});
		expect(adaptConvexBlogIndex([convexSummary()])[0]?.mainImage).toMatchObject({
			width: 768,
			height: 512,
		});
		expect(adaptConvexBlogPost(convexDetail())?.mainImage).toMatchObject({
			width: 1280,
			height: 853,
		});
	});

	it("preserves Sanity's four photography roles and flags the lossy Convex summary", () => {
		const sanitySource = { ...sanityDetail(), mainImage: null };
		(sanitySource.gearUsed as unknown[]).push({
			_key: "gear-1",
			camera: "Hasselblad 500CM",
			lens: "80mm f/2.8",
			filmStock: "Portra 400",
			developer: "C-41",
		});
		const convexSource = convexDetail();
		delete (convexSource.payload as { mainImage?: unknown }).mainImage;
		(convexSource.payload.equipment as unknown[]).push({
			key: "gear-1",
			label: "Hasselblad 500CM · 80mm f/2.8",
			details: "Hasselblad 500CM · 80mm f/2.8 · Portra 400 · C-41",
		});
		const sanityPost = adaptSanityBlogPost(sanitySource);
		const convexPost = adaptConvexBlogPost(convexSource);

		expect(sanityPost?.equipment).toEqual([
			{
				kind: "photography",
				camera: "Hasselblad 500CM",
				lens: "80mm f/2.8",
				filmStock: "Portra 400",
				developer: "C-41",
			},
		]);
		expect(convexPost?.equipment).toEqual([
			{
				kind: "summary",
				label: "Hasselblad 500CM · 80mm f/2.8",
				details: "Hasselblad 500CM · 80mm f/2.8 · Portra 400 · C-41",
			},
		]);
		expect(compareBlogDetails(sanityPost, convexPost)).toMatchObject({
			codes: ["technical"],
			mismatchCount: 1,
		});
	});

	it.each([
		"crop",
		"hotspot",
	] as const)("normalizes and compares Sanity %s framing without leaking its asset reference", (framingKind) => {
		const source = sanitySummary();
		Object.assign(
			source.mainImage,
			framingKind === "crop"
				? { crop: { top: 0.1, right: 0.2, bottom: 0.1, left: 0.2 } }
				: { hotspot: { x: 0.4, y: 0.6, width: 0.5, height: 0.5 } },
		);
		const primary = adaptSanityBlogIndex([source]);
		const secondary = adaptConvexBlogIndex([convexSummary()]);
		const leftImage = primary[0]?.mainImage;
		const rightImage = secondary[0]?.mainImage;
		if (!leftImage || !rightImage) throw new Error("Fixture image is missing");
		rightImage.width = leftImage.width;
		rightImage.height = leftImage.height;

		expect(leftImage.framing).not.toBeNull();
		expect(compareBlogIndexes(primary, secondary)).toMatchObject({
			codes: ["media"],
			mismatchCount: 1,
		});
		expect(JSON.stringify(leftImage)).not.toContain(source.mainImage.assetRef);
	});

	it("preserves the complete Sanity list instead of truncating it to the Convex read bound", () => {
		const source = Array.from({ length: 13 }, (_, index) => ({
			...sanitySummary(),
			slug: `post-${index + 1}`,
		}));

		expect(adaptSanityBlogIndex(source)).toHaveLength(13);
	});

	it("fails closed on unexpected provider fields and malformed assets", () => {
		expect(() => adaptSanityBlogIndex([{ ...sanitySummary(), secret: "must not pass" }])).toThrow(
			"Malformed public Blog projection",
		);
		const malformed = convexSummary();
		malformed.payload.mainImage.asset.assetId = "not-a-uuid";
		expect(() => adaptConvexBlogIndex([malformed])).toThrow("Malformed public Blog projection");
	});
});

describe("Blog source selector", () => {
	it("branches preview to Sanity before reading mode or constructing the secondary", async () => {
		const sanity = fakeSanity();
		const mode = vi.fn(() => "convex");
		const createReader = vi.fn(() => fakeReader());
		const timer = vi.spyOn(globalThis, "setTimeout");
		const provider = createBlogContentProvider({ sanity, mode, createReader });

		await provider.loadIndex(true);
		await provider.loadPost("a-quiet-post", true);

		expect(sanity.loadIndex).toHaveBeenCalledWith(true);
		expect(sanity.loadPost).toHaveBeenCalledWith("a-quiet-post", true);
		expect(mode).not.toHaveBeenCalled();
		expect(createReader).not.toHaveBeenCalled();
		expect(timer).not.toHaveBeenCalled();
	});

	it("does not fall back to Sanity when a Convex read fails", async () => {
		const sanity = fakeSanity();
		const provider = createBlogContentProvider({
			sanity,
			mode: () => "convex",
			createReader: () => fakeReader({ list: Promise.reject(new Error("offline")) }),
		});

		await expect(provider.loadIndex(false)).rejects.toMatchObject({ status: 503 });
		expect(sanity.loadIndex).not.toHaveBeenCalled();
	});

	it("permanently redirects a retained Convex slug without a Sanity fallback", async () => {
		const sanity = fakeSanity();
		const provider = createBlogContentProvider({
			sanity,
			mode: () => "convex",
			createReader: () =>
				fakeReader({
					detail: Promise.resolve(null),
					resolution: Promise.resolve({
						status: "redirect",
						kind: "post",
						slug: "a-quiet-post",
					}),
				}),
		});

		await expect(provider.loadPost("old-post", false)).rejects.toMatchObject({
			status: 308,
			location: "/blog/a-quiet-post",
		});
		expect(sanity.loadPost).not.toHaveBeenCalled();
	});

	it("serves the exact Sanity result in shadow mode and logs only bounded mismatch metadata", async () => {
		const primary = adaptSanityBlogIndex([{ ...sanitySummary(), mainImage: null }]);
		const changed = convexSummary();
		delete (changed.payload as { mainImage?: unknown }).mainImage;
		changed.payload.title = "Private mismatched title";
		const log = vi.fn();
		const provider = createBlogContentProvider({
			sanity: fakeSanity(primary),
			mode: () => "shadow",
			createReader: () => fakeReader({ list: Promise.resolve([changed]) }),
			log,
		});

		await expect(provider.loadIndex(false)).resolves.toBe(primary);
		expect(log).toHaveBeenCalledOnce();
		expect(log.mock.calls[0]?.[0]).toMatchObject({
			event: "blog.shadow_closed",
			meta: {
				codes: ["copy"],
				mismatchCount: 1,
				primaryCount: 1,
				secondaryCount: 1,
			},
		});
		expect(JSON.stringify(log.mock.calls[0]?.[0])).not.toMatch(
			/Private mismatched title|a-quiet-post|Jesse|Journal/,
		);
	});

	it("bounds a stalled shadow read and still serves Sanity", async () => {
		vi.useFakeTimers();
		const stalled = deferred<unknown>();
		const log = vi.fn();
		const primary = adaptSanityBlogIndex([sanitySummary()]);
		const provider = createBlogContentProvider({
			sanity: fakeSanity(primary),
			mode: () => "shadow",
			createReader: () => fakeReader({ list: stalled.promise }),
			log,
			deadlineMs: 5,
		});

		const result = provider.loadIndex(false);
		await vi.advanceTimersByTimeAsync(5);
		await expect(result).resolves.toBe(primary);
		expect(log.mock.calls[0]?.[0]).toMatchObject({
			meta: { codes: ["timeout"], mismatchCount: 1 },
		});
	});
});
