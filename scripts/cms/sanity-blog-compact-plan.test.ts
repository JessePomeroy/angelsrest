import { describe, expect, test } from "vitest";
import { ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE } from "../../packages/crm-api/convex/helpers/sanityBlogImportPlan";
import type { SanityBlogReconciliationSource } from "../../packages/crm-api/convex/helpers/sanityBlogReconciliationPlan";
import {
	buildAcceptedOwnerDecisions,
	buildCompactPlanInput,
	proveExactPortableText,
	requireExactFrozenSource,
	targetBaselinesFromInventory,
} from "./sanity-blog-compact-plan";

const AUTHOR_ID = "author-one";
const CATEGORY_ID = "category-one";
const POST_IDS = ["post-one", "post-two", "post-three", "post-four"] as const;
const HREFS = [
	"https://angelsrest.online",
	"https://www.angelsrest.online/shop/time-aware-theming-kit",
	"https://chromacollection.online",
	"https://fotoflo.online",
] as const;

function sourceFixture(): SanityBlogReconciliationSource {
	let blockIndex = 0;
	return {
		authors: [{ _id: AUTHOR_ID, _rev: "author-revision", _type: "author" }],
		categories: [{ _id: CATEGORY_ID, _rev: "category-revision", _type: "category" }],
		posts: POST_IDS.map((postId, postIndex) => {
			const blockCount = postIndex < 2 ? 15 : 14;
			const body = Array.from({ length: blockCount }, (_, order) => {
				const globalOrder = blockIndex++;
				const link = globalOrder < HREFS.length ? HREFS[globalOrder] : undefined;
				const marked = globalOrder < 14;
				return {
					_type: "block",
					_key: `${postId}-block-${order}`,
					style: "normal",
					markDefs: link ? [{ _type: "link", _key: `${postId}-link-${order}`, href: link }] : [],
					children: [
						{
							_type: "span",
							_key: `${postId}-span-${order}`,
							text: `Block ${globalOrder}`,
							marks: link ? [`${postId}-link-${order}`] : marked ? ["strong"] : [],
						},
					],
				};
			});
			return {
				_id: postId,
				_rev: `${postId}-revision`,
				_type: "post" as const,
				body,
				gearUsed:
					postIndex === 2
						? [{ _key: "empty-gear", camera: null, developer: null, filmStock: null, lens: null }]
						: [],
			};
		}),
	};
}

function bodyStructure(source: SanityBlogReconciliationSource["posts"][number]) {
	return (source.body as Array<Record<string, unknown>>).map((block, order) => ({
		children: (block.children as Array<Record<string, unknown>>).map((child, childOrder) => ({
			key: child._key,
			marks: child.marks,
			order: childOrder,
			textLength: (child.text as string).length,
			type: child._type,
		})),
		key: block._key,
		level: null,
		listItem: null,
		markDefs: (block.markDefs as Array<Record<string, unknown>>).map((mark, markOrder) => ({
			href: mark.href,
			key: mark._key,
			order: markOrder,
			type: mark._type,
		})),
		order,
		style: "normal",
		type: "block",
	}));
}

function sourceInventoryFixture(source: SanityBlogReconciliationSource) {
	return {
		schema: "angelsrest.r6.blog-sanity-inventory.v1",
		documents: [
			...source.authors.map((document) => ({
				canonicalId: document._id,
				type: "author",
				draft: null,
				published: { rev: document._rev, unexpectedFields: [] },
			})),
			...source.categories.map((document) => ({
				canonicalId: document._id,
				type: "category",
				draft: null,
				published: { rev: document._rev, unexpectedFields: [] },
			})),
			...source.posts.map((document) => ({
				canonicalId: document._id,
				type: "post",
				draft: null,
				published: {
					rev: document._rev,
					mapping: { body: { structure: bodyStructure(document) } },
					unexpectedFields: [
						{ sourcePath: "_system", sourceValueCanonical: `{"post":"${document._id}"}` },
					],
				},
			})),
		],
	};
}

function proposalFixture(source: SanityBlogReconciliationSource) {
	const imageAssetIds: Record<string, string> = {};
	const imagePlacements = Array.from({ length: 21 }, (_, offset) => {
		const index = offset + 1;
		const sourceAssetRef = `image-${index.toString(16).padStart(40, "0")}-100x100-png`;
		const placementId = `placement-${index}`;
		imageAssetIds[sourceAssetRef] = `media-${index}`;
		return {
			index,
			placementId,
			sourceAssetRef,
			targetMediaAssetId: imageAssetIds[sourceAssetRef],
			sourceExplicitAlt: { present: false, value: null },
			sourceExplicitCaption: { present: false, value: null },
			factualAltCandidate: `Factual image description ${index}`,
			captionCandidate: null,
			captionRecommendation: "keep_absent",
			framingRecommendation:
				index === 1
					? "extend_target_contract_to_preserve_exact_source_crop_and_hotspot_before_import"
					: "no_source_crop_or_hotspot",
		};
	});
	return {
		imageAssetIds,
		proposal: {
			decisions: {
				categorySlug: {
					sourceId: CATEGORY_ID,
					sourceRevision: source.categories[0]?._rev,
					generatedCandidate: "field-notes",
					recommendation: "accept_exact_generated_candidate",
				},
				postSummaries: source.posts.map((post) => ({
					sourceId: post._id,
					sourceRevision: post._rev,
					generatedCandidate: `Accepted summary for ${post._id}`,
				})),
				imagePlacements,
				emptyGearItem: {
					sourcePostId: POST_IDS[2],
					sourceKey: "empty-gear",
					recommendation: "treat_all_null_source_gear_row_as_no_technical_item",
				},
				absentTargetFields: ["credits", "materials", "seoDescription", "seoTitle"].map((field) => ({
					field,
					recommendation: "keep_absent",
				})),
				publicListLimit: { currentPublishedPostCount: 4, targetPublicListLimit: 12 },
			},
		},
	};
}

