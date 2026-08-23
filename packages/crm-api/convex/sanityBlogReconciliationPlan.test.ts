import { describe, expect, test } from "vitest";
import type { Id } from "./_generated/dataModel";
import type { SanityBlogImportReleaseContract } from "./helpers/sanityBlogImportPlan";
import {
	assertSanityBlogReconciliationPlan,
	checksumSanityBlogReconciliationPlan,
	createSanityBlogReconciliationPlan,
	requireSanityBlogReconciliationPlan,
	type SanityBlogReconciliationBuildOptions,
	type SanityBlogReconciliationSource,
} from "./helpers/sanityBlogReconciliationPlan";

const AUTHOR_KEY = "sanity.author.author-one";
const CATEGORY_KEY = "sanity.category.category-one";
const POST_KEY = "sanity.post.post-one";
const PORTRAIT_REF = "image-portrait-600x600-jpg";
const MAIN_REF = "image-main-1600x1200-jpg";
const BODY_REF = "image-body-1200x800-jpg";
const PORTRAIT_ID = "media-portrait" as Id<"mediaAssets">;
const MAIN_ID = "media-main" as Id<"mediaAssets">;
const BODY_ID = "media-body" as Id<"mediaAssets">;
const PORTRAIT_CROP = {
	top: 0.010927888941589192,
	right: 0.003421030847283818,
	bottom: 0.3786675624501119,
	left: 0,
};
const PORTRAIT_FOCUS = {
	x: 0.4982894845763581,
	y: 0.3095374222911859,
	width: 0.9965789691527162,
	height: 0.527364342876655,
};
const SOURCE = {
	projectId: "n7rvza4g",
	dataset: "production",
	perspective: "published" as const,
};

function sourceFixture(): SanityBlogReconciliationSource {
	return {
		authors: [
			{
				_id: "author-one",
				_rev: "author-revision-1",
				_type: "author",
				name: "Author One",
				slug: { current: "author-one" },
				image: {
					_key: "portrait",
					_type: "image",
					asset: { _type: "reference", _ref: PORTRAIT_REF },
					alt: "Author One holding a camera.",
					crop: {
						_type: "sanity.imageCrop",
						...PORTRAIT_CROP,
					},
					hotspot: {
						_type: "sanity.imageHotspot",
						...PORTRAIT_FOCUS,
					},
				},
			},
		],
		categories: [
			{
				_id: "category-one",
				_rev: "category-revision-1",
				_type: "category",
				title: "Field Notes",
				description: "Stories from the field.",
			},
		],
		posts: [
			{
				_id: "post-one",
				_rev: "post-revision-1",
				_type: "post",
				title: "First Light",
				postType: "technical",
				slug: { current: "first-light" },
				author: { _type: "reference", _ref: "author-one" },
				categories: [
					{ _key: "category-ref", _type: "reference", _ref: "category-one" },
				],
				publishedAt: "2026-08-15T12:00:00.000Z",
				mainImage: {
					_key: "main-image",
					_type: "image",
					asset: { _type: "reference", _ref: MAIN_REF },
				},
				gearUsed: [
					{
						_key: "camera-kit",
						_type: "object",
						camera: "Hasselblad 500C/M",
						lens: "80mm f/2.8",
						filmStock: "Portra 400",
					},
				],
				body: [
					{
						_type: "block",
						_key: "opening",
						style: "normal",
						markDefs: [],
						children: [
							{
								_type: "span",
								_key: "opening-text",
								text: "The owner-approved summary candidate begins here.",
								marks: [],
							},
						],
					},
					{
						_type: "image",
						_key: "body-image",
						asset: { _type: "reference", _ref: BODY_REF },
					},
				],
				legacySeo: { title: "Legacy" },
			},
		],
	} as unknown as SanityBlogReconciliationSource;
}

const PREDECESSOR = {
	version: 1,
	migrationId: "CMS-4.4p",
	siteUrl: "angelsrest.online",
	source: SOURCE,
	counts: { authors: 1, categories: 1, posts: 1, assets: 3 },
	documentKeys: {
		authors: [AUTHOR_KEY],
		categories: [CATEGORY_KEY],
		posts: [POST_KEY],
	},
	expectedDigest: "1".repeat(64),
} satisfies SanityBlogImportReleaseContract;

