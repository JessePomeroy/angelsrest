import { describe, expect, it, vi } from "vitest";
import { SITE_URL } from "$lib/config/site";
import { createBlogContentProvider } from "$lib/server/current/blogContent.server";
import { assetRoot, webAsset } from "./fixtures/publicContent";

function summary() {
	return {
		revisionId: "post-revision",
		rank: 0,
		publishedAt: 1000,
		payload: {
			kind: "post",
			title: "Quiet Light",
			slug: "quiet-light",
			format: "essay",
			presentation: "standard",
			displayPublishedAt: 0,
			summary: "A morning at the lake",
			excerpt: "A morning at the lake",
			author: { name: "Jesse", slug: "jesse" },
			categories: [{ title: "Field notes", slug: "field-notes" }],
			mainImage: { key: "cover", altText: "Light on the water", asset: webAsset() },
		},
	};
}

function post() {
	const row = summary();
	return {
		revisionId: row.revisionId,
		publishedAt: row.publishedAt,
		payload: {
			...row.payload,
			author: { ...row.payload.author, kind: "author" },
			categories: row.payload.categories.map((category) => ({ ...category, kind: "category" })),
			equipment: [{ key: "camera", label: "Camera", details: "35mm" }],
			materials: [],
			body: {
				version: 1,
				blocks: [
					{
						type: "paragraph",
						key: "opening",
						children: [
							{
								type: "text",
								key: "sentence",
								text: " Quiet light. ",
								marks: [{ type: "strong" }],
							},
						],
					},
				],
			},
		},
	};
}

function reader() {
	return {
		listPublished: vi
			.fn<(signal: AbortSignal) => Promise<unknown>>()
			.mockResolvedValue([summary()]),
		getPublishedBySlug: vi
			.fn<(slug: string, signal: AbortSignal) => Promise<unknown>>()
			.mockResolvedValue(post()),
		resolvePublishedSlug: vi
			.fn<(slug: string, signal: AbortSignal) => Promise<unknown>>()
			.mockResolvedValue(null),
	};
}

