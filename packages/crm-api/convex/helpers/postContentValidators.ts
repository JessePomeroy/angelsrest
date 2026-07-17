import type { Infer } from "convex/values";
import { v } from "convex/values";
import {
	type RichTextDocument,
	richTextDocumentValidator,
} from "./richTextContract";
import {
	assertRichTextDocument,
	richTextToPlainText,
} from "./richTextValidation";
import {
	assertMaximum,
	assertOnlyKeys,
	assertPostFormatCounts,
	assertPostFormatFields,
	assertPostPresentation,
	POST_CONTENT_LIMITS,
	requireCanonicalPostSlug,
	requireText,
	validatePostKey,
	validateTechnicalItems,
} from "./postContentValidationSupport";

export {
	POST_CONTENT_LIMITS,
	postSlugCandidate,
	requireCanonicalPostSlug,
} from "./postContentValidationSupport";

export const postFormatValidator = v.union(
	v.literal("essay"),
	v.literal("projectStory"),
	v.literal("technicalNote"),
);

export const postPresentationValidator = v.union(
	v.literal("standard"),
	v.literal("behindTheScenes"),
	v.literal("caseStudy"),
	v.literal("clientStory"),
	v.literal("technical"),
);

export const postTechnicalItemValidator = v.object({
	key: v.string(),
	label: v.optional(v.string()),
	details: v.optional(v.string()),
});

export const postCategoryReferenceDraftValidator = v.object({
	key: v.string(),
	documentId: v.id("contentDocuments"),
});

export const postMainImageDraftValidator = v.object({
	key: v.string(),
	assetId: v.id("mediaAssets"),
	altText: v.optional(v.string()),
	caption: v.optional(v.string()),
});

/**
 * Post autosaves keep the complete provider-neutral graph at the API boundary.
 * The store splits body, media, and references into immutable child rows.
 */
export const postDraftValidator = v.object({
	kind: v.literal("post"),
	title: v.optional(v.string()),
	slug: v.optional(v.string()),
	format: v.optional(postFormatValidator),
	presentation: v.optional(postPresentationValidator),
	displayPublishedAt: v.optional(v.number()),
	summary: v.optional(v.string()),
	seoTitle: v.optional(v.string()),
	seoDescription: v.optional(v.string()),
	brief: v.optional(v.string()),
	approach: v.optional(v.string()),
	outcome: v.optional(v.string()),
	credits: v.optional(v.string()),
	equipment: v.array(postTechnicalItemValidator),
	materials: v.array(postTechnicalItemValidator),
	authorDocumentId: v.optional(v.id("contentDocuments")),
	categories: v.array(postCategoryReferenceDraftValidator),
	mainImage: v.optional(postMainImageDraftValidator),
	body: richTextDocumentValidator,
});

/** Large ordered graph fields never live in the revision document itself. */
export const postRevisionPayloadValidator = v.object({
	kind: v.literal("post"),
	title: v.optional(v.string()),
	slug: v.optional(v.string()),
	format: v.optional(postFormatValidator),
	presentation: v.optional(postPresentationValidator),
	displayPublishedAt: v.optional(v.number()),
	summary: v.optional(v.string()),
	seoTitle: v.optional(v.string()),
	seoDescription: v.optional(v.string()),
	brief: v.optional(v.string()),
	approach: v.optional(v.string()),
	outcome: v.optional(v.string()),
	credits: v.optional(v.string()),
	excerpt: v.string(),
	summaryChecksum: v.string(),
	bodyBlockCount: v.number(),
	categoryCount: v.number(),
	equipmentCount: v.number(),
	materialCount: v.number(),
	mediaPlacementCount: v.number(),
	referenceCount: v.number(),
	hasAuthor: v.boolean(),
	hasMainImage: v.boolean(),
});

export type PostFormat = Infer<typeof postFormatValidator>;
export type PostPresentation = Infer<typeof postPresentationValidator>;
export type PostTechnicalItem = Infer<typeof postTechnicalItemValidator>;
export type PostCategoryReferenceDraft = Infer<
	typeof postCategoryReferenceDraftValidator
>;
export type PostMainImageDraft = Infer<typeof postMainImageDraftValidator>;
export type PostDraft = Infer<typeof postDraftValidator>;
export type PostRevisionPayload = Infer<typeof postRevisionPayloadValidator>;