function options(): SanityBlogReconciliationBuildOptions {
	return {
		migrationId: "R6-blog-fixture",
		siteUrl: "angelsrest.online",
		source: SOURCE,
		predecessor: PREDECESSOR,
		imageAssetIds: {
			[PORTRAIT_REF]: PORTRAIT_ID,
			[MAIN_REF]: MAIN_ID,
			[BODY_REF]: BODY_ID,
		},
		targets: {
			[AUTHOR_KEY]: {
				documentId: "document-author" as Id<"contentDocuments">,
				draftRevisionId: "revision-author-v1" as Id<"contentRevisions">,
				draftChecksum: "a".repeat(64),
				documentSlug: "author-one",
				rank: 0,
			},
			[CATEGORY_KEY]: {
				documentId: "document-category" as Id<"contentDocuments">,
				draftRevisionId: "revision-category-v1" as Id<"contentRevisions">,
				draftChecksum: "b".repeat(64),
				documentSlug: "field-notes",
				rank: 0,
			},
			[POST_KEY]: {
				documentId: "document-post" as Id<"contentDocuments">,
				draftRevisionId: "revision-post-v1" as Id<"contentRevisions">,
				draftChecksum: "c".repeat(64),
				documentSlug: "first-light",
				rank: 0,
			},
		},
		decisions: {
			id: "owner-decisions-1",
			categorySlugs: { "category-one": "field-notes-approved" },
			postSummaries: { "post-one": "An exact owner-approved summary." },
			imagePlacements: {
				"author:author-one:portrait": {
					altAction: "accept-source",
					altText: "Author One holding a camera.",
					captionAction: "confirmed-absent",
					cropHotspotAction: "preserve-exact",
				},
				"post:post-one:main": {
					altAction: "owner-replacement",
					altText: "A medium-format camera resting beside exposed film.",
					captionAction: "confirmed-absent",
					cropHotspotAction: "confirmed-absent",
				},
				"post:post-one:body:body-image": {
					altAction: "owner-replacement",
					altText: "A developed film negative held up to window light.",
					captionAction: "confirmed-absent",
					cropHotspotAction: "confirmed-absent",
				},
			},
			gearMappings: {
				"post:post-one:gear:camera-kit": {
					action: "collapse-to-equipment-owner-approved",
					targetKey: "camera-kit",
					targetLabel: "Hasselblad 500C/M · 80mm f/2.8",
					targetDetails: "Camera: Hasselblad 500C/M; Lens: 80mm f/2.8; Film: Portra 400",
				},
			},
			unsupportedFields: [
				{
					sourceDocumentId: "post-one",
					sourcePath: "posts.post-one.legacySeo",
					sourceValueCanonical: '{"title":"Legacy"}',
					action: "omit-owner-approved",
				},
			],
			absentTargetFields: [
				{ field: "credits", action: "keep-absent-owner-approved" },
				{ field: "materials", action: "keep-absent-owner-approved" },
				{ field: "seoDescription", action: "keep-absent-owner-approved" },
				{ field: "seoTitle", action: "keep-absent-owner-approved" },
			],
		},
	};
}