function targetInventoryFixture() {
	const documentKeys = [
		...ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.documentKeys.authors,
		...ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.documentKeys.categories,
		...ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.documentKeys.posts,
	];
	return {
		schema: "angelsrest.r6.blog-convex-inventory.v2",
		siteUrl: "angelsrest.online",
		deployment: "loyal-swan-967",
		documents: documentKeys.map((documentKey, rank) => ({
			documentKey,
			documentId: `document-${rank}`,
			draftRevisionId: `revision-${rank}`,
			publishedRevisionId: null,
			publishedAt: null,
			publishedByClass: null,
			archivedAt: null,
			archivedByClass: null,
			createdByClass: "sanityImport",
			updatedByClass: "sanityImport",
			createdAt: 1000 + rank,
			updatedAt: 1000 + rank,
			slug: `slug-${rank}`,
			rank,
		})),
		revisions: documentKeys.map((_, rank) => ({
			documentId: `document-${rank}`,
			revisionId: `revision-${rank}`,
			checksum: `${rank}`.repeat(64),
			source: "sanityImport",
			createdByClass: "sanityImport",
		})),
	};
}

describe("R6 Blog compact plan preparation", () => {
	test("pins the exact frozen source and proves Portable Text structure", () => {
		const source = sourceFixture();
		const inventory = sourceInventoryFixture(source);

		expect(requireExactFrozenSource(source, inventory)).toHaveLength(6);
		expect(proveExactPortableText(source, inventory)).toMatchObject({
			blockCount: 58,
			markedBlockCount: 14,
			linkCount: 4,
			hrefs: HREFS,
		});

		const drifted = structuredClone(inventory);
		drifted.documents[2].published.mapping.body.structure[0].children[0].textLength += 1;
		expect(() => proveExactPortableText(source, drifted)).toThrow(/structure drifted/i);
	});

	test("translates all accepted decisions, including the all-null gear omission", () => {
		const source = sourceFixture();
		const inventory = sourceInventoryFixture(source);
		const { proposal, imageAssetIds } = proposalFixture(source);
		const decisions = buildAcceptedOwnerDecisions(proposal, source, inventory, imageAssetIds);

		expect(Object.keys(decisions.postSummaries)).toHaveLength(4);
		expect(Object.keys(decisions.imagePlacements)).toHaveLength(21);
		expect(decisions.unsupportedFields).toHaveLength(0);
		expect(decisions.absentTargetFields).toHaveLength(4);
		expect(decisions.emptyGearOmissions).toEqual([
			{
				gearId: `post:${POST_IDS[2]}:gear:empty-gear`,
				sourcePostId: POST_IDS[2],
				sourceRevision: `${POST_IDS[2]}-revision`,
				sourcePath: `posts.${POST_IDS[2]}.gearUsed.empty-gear`,
				sourceKey: "empty-gear",
				sourceOrder: 0,
				action: "omit-all-null-owner-approved",
			},
		]);
	});

	test("excludes only provider system metadata from unsupported content decisions", () => {
		const source = sourceFixture();
		const inventory = sourceInventoryFixture(source);
		inventory.documents[0].published.unexpectedFields.push({
			sourcePath: "legacyField",
			sourceValueCanonical: '"retained-until-owner-approved"',
		});
		const { proposal, imageAssetIds } = proposalFixture(source);

		expect(
			buildAcceptedOwnerDecisions(proposal, source, inventory, imageAssetIds).unsupportedFields,
		).toEqual([
			{
				sourceDocumentId: AUTHOR_ID,
				sourcePath: `authors.${AUTHOR_ID}.legacyField`,
				sourceValueCanonical: '"retained-until-owner-approved"',
				action: "omit-owner-approved",
			},
		]);
	});

	test("derives all six immutable target baselines and composes v2 input", () => {
		const source = sourceFixture();
		const sourceInventory = sourceInventoryFixture(source);
		const targetInventory = targetInventoryFixture();
		const { proposal, imageAssetIds } = proposalFixture(source);

		expect(Object.keys(targetBaselinesFromInventory(targetInventory))).toHaveLength(6);
		const obsoleteSchema = { ...targetInventory, schema: "angelsrest.r6.blog-convex-inventory.v1" };
		expect(() => targetBaselinesFromInventory(obsoleteSchema)).toThrow(/schema/i);
		const input = buildCompactPlanInput({
			source,
			proposal,
			sourceInventory,
			targetInventory,
			imageAssetIds,
		});
		expect(input.options.decisions.emptyGearOmissions).toHaveLength(1);
		expect(Object.keys(input.options.targets)).toHaveLength(6);

		const published = structuredClone(targetInventory);
		published.documents[0].publishedRevisionId = "published-revision";
		expect(() => targetBaselinesFromInventory(published)).toThrow(/untouched unpublished/i);
	});
});
