import { describe, expect, test } from "vitest";
import type { Id } from "../../packages/crm-api/convex/_generated/dataModel";
import type { SanityBlogImportReleaseContract } from "../../packages/crm-api/convex/helpers/sanityBlogImportPlan";
import type {
	SanityBlogReconciliationBuildOptions,
	SanityBlogReconciliationSource,
} from "../../packages/crm-api/convex/helpers/sanityBlogReconciliationPlan";
import {
	createSanityBlogReconciliationArtifact,
	parseSanityBlogReconciliationArtifact,
	parseSanityBlogReconciliationPlanInput,
} from "./sanityBlogReconciliationPlan";

const SOURCE_IDENTITY = {
	projectId: "project",
	dataset: "production",
	perspective: "published" as const,
};

function input() {
	const source: SanityBlogReconciliationSource = {
		authors: [
			{
				_id: "author-one",
				_rev: "author-rev",
				_type: "author",
				name: "Author One",
				slug: { current: "author-one" },
			},
		],
		categories: [
			{
				_id: "category-one",
				_rev: "category-rev",
				_type: "category",
				title: "Field Notes",
			},
		],
		posts: [
			{
				_id: "post-one",
				_rev: "post-rev",
				_type: "post",
				title: "First Light",
				postType: "standard",
				slug: { current: "first-light" },
				author: { _type: "reference", _ref: "author-one" },
				categories: [{ _type: "reference", _ref: "category-one" }],
				publishedAt: "2026-08-15T12:00:00.000Z",
				body: [
					{
						_type: "block",
						_key: "opening",
						style: "normal",
						markDefs: [],
						children: [
							{
								_type: "span",
								_key: "span",
								text: "First light over the ridge.",
								marks: [],
							},
						],
					},
				],
			},
		],
	};
	const predecessor: SanityBlogImportReleaseContract = {
		version: 1,
		migrationId: "CMS-4.4p",
		siteUrl: "angelsrest.online",
		source: SOURCE_IDENTITY,
		counts: { authors: 1, categories: 1, posts: 1, assets: 0 },
		documentKeys: {
			authors: ["sanity.author.author-one"],
			categories: ["sanity.category.category-one"],
			posts: ["sanity.post.post-one"],
		},
		expectedDigest: "1".repeat(64),
	};
	const options: SanityBlogReconciliationBuildOptions = {
		migrationId: "R6-blog-test",
		siteUrl: "angelsrest.online",
		source: SOURCE_IDENTITY,
		predecessor,
		imageAssetIds: {},
		targets: Object.fromEntries(
			[
				["sanity.author.author-one", "a"],
				["sanity.category.category-one", "b"],
				["sanity.post.post-one", "c"],
			].map(([documentKey, prefix], rank) => [
				documentKey,
				{
					documentId: `document-${prefix}` as Id<"contentDocuments">,
					draftRevisionId: `revision-${prefix}` as Id<"contentRevisions">,
					draftChecksum: prefix.repeat(64),
					documentSlug: documentKey.includes("author")
						? "author-one"
						: documentKey.includes("category")
							? "field-notes"
							: "first-light",
					rank,
				},
			]),
		),
		decisions: {
			id: "owner-decisions",
			categorySlugs: { "category-one": "field-notes" },
			postSummaries: { "post-one": "First light over the ridge." },
			imagePlacements: {},
			gearMappings: {},
			unsupportedFields: [],
			absentTargetFields: [
				{ field: "credits", action: "keep-absent-owner-approved" },
				{ field: "materials", action: "keep-absent-owner-approved" },
				{ field: "seoDescription", action: "keep-absent-owner-approved" },
				{ field: "seoTitle", action: "keep-absent-owner-approved" },
			],
		},
	};
	return { source, options };
}

describe("offline Sanity Blog reconciliation artifact", () => {
	test("builds and revalidates one canonical local artifact", async () => {
		const artifact = await createSanityBlogReconciliationArtifact(input());
		expect(artifact.digest).toMatch(/^[a-f0-9]{64}$/);
		await expect(parseSanityBlogReconciliationArtifact(artifact)).resolves.toEqual(artifact);
	});

	test("rejects malformed input and a stale artifact digest", async () => {
		expect(() => parseSanityBlogReconciliationPlanInput({ source: [] })).toThrow(
			/reconciliation source/i,
		);
		const artifact = await createSanityBlogReconciliationArtifact(input());
		await expect(
			parseSanityBlogReconciliationArtifact({ ...artifact, digest: "0".repeat(64) }),
		).rejects.toThrow(/canonical bytes/i);
	});

	test("rejects invalid literals and extra artifact fields before execution", async () => {
		const artifact = await createSanityBlogReconciliationArtifact(input());
		const invalidAction = structuredClone(artifact) as unknown as {
			plan: { decisionSet: { absentTargetFields: Array<{ action: string }> } };
		};
		invalidAction.plan.decisionSet.absentTargetFields[0].action = "silently-drop";
		await expect(parseSanityBlogReconciliationArtifact(invalidAction)).rejects.toThrow(
			/invalid literal/i,
		);

		const extraField = structuredClone(artifact) as unknown as {
			plan: Record<string, unknown>;
		};
		extraField.plan.unreviewed = true;
		await expect(parseSanityBlogReconciliationArtifact(extraField)).rejects.toThrow(/not allowed/i);
	});
});
