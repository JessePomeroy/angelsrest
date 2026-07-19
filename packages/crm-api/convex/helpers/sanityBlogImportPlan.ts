import type { Infer } from "convex/values";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
	BLOG_CONTENT_LIMITS,
	blogSupportingDraftValidator,
	type BlogSupportingDraft,
	validateBlogSupportingDraft,
} from "./blogContentValidators";
import { validateBlogDocumentKey } from "./blogContentData";
import { requireCanonicalBlogSlug } from "./blogContentValidationSupport";
import {
	createSanityBlogImportDryRunReport,
	type SanityBlogImportManifest,
} from "./sanityBlogImport";
import { validatePostDocumentKey } from "./postContentGraph";
import {
	postDraftValidator,
	type PostDraft,
	validatePostDraft,
} from "./postContentValidators";
import { requireCanonicalPostSlug } from "./postContentValidationSupport";

const importSourceValidator = v.object({
	projectId: v.string(),
	dataset: v.string(),
	perspective: v.literal("published"),
});

const importAssetMappingValidator = v.object({
	sourceAssetRef: v.string(),
	mediaAssetId: v.id("mediaAssets"),
});

const importSupportingDocumentValidator = v.object({
	sourceId: v.string(),
	documentKey: v.string(),
	draft: blogSupportingDraftValidator,
});

const importPostCategoryReferenceValidator = v.object({
	key: v.string(),
	documentKey: v.string(),
});

const importPostDocumentValidator = v.object({
	sourceId: v.string(),
	documentKey: v.string(),
	authorDocumentKey: v.string(),
	categoryReferences: v.array(importPostCategoryReferenceValidator),
	draft: postDraftValidator,
});

export const sanityBlogImportPlanValidator = v.object({
	version: v.literal(1),
	migrationId: v.string(),
	siteUrl: v.string(),
	source: importSourceValidator,
	assetMappings: v.array(importAssetMappingValidator),
	authors: v.array(importSupportingDocumentValidator),
	categories: v.array(importSupportingDocumentValidator),
	posts: v.array(importPostDocumentValidator),
});

export type SanityBlogImportPlan = Infer<typeof sanityBlogImportPlanValidator>;

export type SanityBlogImportReleaseContract = {
	version: 1;
	migrationId: string;
	siteUrl: string;
	source: SanityBlogImportPlan["source"];
	counts: {
		authors: number;
		categories: number;
		posts: number;
		assets: number;
	};
	documentKeys: {
		authors: string[];
		categories: string[];
		posts: string[];
	};
	expectedDigest: string;
};

export const ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE = {
	version: 1,
	migrationId: "CMS-4.4p",
	siteUrl: "angelsrest.online",
	source: {
		projectId: "n7rvza4g",
		dataset: "production",
		perspective: "published",
	},
	counts: { authors: 1, categories: 1, posts: 4, assets: 21 },
	documentKeys: {
		authors: ["sanity.author.a149fe6f-cff8-400d-b4f2-c5b8b60bb815"],
		categories: ["sanity.category.6382ba35-9b1e-4ca6-8b9e-2ebdecbf48ae"],
		posts: [
			"sanity.post.b1180ad9-d93c-4993-8f61-130f647d2690",
			"sanity.post.ccc0836d-cb3a-492b-a742-abcf194791f9",
			"sanity.post.e87172b6-806c-4adf-bf3f-16886ce6af94",
			"sanity.post.ef3a2006-7856-4608-9e82-1c1f19940e6c",
		],
	},
	expectedDigest: "132b3d315006879cd1e0fe556fbdb0841c3be8aba27c3ed9f55593b16c20c2d2",
} as const satisfies SanityBlogImportReleaseContract;

const SANITY_IMAGE_REF_PATTERN = /^image-[A-Za-z0-9]+-\d+x\d+-[A-Za-z0-9]+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function compareOrdinal(left: string, right: string) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sorted(values: readonly string[]) {
	return [...values].sort(compareOrdinal);
}