describe("revision-pinned Sanity Blog reconciliation plan", () => {
	test("applies the complete owner decision set before final publication readiness", () => {
		const plan = createSanityBlogReconciliationPlan(sourceFixture(), options());

		expect(plan).toMatchObject({
			version: 2,
			predecessor: { expectedDigest: "1".repeat(64) },
			decisionSet: {
				id: "owner-decisions-1",
				categorySlugs: [{ sourceId: "category-one", slug: "field-notes-approved" }],
				postSummaries: [
					{ sourceId: "post-one", summary: "An exact owner-approved summary." },
				],
			},
			authors: [{ sourceRevision: "author-revision-1" }],
			categories: [
				{ sourceRevision: "category-revision-1", draft: { slug: "field-notes-approved" } },
			],
			posts: [
				{
					sourceRevision: "post-revision-1",
					draft: {
						summary: "An exact owner-approved summary.",
						materials: [],
						equipment: [{ key: "camera-kit" }],
					},
				},
			],
		});
		expect(plan.decisionSet.imagePlacements).toHaveLength(3);
		expect(plan.authors[0].draft).toMatchObject({
			kind: "author",
			portrait: {
				framing: {
					crop: PORTRAIT_CROP,
					focus: PORTRAIT_FOCUS,
				},
			},
		});
		expect(plan.assetMappings).toEqual([
			{ sourceAssetRef: BODY_REF, mediaAssetId: BODY_ID },
			{ sourceAssetRef: MAIN_REF, mediaAssetId: MAIN_ID },
			{ sourceAssetRef: PORTRAIT_REF, mediaAssetId: PORTRAIT_ID },
		]);
	});

	test("preserves source gear order independently of Sanity item keys", () => {
		const source = sourceFixture();
		source.posts[0].gearUsed = [
			{ _key: "z-first", camera: "First camera" },
			{ _key: "a-second", lens: "Second lens" },
		];
		const accepted = options();
		accepted.decisions.gearMappings = {
			"post:post-one:gear:z-first": {
				action: "collapse-to-equipment-owner-approved",
				targetKey: "z-first",
				targetLabel: "First camera",
			},
			"post:post-one:gear:a-second": {
				action: "collapse-to-equipment-owner-approved",
				targetKey: "a-second",
				targetLabel: "Second lens",
			},
		};

		const plan = createSanityBlogReconciliationPlan(source, accepted);

		expect(plan.posts[0].draft.equipment).toEqual([
			{ key: "z-first", label: "First camera" },
			{ key: "a-second", label: "Second lens" },
		]);
		expect(
			plan.decisionSet.gearMappings.map(({ gearId, sourceOrder }) => ({ gearId, sourceOrder })),
		).toEqual([
			{ gearId: "post:post-one:gear:a-second", sourceOrder: 1 },
			{ gearId: "post:post-one:gear:z-first", sourceOrder: 0 },
		]);
	});

	test("binds the exact source revisions and verifies canonical digest bytes", async () => {
		const first = createSanityBlogReconciliationPlan(sourceFixture(), options());
		const changedSource = sourceFixture();
		changedSource.posts[0]._rev = "post-revision-2";
		const changed = createSanityBlogReconciliationPlan(changedSource, options());
		const digest = await checksumSanityBlogReconciliationPlan(first);

		expect(await checksumSanityBlogReconciliationPlan(changed)).not.toBe(digest);
		await expect(requireSanityBlogReconciliationPlan(first, digest)).resolves.toBe(digest);
		await expect(
			requireSanityBlogReconciliationPlan(first, "0".repeat(64)),
		).rejects.toThrow(/canonical bytes/i);
	});

	test("fails closed on missing revisions and incomplete owner decisions", () => {
		const missingRevision = sourceFixture();
		delete missingRevision.posts[0]._rev;
		expect(() =>
			createSanityBlogReconciliationPlan(missingRevision, options()),
		).toThrow(/exact Sanity _rev/i);

		const missingSummary = options();
		missingSummary.decisions.postSummaries = {};
		expect(() =>
			createSanityBlogReconciliationPlan(sourceFixture(), missingSummary),
		).toThrow(/exact accepted set/i);

		const missingGear = options();
		missingGear.decisions.gearMappings = {};
		expect(() =>
			createSanityBlogReconciliationPlan(sourceFixture(), missingGear),
		).toThrow(/exact accepted set/i);
	});

	test("fails closed on invalid v2 source values and duplicate owner slugs", () => {
		const unknownPresentation = sourceFixture();
		unknownPresentation.posts[0].postType = "future-layout";
		expect(() =>
			createSanityBlogReconciliationPlan(unknownPresentation, options()),
		).toThrow(/presentation type/i);

		const malformedTime = sourceFixture();
		malformedTime.posts[0].publishedAt = 1_786_799_999;
		expect(() =>
			createSanityBlogReconciliationPlan(malformedTime, options()),
		).toThrow(/publication time/i);

		const duplicateSource = sourceFixture();
		duplicateSource.categories.push({
			_id: "category-two",
			_rev: "category-revision-2",
			_type: "category",
			title: "More Notes",
		});
		const duplicateSlug = options();
		duplicateSlug.predecessor = {
			...duplicateSlug.predecessor,
			counts: { ...duplicateSlug.predecessor.counts, categories: 2 },
			documentKeys: {
				...duplicateSlug.predecessor.documentKeys,
				categories: [CATEGORY_KEY, "sanity.category.category-two"],
			},
		};
		duplicateSlug.targets = {
			...duplicateSlug.targets,
			"sanity.category.category-two": {
				documentId: "document-category-two" as Id<"contentDocuments">,
				draftRevisionId: "revision-category-two-v1" as Id<"contentRevisions">,
				draftChecksum: "d".repeat(64),
				documentSlug: "more-notes",
				rank: 1,
			},
		};
		duplicateSlug.decisions.categorySlugs = {
			"category-one": "same-slug",
			"category-two": "same-slug",
		};
		expect(() =>
			createSanityBlogReconciliationPlan(duplicateSource, duplicateSlug),
		).toThrow(/category slug decisions must be unique/i);

		duplicateSlug.decisions.categorySlugs = {
			...duplicateSlug.decisions.categorySlugs,
			"category-two": "other-slug",
		};
		const tampered = createSanityBlogReconciliationPlan(duplicateSource, duplicateSlug);
		tampered.decisionSet.categorySlugs[1].slug = "same-slug";
		tampered.categories[1].draft.slug = "same-slug";
		expect(() => assertSanityBlogReconciliationPlan(tampered)).toThrow(
			/category slug decisions must be unique/i,
		);
	});

	test("requires exact portrait framing preservation and unsupported-field dispositions", () => {
		const focal = options();
		focal.decisions = {
			...focal.decisions,
			imagePlacements: {
				...focal.decisions.imagePlacements,
				"author:author-one:portrait": {
					...focal.decisions.imagePlacements["author:author-one:portrait"],
					cropHotspotAction: "confirmed-absent",
				},
			},
		};
		expect(() => createSanityBlogReconciliationPlan(sourceFixture(), focal)).toThrow(
			/crop\/hotspot decision/i,
		);

		const invalidCrop = sourceFixture();
		const portrait = invalidCrop.authors[0].image as unknown as {
			crop: { _type: string };
		};
		portrait.crop._type = "not.sanity.imageCrop";
		expect(() =>
			createSanityBlogReconciliationPlan(invalidCrop, options()),
		).toThrow(/invalid Sanity type/i);

		const outsideCrop = sourceFixture();
		const outsideCropPortrait = outsideCrop.authors[0].image as unknown as {
			crop: { left: number };
		};
		outsideCropPortrait.crop.left = 0.1;
		expect(() =>
			createSanityBlogReconciliationPlan(outsideCrop, options()),
		).toThrow(/surviving crop/i);

		const postFocal = sourceFixture();
		(postFocal.posts[0].mainImage as Record<string, unknown>).crop = {
			_type: "sanity.imageCrop",
			top: 0,
			right: 0,
			bottom: 0.1,
			left: 0,
		};
		const postFocalDecision = options();
		postFocalDecision.decisions = {
			...postFocalDecision.decisions,
			imagePlacements: {
				...postFocalDecision.decisions.imagePlacements,
				"post:post-one:main": {
					...postFocalDecision.decisions.imagePlacements["post:post-one:main"],
					cropHotspotAction: "preserve-exact",
				},
			},
		};
		expect(() =>
			createSanityBlogReconciliationPlan(postFocal, postFocalDecision),
		).toThrow(/crop\/hotspot decision/i);

		const unsupported = options();
		unsupported.decisions.unsupportedFields = [];
		expect(() =>
			createSanityBlogReconciliationPlan(sourceFixture(), unsupported),
		).toThrow(/unsupported-field decisions/i);
	});

	test("binds canonical target framing to the accepted source decision", () => {
		const plan = createSanityBlogReconciliationPlan(sourceFixture(), options());
		const portrait = plan.authors[0].draft.kind === "author"
			? plan.authors[0].draft.portrait
			: undefined;
		if (!portrait?.framing?.crop) throw new Error("Fixture portrait framing is missing");
		portrait.framing.crop.top += 0.001;

		expect(() => assertSanityBlogReconciliationPlan(plan)).toThrow(
			/final media placements/i,
		);
	});

	test("rejects missing, extra, or substituted media coverage", () => {
		const missing = options();
		missing.imageAssetIds = Object.fromEntries(
			Object.entries(missing.imageAssetIds).filter(([sourceRef]) => sourceRef !== BODY_REF),
		);
		expect(() => createSanityBlogReconciliationPlan(sourceFixture(), missing)).toThrow(
			/media mapping source refs/i,
		);

		const extra = options();
		extra.imageAssetIds = {
			...extra.imageAssetIds,
			"image-extra-1x1-jpg": "media-extra",
		};
		expect(() => createSanityBlogReconciliationPlan(sourceFixture(), extra)).toThrow(
			/media mapping source refs/i,
		);

		const plan = createSanityBlogReconciliationPlan(sourceFixture(), options());
		const substituted = structuredClone(plan);
		if (!substituted.posts[0].draft.mainImage) throw new Error("Fixture main image is missing");
		substituted.posts[0].draft.mainImage.assetId = BODY_ID;
		expect(() => assertSanityBlogReconciliationPlan(substituted)).toThrow(
			/final media placements/i,
		);

		const remapped = structuredClone(plan);
		const mainDecision = remapped.decisionSet.imagePlacements.find(
			({ placementId }) => placementId === "post:post-one:main",
		);
		if (!mainDecision) throw new Error("Fixture main-image decision is missing");
		mainDecision.mediaAssetId = BODY_ID;
		expect(() => assertSanityBlogReconciliationPlan(remapped)).toThrow(
			/final media placements|substitutes/i,
		);
	});
});
