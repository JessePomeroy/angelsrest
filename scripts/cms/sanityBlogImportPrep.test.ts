import { describe, expect, test } from "vitest";
import {
	createSanityBlogImportManifest,
	type SanityBlogImportSource,
} from "../../packages/crm-api/convex/helpers/sanityBlogImport";
import {
	createSanityBlogImportPrepArtifacts,
	createSanityBlogImportRemediation,
	parseSanityBlogImageAssetMap,
	sanityImageSourceUrl,
} from "./sanityBlogImportPrep";

const ASSET_A = "image-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-600x400-jpg";
const ASSET_B = "image-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-800x600-png";

function sourceFixture(): SanityBlogImportSource {
	return {
		authors: [
			{
				_id: "author-a",
				name: "Private author title sentinel",
				slug: { current: "author-a" },
				image: { asset: { _ref: ASSET_A } },
			},
		],
		categories: [],
		posts: [
			{
				_id: "post-a",
				title: "Private post title sentinel",
				slug: { current: "post-a" },
				author: { _ref: "author-a" },
				mainImage: { asset: { _ref: ASSET_B } },
				body: [
					{
						_type: "block",
						_key: "text-a",
						style: "normal",
						markDefs: [],
						children: [
							{
								_type: "span",
								_key: "span-a",
								marks: [],
								text: "Private body text sentinel",
							},
						],
					},
					{ _type: "image", _key: "body-a", asset: { _ref: ASSET_A } },
				],
			},
		],
	};
}

describe("Sanity Blog import preparation", () => {
	test("deduplicates source assets while retaining placement-specific alt review", () => {
		const source = sourceFixture();
		const imageAssetIds = { [ASSET_B]: "convex-media-document-id" };
		const manifest = createSanityBlogImportManifest(source, { imageAssetIds });
		const remediation = createSanityBlogImportRemediation(source, manifest, imageAssetIds);

		expect(remediation.counts).toEqual({
			assetMappings: 2,
			unmappedAssets: 1,
			altText: 3,
		});
		expect(remediation.assetMappings[0]).toMatchObject({
			sourceAssetRef: ASSET_A,
			mapped: false,
		});
		expect(remediation.assetMappings[0]?.placements).toHaveLength(2);
		expect(remediation.altText.map((item) => item.role)).toEqual([
			"portrait",
			"bodyImage",
			"mainImage",
		]);
	});

	test("creates deterministic, reusable, sanitized prep artifacts", () => {
		const source = sourceFixture();
		const imageAssetIds = { [ASSET_B]: "convex-media-document-id" };
		const manifest = createSanityBlogImportManifest(source, { imageAssetIds });
		const remediation = createSanityBlogImportRemediation(source, manifest, imageAssetIds);
		const first = createSanityBlogImportPrepArtifacts({
			projectId: "project-a",
			dataset: "production",
			remediation,
		});
		const second = createSanityBlogImportPrepArtifacts({
			projectId: "project-a",
			dataset: "production",
			remediation: {
				...remediation,
				assetMappings: remediation.assetMappings.slice().reverse(),
				altText: remediation.altText.slice().reverse(),
			},
		});

		expect(first).toEqual(second);
		expect(Object.keys(first.imageAssetMap)).toEqual([ASSET_A, ASSET_B]);
		expect(first.imageAssetMap).toEqual({
			[ASSET_A]: "",
			[ASSET_B]: "convex-media-document-id",
		});
		expect(first.counts).toEqual({
			assets: 2,
			suppliedMappings: 1,
			missingMappingValues: 1,
			altText: 3,
		});
		expect(first.checklistMarkdown).toContain("Mapping values supplied (not yet verified): 1");
		expect(first.checklistMarkdown).toContain("Convex `mediaAssets` document `_id`");
		expect(first.checklistMarkdown).toContain("author / author-a / portrait");
		expect(first.checklistMarkdown).toContain("post / post-a / bodyImage");
		expect(first.checklistMarkdown).not.toContain("Private author title sentinel");
		expect(first.checklistMarkdown).not.toContain("Private post title sentinel");
		expect(first.checklistMarkdown).not.toContain("Private body text sentinel");
	});

	test("accepts blank template values and rejects ambiguous map entries", () => {
		expect(parseSanityBlogImageAssetMap({ [ASSET_A]: "", [ASSET_B]: "convex-id" })).toEqual({
			[ASSET_B]: "convex-id",
		});
		expect(() => parseSanityBlogImageAssetMap([])).toThrow(/JSON object/);
		expect(() => parseSanityBlogImageAssetMap({ "not-an-image-ref": "convex-id" })).toThrow(
			/Invalid Sanity image asset reference/,
		);
		expect(() => parseSanityBlogImageAssetMap({ [ASSET_A]: 42 })).toThrow(/must be a string/);
		expect(() => parseSanityBlogImageAssetMap({ [ASSET_A]: " convex-id " })).toThrow(
			/surrounding whitespace/,
		);
	});

	test("derives the published Sanity CDN image URL without source content", () => {
		expect(sanityImageSourceUrl("project-a", "production", ASSET_A)).toBe(
			"https://cdn.sanity.io/images/project-a/production/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-600x400.jpg",
		);
		expect(sanityImageSourceUrl("project-a", "production", "not-an-image-ref")).toBeNull();
	});
});
