import { describe, expect, test } from "vitest";
import {
	createSanityBlogImportManifest,
	type SanityBlogImportSource,
} from "./helpers/sanityBlogImport";

const BODY_IMAGE = "image-body-1200x800-jpg";
const TARGET_BODY_IMAGE = "123e4567-e89b-42d3-a456-426614174000";

function bodyFixture() {
	return [
		{
			_type: "block",
			_key: "intro",
			style: "normal",
			markDefs: [],
			children: [
				{
					_type: "span",
					_key: "intro-text",
					text: "A temporary story opening that becomes the generated summary.",
					marks: [],
				},
			],
		},
		{
			_type: "image",
			_key: "body-image",
			asset: { _type: "reference", _ref: BODY_IMAGE },
			alt: "A darkroom print drying on a line.",
		},
	];
}

function sourceFixture(): SanityBlogImportSource {
	return {
		authors: [
			{
				_id: "author-maggie",
				_type: "author" as const,
				name: "Margaret Helena",
				slug: { current: "margaret-helena" },
				image: {
					_key: "portrait",
					asset: { _type: "reference", _ref: "image-author-600x600-jpg" },
					alt: "Margaret Helena holding a camera.",
				},
				bio: [
					{
						_type: "block",
						_key: "bio",
						style: "normal",
						markDefs: [],
						children: [
							{
								_type: "span",
								_key: "bio-text",
								text: "Photographer and artist.",
								marks: [],
							},
						],
					},
				],
			},
		],
		categories: [
			{
				_id: "category-process",
				_type: "category" as const,
				title: "Process Notes",
				description: "Behind-the-scenes writing.",
			},
		],
		posts: [
			{
				_id: "post-process",
				_type: "post" as const,
				title: "A Process Note",
				postType: "behindTheScenes",
				slug: { current: "a-process-note" },
				author: { _type: "reference", _ref: "author-maggie" },
				categories: [{ _type: "reference", _ref: "category-process" }],
				publishedAt: "2026-07-15T18:00:00.000Z",
				body: bodyFixture(),
			},
		],
	};
}

describe("Sanity Blog import manifest", () => {
	test("maps legacy Sanity Blog documents into deterministic provider-neutral drafts", () => {
		const manifest = createSanityBlogImportManifest(sourceFixture(), {
			imageAssetIds: { [BODY_IMAGE]: TARGET_BODY_IMAGE },
		});

		expect(manifest.version).toBe(1);
		expect(manifest.authors).toHaveLength(1);
		expect(manifest.authors[0]).toMatchObject({
			sourceId: "author-maggie",
			documentKey: "sanity.author.author-maggie",
			draft: {
				kind: "author",
				name: "Margaret Helena",
				slug: "margaret-helena",
				portrait: {
					key: "portrait",
					sourceAssetRef: "image-author-600x600-jpg",
					altText: "Margaret Helena holding a camera.",
				},
			},
		});
		expect(manifest.authors[0].draft.bio?.blocks).toHaveLength(1);

		expect(manifest.categories[0]).toMatchObject({
			sourceId: "category-process",
			documentKey: "sanity.category.category-process",
			draft: {
				kind: "category",
				title: "Process Notes",
				slug: "process-notes",
				description: "Behind-the-scenes writing.",
			},
		});
		expect(manifest.categories[0].issues).toContainEqual(
			expect.objectContaining({
				code: "generated-category-slug",
				severity: "warning",
			}),
		);

		expect(manifest.posts[0]).toMatchObject({
			sourceId: "post-process",
			documentKey: "sanity.post.post-process",
			draft: {
				kind: "post",
				title: "A Process Note",
				slug: "a-process-note",
				format: "essay",
				presentation: "behindTheScenes",
				displayPublishedAt: Date.parse("2026-07-15T18:00:00.000Z"),
				summary: "A temporary story opening that becomes the generated summary.",
				authorDocumentKey: "sanity.author.author-maggie",
				categories: [
					{
						key: "category-1",
						documentKey: "sanity.category.category-process",
					},
				],
			},
		});
		expect(manifest.posts[0].draft.body.blocks).toEqual([
			expect.objectContaining({ type: "paragraph", key: "intro" }),
			expect.objectContaining({
				type: "image",
				key: "body-image",
				assetId: TARGET_BODY_IMAGE,
				altText: "A darkroom print drying on a line.",
			}),
		]);
		expect(manifest.posts[0].issues).toContainEqual(
			expect.objectContaining({
				code: "generated-summary",
				severity: "warning",
			}),
		);
	});

	test.each([
		["standard", "essay", "standard"],
		["behindTheScenes", "essay", "behindTheScenes"],
		["caseStudy", "projectStory", "caseStudy"],
		["clientStory", "projectStory", "clientStory"],
		["technical", "technicalNote", "technical"],
	] as const)("maps legacy post type %s", (postType, format, presentation) => {
		const source = sourceFixture();
		source.posts[0].postType = postType;
		source.posts[0].brief = "The brief.";
		source.posts[0].approach = "The approach.";
		source.posts[0].result = "The result.";
		source.posts[0].gearUsed = [
			{
				_key: "gear-one",
				camera: "Nikon F3",
				lens: "50mm",
				filmStock: "Portra 400",
				developer: "Lab",
			},
		];

		const manifest = createSanityBlogImportManifest(source, {
			imageAssetIds: { [BODY_IMAGE]: TARGET_BODY_IMAGE },
		});

		expect(manifest.posts[0].draft.format).toBe(format);
		expect(manifest.posts[0].draft.presentation).toBe(presentation);
		if (format === "projectStory") {
			expect(manifest.posts[0].draft).toMatchObject({
				brief: "The brief.",
				approach: "The approach.",
				outcome: "The result.",
			});
		}
		if (format === "technicalNote") {
			expect(manifest.posts[0].draft.equipment).toEqual([
				{
					key: "gear-one",
					label: "Nikon F3 · 50mm",
					details: "Nikon F3 · 50mm · Portra 400 · Lab",
				},
			]);
		}
	});

	test("surfaces unresolved assets, missing required fields, invalid references, and duplicate source IDs", () => {
		const source = sourceFixture();
		source.authors.push({ ...source.authors[0] });
		source.posts[0].title = "";
		source.posts[0].author = { _type: "reference" };
		source.posts[0].categories = [{ _type: "reference", _ref: "" }];

		const manifest = createSanityBlogImportManifest(source);
		const issueCodes = manifest.issues.map((issue) => issue.code);

		expect(issueCodes).toContain("duplicate-source-id");
		expect(issueCodes).toContain("missing-required-field");
		expect(issueCodes).toContain("invalid-reference");
		expect(manifest.posts[0].issues).toContainEqual(
			expect.objectContaining({
				code: "portable-text",
				message: expect.stringContaining("has no target media mapping"),
			}),
		);
	});
});