export type PublishedPostDraft = PostDraft & {
	title: string;
	slug: string;
	format: PostFormat;
	presentation: PostPresentation;
	displayPublishedAt: number;
	summary: string;
	authorDocumentId: NonNullable<PostDraft["authorDocumentId"]>;
	body: RichTextDocument;
};

export type PublishedPostHeader = PostRevisionPayload & {
	title: string;
	slug: string;
	format: PostFormat;
	presentation: PostPresentation;
	displayPublishedAt: number;
	summary: string;
};

function validateMainImage(image: PostMainImageDraft) {
	assertOnlyKeys(
		image,
		new Set(["key", "assetId", "altText", "caption"]),
		"Post main image",
	);
	validatePostKey(image.key, POST_CONTENT_LIMITS.placementKey, "Post main image key");
	assertMaximum(image.altText, POST_CONTENT_LIMITS.altText, "Post main image alt text");
	assertMaximum(image.caption, POST_CONTENT_LIMITS.caption, "Post main image caption");
}

export function validatePostDraft(draft: PostDraft) {
	assertOnlyKeys(
		draft,
		new Set([
			"kind",
			"title",
			"slug",
			"format",
			"presentation",
			"displayPublishedAt",
			"summary",
			"seoTitle",
			"seoDescription",
			"brief",
			"approach",
			"outcome",
			"credits",
			"equipment",
			"materials",
			"authorDocumentId",
			"categories",
			"mainImage",
			"body",
		]),
		"Post draft",
	);
	if (draft.kind !== "post") throw new Error("Post draft kind must be post");
	assertMaximum(draft.title, POST_CONTENT_LIMITS.title, "Post title");
	assertMaximum(draft.slug, POST_CONTENT_LIMITS.slug, "Post slug");
	assertMaximum(draft.summary, POST_CONTENT_LIMITS.summary, "Post summary");
	assertMaximum(draft.seoTitle, POST_CONTENT_LIMITS.seoTitle, "Post SEO title");
	assertMaximum(
		draft.seoDescription,
		POST_CONTENT_LIMITS.seoDescription,
		"Post SEO description",
	);
	assertMaximum(draft.brief, POST_CONTENT_LIMITS.sectionText, "Post brief");
	assertMaximum(draft.approach, POST_CONTENT_LIMITS.sectionText, "Post approach");
	assertMaximum(draft.outcome, POST_CONTENT_LIMITS.sectionText, "Post outcome");
	assertMaximum(draft.credits, POST_CONTENT_LIMITS.credits, "Post credits");
	if (
		draft.displayPublishedAt !== undefined
		&& (!Number.isSafeInteger(draft.displayPublishedAt) || draft.displayPublishedAt < 0)
	) throw new Error("Post display publication time must be a non-negative integer");

	validateTechnicalItems(draft.equipment, "Equipment");
	validateTechnicalItems(draft.materials, "Materials");
	if (draft.categories.length > POST_CONTENT_LIMITS.categories) {
		throw new Error(
			`Post categories cannot contain more than ${POST_CONTENT_LIMITS.categories} items`,
		);
	}
	const categoryKeys = new Set<string>();
	const categoryDocuments = new Set<string>();
	for (const category of draft.categories) {
		assertOnlyKeys(category, new Set(["key", "documentId"]), "Post category reference");
		validatePostKey(
			category.key,
			POST_CONTENT_LIMITS.referenceKey,
			"Post category reference key",
		);
		if (categoryKeys.has(category.key)) throw new Error("Post category reference keys must be unique");
		if (categoryDocuments.has(category.documentId)) {
			throw new Error("Post category references must target unique documents");
		}
		categoryKeys.add(category.key);
		categoryDocuments.add(category.documentId);
	}
	if (draft.mainImage) validateMainImage(draft.mainImage);
	const body = assertRichTextDocument(draft.body, "draft");
	if (body.blocks.length > POST_CONTENT_LIMITS.bodyBlocks) {
		throw new Error(
			`Post body cannot contain more than ${POST_CONTENT_LIMITS.bodyBlocks} blocks`,
		);
	}
	const imageBlocks = body.blocks.filter((block) => block.type === "image");
	if (imageBlocks.length > POST_CONTENT_LIMITS.bodyImages) {
		throw new Error(
			`Post body cannot contain more than ${POST_CONTENT_LIMITS.bodyImages} images`,
		);
	}
	for (const image of imageBlocks) {
		validatePostKey(image.key, POST_CONTENT_LIMITS.placementKey, "Post body image key");
		assertMaximum(image.altText, POST_CONTENT_LIMITS.altText, "Post body image alt text");
		assertMaximum(image.caption, POST_CONTENT_LIMITS.caption, "Post body image caption");
	}
	return { ...draft, body };
}

