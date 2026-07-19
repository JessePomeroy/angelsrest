import { describe, expect, test } from "vitest";
import {
	createSanityBlogImportDryRunReport,
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
			bodySourceAssetRefs: [BODY_IMAGE],
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

	test.each([undefined, null, []])(
		"treats optional author bio value %j as absent",
		(bio) => {
			const source = sourceFixture();
			source.authors[0].bio = bio;

			const author = createSanityBlogImportManifest(source).authors[0];

			expect(author.draft.bio).toBeUndefined();
			expect(author.issues).toEqual([]);
		},
	);

	test.each([
		"Biography text outside Portable Text",
		{ blocks: [] },
		{
			_type: "block",
			_key: "single-block",
			children: [],
			markDefs: [],
			style: "normal",
		},
	])("rejects malformed author bio root %j without coercing it", (bio) => {
		const source = sourceFixture();
		source.authors[0].bio = bio;

		const author = createSanityBlogImportManifest(source).authors[0];

		expect(author.draft.bio).toBeUndefined();
		expect(author.issues).toContainEqual({
			code: "portable-text",
			path: "$.authors[0].bio$",
			message: "Expected Portable Text blocks",
			severity: "error",
		});
	});

	test("blocks draft import when a converted biography violates the Author contract", () => {
		const source = sourceFixture();
		source.authors[0].bio = [
			{
				_type: "image",
				_key: "bio-image",
				asset: { _type: "reference", _ref: BODY_IMAGE },
				alt: "A portrait used inside the biography.",
			},
		];

		const report = createSanityBlogImportDryRunReport(
			createSanityBlogImportManifest(source, {
				imageAssetIds: { [BODY_IMAGE]: TARGET_BODY_IMAGE },
			}),
		);

		expect(report.draftImport.status).toBe("blocked");
		expect(report.draftImport.blockingIssues).toContainEqual(
			expect.objectContaining({
				code: "portable-text",
				path: "$.authors[0].bio",
				message: "Author biography cannot contain image blocks",
			}),
		);
		expect(
			report.publication.blockingIssues.filter((reportIssue) =>
				reportIssue.path.includes(".bio"),
			),
		).toHaveLength(1);
	});

	test("applies the Author publication contract without blocking an incomplete draft", () => {
		const source = sourceFixture();
		source.authors[0].bio = [
			{
				_type: "block",
				_key: "empty-bio",
				style: "normal",
				markDefs: [],
				children: [
					{
						_type: "span",
						_key: "empty-bio-text",
						text: "   ",
						marks: [],
					},
				],
			},
		];

		const report = createSanityBlogImportDryRunReport(
			createSanityBlogImportManifest(source, {
				imageAssetIds: { [BODY_IMAGE]: TARGET_BODY_IMAGE },
			}),
		);

		expect(report.draftImport.status).toBe("ready-with-warnings");
		expect(report.publication.status).toBe("blocked");
		expect(report.publication.blockingIssues).toContainEqual(
			expect.objectContaining({
				code: "portable-text",
				path: "$.authors[0].draft.bio",
				message: expect.stringContaining("needs substantive content"),
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

	test("summarizes a dry-run manifest that is ready with human-review warnings", () => {
		const source = sourceFixture();
		source.posts[0].mainImage = {
			_key: "main-image",
			asset: { _type: "reference", _ref: "image-main-1600x1200-jpg" },
			alt: "A camera on a studio table.",
		};
		const manifest = createSanityBlogImportManifest(source, {
			imageAssetIds: { [BODY_IMAGE]: TARGET_BODY_IMAGE },
		});

		const report = createSanityBlogImportDryRunReport(manifest);

		expect(report).toMatchObject({
			version: 2,
			counts: {
				authors: 1,
				categories: 1,
				posts: 1,
				requiredSourceAssets: 3,
			},
			draftImport: {
				status: "ready-with-warnings",
				counts: { errors: 0, warnings: 2 },
			},
			publication: {
				status: "ready-with-warnings",
				counts: { errors: 0, warnings: 2 },
			},
			requiredSourceAssetRefs: [
				"image-author-600x600-jpg",
				BODY_IMAGE,
				"image-main-1600x1200-jpg",
			],
		});
		expect(report.draftImport.warningIssues.map((issue) => issue.code)).toEqual([
			"generated-category-slug",
			"generated-summary",
		]);
	});

	test("blocks dry-run import when exported references or generated slugs are unsafe", () => {
		const source = sourceFixture();
		source.authors.push({
			...source.authors[0],
			_id: "author-duplicate-slug",
		});
		source.categories.push({
			_id: "category-missing-from-post",
			_type: "category" as const,
			title: "Process Notes",
		});
		source.posts[0].author = { _type: "reference", _ref: "author-not-exported" };
		source.posts[0].categories = [
			{ _type: "reference", _ref: "category-not-exported" },
		];

		const report = createSanityBlogImportDryRunReport(
			createSanityBlogImportManifest(source, {
				imageAssetIds: { [BODY_IMAGE]: TARGET_BODY_IMAGE },
			}),
		);

		expect(report.draftImport.status).toBe("blocked");
		expect(report.draftImport.blockingIssues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "missing-exported-reference",
					path: "$.posts[0].draft.authorDocumentKey",
				}),
				expect.objectContaining({
					code: "missing-exported-reference",
					path: "$.posts[0].draft.categories[0].documentKey",
				}),
				expect.objectContaining({
					code: "slug-collision",
					path: "$.authors[1].draft.slug",
				}),
				expect.objectContaining({
					code: "slug-collision",
					path: "$.categories[1].draft.slug",
				}),
			]),
		);
	});

	test("blocks dry-run publication when imported images lack required alt text", () => {
		const source = sourceFixture();
		delete source.authors[0].image?.alt;
		source.posts[0].mainImage = {
			_key: "main-image",
			asset: { _type: "reference", _ref: "image-main-1600x1200-jpg" },
		};
		const body = bodyFixture();
		const bodyImage = body[1];
		if ("alt" in bodyImage) delete bodyImage.alt;
		source.posts[0].body = body;

		const report = createSanityBlogImportDryRunReport(
			createSanityBlogImportManifest(source, {
				imageAssetIds: { [BODY_IMAGE]: TARGET_BODY_IMAGE },
			}),
		);

		expect(report.draftImport.status).toBe("ready-with-warnings");
		expect(report.publication.status).toBe("blocked");
		const draftMissingAlt = report.draftImport.warningIssues.filter(
			(reportIssue) => reportIssue.code === "missing-image-alt",
		);
		expect(draftMissingAlt).toHaveLength(3);
		expect(draftMissingAlt.map((reportIssue) => reportIssue.path)).toEqual(
			expect.arrayContaining([
				"$.authors[0].draft.portrait.altText",
				"$.posts[0].draft.mainImage.altText",
				"$.posts[0].body$.blocks[1].altText",
			]),
		);
		expect(report.publication.warningIssues).not.toContainEqual(
			expect.objectContaining({ code: "missing-image-alt" }),
		);
		expect(report.publication.counts).toEqual({ errors: 3, warnings: 2 });
		expect(
			report.publication.blockingIssues.filter(
				(reportIssue) => reportIssue.code === "missing-image-alt",
			),
		).toHaveLength(3);
		expect(report.publication.blockingIssues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "missing-image-alt",
					path: "$.authors[0].draft.portrait.altText",
				}),
				expect.objectContaining({
					code: "missing-image-alt",
					path: "$.posts[0].draft.mainImage.altText",
				}),
				expect.objectContaining({
					code: "missing-image-alt",
					path: "$.posts[0].draft.body.blocks[1].altText",
				}),
			]),
		);
	});
});