describe("published Blog", () => {
	it("projects summaries using delivered card dimensions and the display publication date", async () => {
		const content = createBlogContentProvider({ createReader: reader });
		await expect(content.loadIndex()).resolves.toEqual([
			{
				siteUrl: SITE_URL,
				title: "Quiet Light",
				slug: "quiet-light",
				publishedAt: "1970-01-01T00:00:00.000Z",
				excerpt: "A morning at the lake",
				presentation: "standard",
				author: { name: "Jesse", image: null },
				categories: [{ title: "Field notes" }],
				mainImage: {
					src: `${assetRoot}/card.webp`,
					alt: "Light on the water",
					width: 768,
					height: 512,
					caption: null,
					framing: null,
				},
			},
		]);
	});

	it("preserves rich text and technical details without resolving an already-published slug", async () => {
		const read = reader();
		const content = createBlogContentProvider({ createReader: () => read });
		await expect(content.loadPost("quiet-light")).resolves.toMatchObject({
			equipment: [{ kind: "summary", label: "Camera", details: "35mm" }],
			body: [
				{ type: "paragraph", spans: [{ text: " Quiet light. ", marks: [{ type: "strong" }] }] },
			],
		});
		expect(read.getPublishedBySlug).toHaveBeenCalledWith("quiet-light", expect.any(AbortSignal));
		expect(read.resolvePublishedSlug).not.toHaveBeenCalled();
	});

	it.each([
		["standard", "display-1280", 1280, 853],
		["behindTheScenes", "display-2048", 2048, 1365],
		["caseStudy", "display-1280", 1280, 853],
		["clientStory", "display-2048", 2048, 1365],
		["technical", "display-1280", 1280, 853],
	])("uses the delivered main image for %s", async (presentation, filename, width, height) => {
		const read = reader();
		const row = post();
		read.getPublishedBySlug.mockResolvedValue({
			...row,
			payload: { ...row.payload, presentation },
		});
		await expect(
			createBlogContentProvider({ createReader: () => read }).loadPost("quiet-light"),
		).resolves.toMatchObject({
			mainImage: { src: `${assetRoot}/${filename}.webp`, width, height },
		});
	});

	it("rejects image metadata that does not describe the delivered raster", async () => {
		const read = reader();
		const row = post();
		row.payload.mainImage.asset.derivatives.display1280.width = 3000;
		read.getPublishedBySlug.mockResolvedValue(row);
		await expect(
			createBlogContentProvider({ createReader: () => read }).loadPost("quiet-light"),
		).rejects.toMatchObject({ status: 503 });
	});

	it("rejects divergent public summary and excerpt values", async () => {
		const read = reader();
		const row = summary();
		row.payload.excerpt = "A different summary";
		read.listPublished.mockResolvedValue([row]);
		await expect(
			createBlogContentProvider({ createReader: () => read }).loadIndex(),
		).rejects.toMatchObject({ status: 503 });
	});

	it("rejects unsafe links in published rich text", async () => {
		const read = reader();
		const row = post();
		read.getPublishedBySlug.mockResolvedValue({
			...row,
			payload: {
				...row.payload,
				body: {
					version: 1,
					blocks: [
						{
							type: "paragraph",
							key: "unsafe",
							children: [
								{
									type: "text",
									key: "link",
									text: "Click",
									marks: [{ type: "link", key: "target", href: "javascript:alert(1)" }],
								},
							],
						},
					],
				},
			},
		});
		await expect(
			createBlogContentProvider({ createReader: () => read }).loadPost("quiet-light"),
		).rejects.toMatchObject({ status: 503 });
	});

	it("returns an empty index when no posts are published", async () => {
		const read = reader();
		read.listPublished.mockResolvedValue([]);
		await expect(
			createBlogContentProvider({ createReader: () => read }).loadIndex(),
		).resolves.toEqual([]);
	});

	it.each([
		["missing", null, { status: 404 }],
		[
			"renamed",
			{ status: "redirect", kind: "post", slug: "new-title" },
			{ status: 308, location: "/blog/new-title" },
		],
		["self redirect", { status: "redirect", kind: "post", slug: "quiet-light" }, { status: 503 }],
		[
			"inconsistent current slug",
			{ status: "current", kind: "post", slug: "quiet-light" },
			{ status: 503 },
		],
		[
			"unsafe redirect",
			{ status: "redirect", kind: "post", slug: "https://example.com" },
			{ status: 503 },
		],
	])("handles a %s post resolution", async (_name, resolution, expected) => {
		const read = reader();
		read.getPublishedBySlug.mockResolvedValue(null);
		read.resolvePublishedSlug.mockResolvedValue(resolution);
		await expect(
			createBlogContentProvider({ createReader: () => read }).loadPost("quiet-light"),
		).rejects.toMatchObject(expected);
		expect(read.resolvePublishedSlug).toHaveBeenCalledWith("quiet-light", expect.any(AbortSignal));
	});

	it.each([
		"",
		"../private",
		"UPPERCASE",
		"two words",
	])("rejects invalid slug %j before contacting the backend", async (slug) => {
		const read = reader();
		await expect(
			createBlogContentProvider({ createReader: () => read }).loadPost(slug),
		).rejects.toMatchObject({ status: 404 });
		expect(read.getPublishedBySlug).not.toHaveBeenCalled();
		expect(read.resolvePublishedSlug).not.toHaveBeenCalled();
	});

	it.each([
		"listPublished",
		"getPublishedBySlug",
		"resolvePublishedSlug",
	] as const)("normalizes a failed %s read to unavailable", async (method) => {
		const read = reader();
		if (method === "resolvePublishedSlug") read.getPublishedBySlug.mockResolvedValue(null);
		read[method].mockRejectedValue(new Error("Backend unavailable"));
		const content = createBlogContentProvider({ createReader: () => read });
		await expect(
			method === "listPublished" ? content.loadIndex() : content.loadPost("quiet-light"),
		).rejects.toMatchObject({ status: 503 });
	});
});