export function toPublishedPostHeader(
	payload: PostRevisionPayload,
): PublishedPostHeader {
	validatePostRevisionPayload(payload);
	const format = payload.format;
	const presentation = payload.presentation;
	if (!format) throw new Error("Post format is required before publishing");
	if (!presentation) throw new Error("Post presentation is required before publishing");
	assertPostPresentation(format, presentation);
	if (!payload.hasAuthor) throw new Error("Post author is required before publishing");
	assertPostFormatCounts({ ...payload, format });
	if (
		payload.displayPublishedAt === undefined
		|| !Number.isSafeInteger(payload.displayPublishedAt)
		|| payload.displayPublishedAt < 0
	) throw new Error("Post display publication time is required before publishing");
	const summary = requireText(payload.summary, "Post summary", POST_CONTENT_LIMITS.summary);
	if (payload.excerpt !== summary) throw new Error("Published Post excerpt must match its summary");
	return {
		...payload,
		title: requireText(payload.title, "Post title", POST_CONTENT_LIMITS.title),
		slug: requireCanonicalPostSlug(payload.slug),
		format,
		presentation,
		displayPublishedAt: payload.displayPublishedAt,
		summary,
	};
}

export function toPublishedPostDraft(draft: PostDraft): PublishedPostDraft {
	const validated = validatePostDraft(draft);
	const format = validated.format;
	const presentation = validated.presentation;
	if (!format) throw new Error("Post format is required before publishing");
	if (!presentation) throw new Error("Post presentation is required before publishing");
	assertPostPresentation(format, presentation);
	if (!validated.authorDocumentId) {
		throw new Error("Post author is required before publishing");
	}
	const body = assertRichTextDocument(validated.body, "publish");
	assertPostFormatFields({ ...validated, format });
	for (const image of body.blocks.filter((block) => block.type === "image")) {
		requireText(image.altText, "Post body image alt text", POST_CONTENT_LIMITS.altText);
	}
	if (validated.mainImage) {
		requireText(
			validated.mainImage.altText,
			"Post main image alt text",
			POST_CONTENT_LIMITS.altText,
		);
	}
	return {
		...validated,
		title: requireText(validated.title, "Post title", POST_CONTENT_LIMITS.title),
		slug: requireCanonicalPostSlug(validated.slug),
		format,
		presentation,
		displayPublishedAt:
			validated.displayPublishedAt
			?? (() => {
				throw new Error("Post display publication time is required before publishing");
			})(),
		summary: requireText(validated.summary, "Post summary", POST_CONTENT_LIMITS.summary),
		authorDocumentId: validated.authorDocumentId,
		body,
	};
}

export function postExcerptFromDraft(draft: PostDraft) {
	const summary = draft.summary?.trim();
	if (summary) return summary.slice(0, POST_CONTENT_LIMITS.summary);
	return richTextToPlainText(draft.body)
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, POST_CONTENT_LIMITS.summary);
}

export function postRevisionPayloadFromDraft(
	draft: PostDraft,
	summaryChecksum: string,
): PostRevisionPayload {
	const validated = validatePostDraft(draft);
	const bodyImages = validated.body.blocks.filter((block) => block.type === "image").length;
	return {
		kind: "post",
		title: validated.title,
		slug: validated.slug,
		format: validated.format,
		presentation: validated.presentation,
		displayPublishedAt: validated.displayPublishedAt,
		summary: validated.summary,
		seoTitle: validated.seoTitle,
		seoDescription: validated.seoDescription,
		brief: validated.brief,
		approach: validated.approach,
		outcome: validated.outcome,
		credits: validated.credits,
		excerpt: postExcerptFromDraft(validated),
		summaryChecksum,
		bodyBlockCount: validated.body.blocks.length,
		categoryCount: validated.categories.length,
		equipmentCount: validated.equipment.length,
		materialCount: validated.materials.length,
		mediaPlacementCount: bodyImages + (validated.mainImage ? 1 : 0),
		referenceCount: validated.categories.length + (validated.authorDocumentId ? 1 : 0),
		hasAuthor: validated.authorDocumentId !== undefined,
		hasMainImage: validated.mainImage !== undefined,
	};
}