function assertExactStrings(
	actual: readonly string[],
	expected: readonly string[],
	label: string,
) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} do not match the released import contract`);
	}
}

function assertUnique(values: readonly string[], label: string) {
	if (new Set(values).size !== values.length) {
		throw new Error(`${label} must be unique`);
	}
}

function assetIdFromMapping(
	imageAssetIds: Readonly<Record<string, string>>,
	sourceAssetRef: string,
) {
	const value = imageAssetIds[sourceAssetRef];
	if (!value || value !== value.trim()) {
		throw new Error(`Missing reviewed media mapping for ${sourceAssetRef}`);
	}
	return value as Id<"mediaAssets">;
}

/** Build the fixed execution plan from a fresh published source conversion. */
export function createAngelsRestSanityBlogImportPlan(
	manifest: SanityBlogImportManifest,
	imageAssetIds: Readonly<Record<string, string>>,
): SanityBlogImportPlan {
	const report = createSanityBlogImportDryRunReport(manifest);
	if (report.draftImport.status === "blocked") {
		throw new Error("Published Sanity Blog source is not ready for draft import");
	}
	if (
		report.counts.authors !== ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.counts.authors
		|| report.counts.categories
			!== ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.counts.categories
		|| report.counts.posts !== ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.counts.posts
		|| report.counts.requiredSourceAssets
			!== ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.counts.assets
	) {
		throw new Error("Published Sanity Blog source counts changed from the released batch");
	}

	const sourceAssetRefs = sorted(report.requiredSourceAssetRefs);
	const mappingRefs = sorted(Object.keys(imageAssetIds));
	assertExactStrings(mappingRefs, sourceAssetRefs, "Reviewed media mapping keys");
	const assetMappings = sourceAssetRefs.map((sourceAssetRef) => ({
		sourceAssetRef,
		mediaAssetId: assetIdFromMapping(imageAssetIds, sourceAssetRef),
	}));

	const authors = manifest.authors
		.map((author) => {
			const { portrait, ...draftFields } = author.draft;
			const draft: BlogSupportingDraft = {
				...draftFields,
				portrait: portrait
					? {
							key: portrait.key,
							assetId: assetIdFromMapping(
								imageAssetIds,
								portrait.sourceAssetRef,
							),
							altText: portrait.altText,
							caption: portrait.caption,
						}
					: undefined,
			};
			return { sourceId: author.sourceId, documentKey: author.documentKey, draft };
		})
		.sort((left, right) => compareOrdinal(left.documentKey, right.documentKey));

	const categories = manifest.categories
		.map((category) => ({
			sourceId: category.sourceId,
			documentKey: category.documentKey,
			draft: category.draft as BlogSupportingDraft,
		}))
		.sort((left, right) => compareOrdinal(left.documentKey, right.documentKey));

	const posts = manifest.posts
		.map((post) => {
			const {
				authorDocumentKey,
				categories: categoryReferences,
				mainImage,
				...draftFields
			} = post.draft;
			if (!authorDocumentKey) {
				throw new Error(`Post ${post.documentKey} has no released Author reference`);
			}
			const draft: PostDraft = {
				...draftFields,
				categories: [],
				mainImage: mainImage
					? {
							key: mainImage.key,
							assetId: assetIdFromMapping(
								imageAssetIds,
								mainImage.sourceAssetRef,
							),
							altText: mainImage.altText,
							caption: mainImage.caption,
						}
					: undefined,
			};
			return {
				sourceId: post.sourceId,
				documentKey: post.documentKey,
				authorDocumentKey,
				categoryReferences,
				draft,
			};
		})
		.sort((left, right) => compareOrdinal(left.documentKey, right.documentKey));

	const plan: SanityBlogImportPlan = {
		version: 1,
		migrationId: ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.migrationId,
		siteUrl: ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.siteUrl,
		source: ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.source,
		assetMappings,
		authors,
		categories,
		posts,
	};
	assertSanityBlogImportPlan(plan, ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE);
	return plan;
}

/** Validate the semantic and cardinality boundary before hashing or writing. */
export function assertSanityBlogImportPlan(
	plan: SanityBlogImportPlan,
	contract: SanityBlogImportReleaseContract,
) {
	if (
		plan.version !== contract.version
		|| plan.migrationId !== contract.migrationId
		|| plan.siteUrl !== contract.siteUrl
		|| plan.source.projectId !== contract.source.projectId
		|| plan.source.dataset !== contract.source.dataset
		|| plan.source.perspective !== contract.source.perspective
	) throw new Error("Import source identity does not match the released contract");
	if (
		plan.authors.length !== contract.counts.authors
		|| plan.categories.length !== contract.counts.categories
		|| plan.posts.length !== contract.counts.posts
		|| plan.assetMappings.length !== contract.counts.assets
	) throw new Error("Import plan counts do not match the released contract");

	const authorKeys = plan.authors.map((item) => item.documentKey);
	const categoryKeys = plan.categories.map((item) => item.documentKey);
	const postKeys = plan.posts.map((item) => item.documentKey);
	assertExactStrings(authorKeys, contract.documentKeys.authors, "Author document keys");
	assertExactStrings(categoryKeys, contract.documentKeys.categories, "Category document keys");
	assertExactStrings(postKeys, contract.documentKeys.posts, "Post document keys");
	assertUnique([...authorKeys, ...categoryKeys, ...postKeys], "Import document keys");
	assertUnique(
		[
			...plan.authors.map((item) => item.sourceId),
			...plan.categories.map((item) => item.sourceId),
			...plan.posts.map((item) => item.sourceId),
		],
		"Import source IDs",
	);

	for (const item of plan.authors) {
		validateBlogDocumentKey(item.documentKey);
		validateBlogSupportingDraft(item.draft);
		if (item.draft.kind !== "author") throw new Error("Import Author kind mismatch");
		requireCanonicalBlogSlug(
			item.draft.slug,
			"Author slug",
			BLOG_CONTENT_LIMITS.authorSlug,
		);
		if (item.documentKey !== `sanity.author.${item.sourceId}`) {
			throw new Error("Import Author source identity mismatch");
		}
	}
	for (const item of plan.categories) {
		validateBlogDocumentKey(item.documentKey);
		validateBlogSupportingDraft(item.draft);
		if (item.draft.kind !== "category") throw new Error("Import Category kind mismatch");
		requireCanonicalBlogSlug(
			item.draft.slug,
			"Category slug",
			BLOG_CONTENT_LIMITS.categorySlug,
		);
		if (item.documentKey !== `sanity.category.${item.sourceId}`) {
			throw new Error("Import Category source identity mismatch");
		}
	}
	for (const item of plan.posts) {
		validatePostDocumentKey(item.documentKey);
		validatePostDraft(item.draft);
		requireCanonicalPostSlug(item.draft.slug);
		if (item.documentKey !== `sanity.post.${item.sourceId}`) {
			throw new Error("Import Post source identity mismatch");
		}
		if (item.draft.authorDocumentId || item.draft.categories.length > 0) {
			throw new Error("Import Post relations must remain document keys until execution");
		}
		if (!authorKeys.includes(item.authorDocumentKey)) {
			throw new Error("Import Post Author reference is not in the released batch");
		}
		assertUnique(
			item.categoryReferences.map((reference) => reference.key),
			`Import Post ${item.documentKey} Category reference keys`,
		);
		for (const reference of item.categoryReferences) {
			if (!categoryKeys.includes(reference.documentKey)) {
				throw new Error("Import Post Category reference is not in the released batch");
			}
		}
	}

	const mappingRefs = plan.assetMappings.map((mapping) => mapping.sourceAssetRef);
	const mappingIds = plan.assetMappings.map((mapping) => mapping.mediaAssetId);
	assertExactStrings(mappingRefs, sorted(mappingRefs), "Import media mapping order");
	assertUnique(mappingRefs, "Import media source references");
	assertUnique(mappingIds, "Import media target IDs");
	if (mappingRefs.some((sourceRef) => !SANITY_IMAGE_REF_PATTERN.test(sourceRef))) {
		throw new Error("Import media source reference is invalid");
	}
	const usedAssetIds = new Set<string>();
	for (const author of plan.authors) {
		if (author.draft.kind === "author" && author.draft.portrait) {
			usedAssetIds.add(author.draft.portrait.assetId);
		}
	}
	for (const post of plan.posts) {
		if (post.draft.mainImage) usedAssetIds.add(post.draft.mainImage.assetId);
		for (const block of post.draft.body.blocks) {
			if (block.type === "image") usedAssetIds.add(block.assetId);
		}
	}
	assertExactStrings(sorted([...usedAssetIds]), sorted(mappingIds), "Import media usage");
}

function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Import plan contains a non-finite number");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => compareOrdinal(left, right));
		return `{${entries
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
			.join(",")}}`;
	}
	throw new Error("Import plan contains an unsupported value");
}

export function canonicalSanityBlogImportPlan(plan: SanityBlogImportPlan) {
	return `sanity-blog-import-plan:v1:${canonicalJson(plan)}`;
}

export async function checksumSanityBlogImportPlan(plan: SanityBlogImportPlan) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(canonicalSanityBlogImportPlan(plan)),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export async function requireReleasedSanityBlogImportPlan(
	plan: SanityBlogImportPlan,
	claimedDigest: string,
	contract: SanityBlogImportReleaseContract,
) {
	assertSanityBlogImportPlan(plan, contract);
	if (!SHA256_PATTERN.test(claimedDigest) || !SHA256_PATTERN.test(contract.expectedDigest)) {
		throw new Error("Import plan digest is invalid");
	}
	const actualDigest = await checksumSanityBlogImportPlan(plan);
	if (
		claimedDigest !== actualDigest
		|| claimedDigest !== contract.expectedDigest
	) throw new Error("Import plan digest does not match the released batch");
	return actualDigest;
}