export function serializePostRevisionPayload(payload: PostRevisionPayload) {
	validatePostRevisionPayload(payload);
	return JSON.stringify({
		kind: "post",
		title: payload.title ?? null,
		slug: payload.slug ?? null,
		format: payload.format ?? null,
		presentation: payload.presentation ?? null,
		displayPublishedAt: payload.displayPublishedAt ?? null,
		summary: payload.summary ?? null,
		seoTitle: payload.seoTitle ?? null,
		seoDescription: payload.seoDescription ?? null,
		brief: payload.brief ?? null,
		approach: payload.approach ?? null,
		outcome: payload.outcome ?? null,
		credits: payload.credits ?? null,
		excerpt: payload.excerpt,
		summaryChecksum: payload.summaryChecksum,
		bodyBlockCount: payload.bodyBlockCount,
		categoryCount: payload.categoryCount,
		equipmentCount: payload.equipmentCount,
		materialCount: payload.materialCount,
		mediaPlacementCount: payload.mediaPlacementCount,
		referenceCount: payload.referenceCount,
		hasAuthor: payload.hasAuthor,
		hasMainImage: payload.hasMainImage,
	});
}

export function validatePostRevisionPayload(payload: PostRevisionPayload) {
	const counts = [
		payload.bodyBlockCount,
		payload.categoryCount,
		payload.equipmentCount,
		payload.materialCount,
		payload.mediaPlacementCount,
		payload.referenceCount,
	];
	if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
		throw new Error("Post revision counts must be non-negative integers");
	}
	if (
		payload.bodyBlockCount > POST_CONTENT_LIMITS.bodyBlocks
		|| payload.categoryCount > POST_CONTENT_LIMITS.categories
		|| payload.equipmentCount > POST_CONTENT_LIMITS.technicalItems
		|| payload.materialCount > POST_CONTENT_LIMITS.technicalItems
		|| payload.mediaPlacementCount > POST_CONTENT_LIMITS.bodyImages + 1
		|| payload.referenceCount > POST_CONTENT_LIMITS.categories + 1
	) throw new Error("Post revision count exceeds its graph limit");
	assertMaximum(payload.title, POST_CONTENT_LIMITS.title, "Post title");
	assertMaximum(payload.slug, POST_CONTENT_LIMITS.slug, "Post slug");
	assertMaximum(payload.summary, POST_CONTENT_LIMITS.summary, "Post summary");
	assertMaximum(payload.excerpt, POST_CONTENT_LIMITS.summary, "Post excerpt");
	assertMaximum(payload.seoTitle, POST_CONTENT_LIMITS.seoTitle, "Post SEO title");
	assertMaximum(
		payload.seoDescription,
		POST_CONTENT_LIMITS.seoDescription,
		"Post SEO description",
	);
	assertMaximum(payload.brief, POST_CONTENT_LIMITS.sectionText, "Post brief");
	assertMaximum(payload.approach, POST_CONTENT_LIMITS.sectionText, "Post approach");
	assertMaximum(payload.outcome, POST_CONTENT_LIMITS.sectionText, "Post outcome");
	assertMaximum(payload.credits, POST_CONTENT_LIMITS.credits, "Post credits");
	if (!/^[a-f0-9]{64}$/.test(payload.summaryChecksum)) {
		throw new Error("Post revision summary checksum is invalid");
	}
	if (payload.referenceCount !== payload.categoryCount + (payload.hasAuthor ? 1 : 0)) {
		throw new Error("Post revision reference count is inconsistent");
	}
	if (payload.hasMainImage && payload.mediaPlacementCount < 1) {
		throw new Error("Post revision media count is inconsistent");
	}
	return payload;
}
