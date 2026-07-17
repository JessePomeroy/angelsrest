import type { Infer } from "convex/values";
import { v } from "convex/values";
import {
	richTextDocumentValidator,
	type RichTextDocument,
} from "./richTextContract";
import {
	assertMaximum,
	assertOnlyKeys,
	BLOG_CONTENT_LIMITS,
	inspectTextOnlyBio,
	optionalText,
	requireCanonicalBlogSlug,
	requireText,
	validatePortraitDraft,
} from "./blogContentValidationSupport";

export {
	authorSlugCandidate,
	BLOG_CONTENT_LIMITS,
	blogSlugCandidate,
	categorySlugCandidate,
	requireCanonicalBlogSlug,
} from "./blogContentValidationSupport";

export const blogSupportingKindValidator = v.union(
	v.literal("author"),
	v.literal("category"),
);

export type BlogSupportingKind = Infer<typeof blogSupportingKindValidator>;

export const authorPortraitDraftValidator = v.object({
	key: v.string(),
	assetId: v.id("mediaAssets"),
	altText: v.optional(v.string()),
	caption: v.optional(v.string()),
});

/**
 * Supporting-document drafts are deliberately incomplete-friendly. Runtime
 * validation below supplies the semantic bounds that Convex value validators
 * cannot express and keeps author biographies text-only.
 */
export const authorDraftValidator = v.object({
	kind: v.literal("author"),
	name: v.optional(v.string()),
	slug: v.optional(v.string()),
	bio: v.optional(richTextDocumentValidator),
	portrait: v.optional(authorPortraitDraftValidator),
});

export const categoryDraftValidator = v.object({
	kind: v.literal("category"),
	title: v.optional(v.string()),
	slug: v.optional(v.string()),
	description: v.optional(v.string()),
});

export const blogSupportingDraftValidator = v.union(
	authorDraftValidator,
	categoryDraftValidator,
);

export type AuthorPortraitDraft = Infer<typeof authorPortraitDraftValidator>;
export type AuthorDraft = Infer<typeof authorDraftValidator>;
export type CategoryDraft = Infer<typeof categoryDraftValidator>;
export type BlogSupportingDraft = Infer<typeof blogSupportingDraftValidator>;

/**
 * Author and Category are small, bounded supporting records, so their API
 * drafts are also their exact immutable-revision payloads. Post bodies and
 * post media move to child rows in the next iteration instead.
 */
export const blogContentRevisionPayloadValidator = blogSupportingDraftValidator;
export type BlogContentRevisionPayload = BlogSupportingDraft;

export type PublishedAuthor = {
	kind: "author";
	name: string;
	slug: string;
	bio?: RichTextDocument;
	portrait?: {
		key: string;
		assetId: AuthorPortraitDraft["assetId"];
		altText: string;
		caption?: string;
	};
};

export type PublishedCategory = {
	kind: "category";
	title: string;
	slug: string;
	description?: string;
};

export type PublishedBlogSupportingContent =
	| PublishedAuthor
	| PublishedCategory;

/** Bound an incomplete author draft and reject provider/layout-only fields. */
export function validateAuthorDraft(payload: AuthorDraft) {
	assertOnlyKeys(
		payload,
		new Set(["kind", "name", "slug", "bio", "portrait"]),
		"Author draft",
	);
	if (payload.kind !== "author") {
		throw new Error("Author draft kind must be author");
	}
	assertMaximum(payload.name, BLOG_CONTENT_LIMITS.authorName, "Author name");
	assertMaximum(payload.slug, BLOG_CONTENT_LIMITS.authorSlug, "Author slug");
	if (payload.bio !== undefined) inspectTextOnlyBio(payload.bio, "draft");
	if (payload.portrait !== undefined) validatePortraitDraft(payload.portrait);
}

/** Bound an incomplete category draft and reject unsupported fields. */
export function validateCategoryDraft(payload: CategoryDraft) {
	assertOnlyKeys(
		payload,
		new Set(["kind", "title", "slug", "description"]),
		"Category draft",
	);
	if (payload.kind !== "category") {
		throw new Error("Category draft kind must be category");
	}
	assertMaximum(
		payload.title,
		BLOG_CONTENT_LIMITS.categoryTitle,
		"Category title",
	);
	assertMaximum(
		payload.slug,
		BLOG_CONTENT_LIMITS.categorySlug,
		"Category slug",
	);
	assertMaximum(
		payload.description,
		BLOG_CONTENT_LIMITS.categoryDescription,
		"Category description",
	);
}

export function validateBlogSupportingDraft(payload: BlogSupportingDraft) {
	if (payload.kind === "author") validateAuthorDraft(payload);
	else validateCategoryDraft(payload);
}

/** Return a complete, normalized provider-neutral public author projection. */
export function toPublishedAuthor(payload: AuthorDraft): PublishedAuthor {
	validateAuthorDraft(payload);
	const bio = payload.bio === undefined
		? undefined
		: inspectTextOnlyBio(payload.bio, "publish");
	const portrait = payload.portrait === undefined
		? undefined
		: (() => {
			const altText = requireText(
				payload.portrait.altText,
				"Author portrait alt text",
				BLOG_CONTENT_LIMITS.portraitAltText,
			);
			const caption = optionalText(
				payload.portrait.caption,
				"Author portrait caption",
				BLOG_CONTENT_LIMITS.portraitCaption,
			);
			return {
				key: payload.portrait.key,
				assetId: payload.portrait.assetId,
				altText,
				...(caption ? { caption } : {}),
			};
		})();

	return {
		kind: "author",
		name: requireText(
			payload.name,
			"Author name",
			BLOG_CONTENT_LIMITS.authorName,
		),
		slug: requireCanonicalBlogSlug(
			payload.slug,
			"Author slug",
			BLOG_CONTENT_LIMITS.authorSlug,
		),
		...(bio && bio.blocks.length > 0 ? { bio } : {}),
		...(portrait ? { portrait } : {}),
	};
}

/** Return a complete, normalized provider-neutral public category projection. */
export function toPublishedCategory(payload: CategoryDraft): PublishedCategory {
	validateCategoryDraft(payload);
	const description = optionalText(
		payload.description,
		"Category description",
		BLOG_CONTENT_LIMITS.categoryDescription,
	);
	return {
		kind: "category",
		title: requireText(
			payload.title,
			"Category title",
			BLOG_CONTENT_LIMITS.categoryTitle,
		),
		slug: requireCanonicalBlogSlug(
			payload.slug,
			"Category slug",
			BLOG_CONTENT_LIMITS.categorySlug,
		),
		...(description ? { description } : {}),
	};
}

export function toPublishedBlogSupportingContent(
	payload: BlogSupportingDraft,
): PublishedBlogSupportingContent {
	return payload.kind === "author"
		? toPublishedAuthor(payload)
		: toPublishedCategory(payload);
}

/** Stable draft serialization preserves authored rich-text order and nulls. */
export function serializeAuthorDraft(payload: AuthorDraft) {
	validateAuthorDraft(payload);
	const bio = payload.bio === undefined
		? null
		: inspectTextOnlyBio(payload.bio, "draft");
	return JSON.stringify({
		kind: "author",
		name: payload.name ?? null,
		slug: payload.slug ?? null,
		bio,
		portrait: payload.portrait
			? {
				key: payload.portrait.key,
				assetId: payload.portrait.assetId,
				altText: payload.portrait.altText ?? null,
				caption: payload.portrait.caption ?? null,
			}
			: null,
	});
}

export function serializeCategoryDraft(payload: CategoryDraft) {
	validateCategoryDraft(payload);
	return JSON.stringify({
		kind: "category",
		title: payload.title ?? null,
		slug: payload.slug ?? null,
		description: payload.description ?? null,
	});
}

export function serializeBlogSupportingDraft(payload: BlogSupportingDraft) {
	return payload.kind === "author"
		? serializeAuthorDraft(payload)
		: serializeCategoryDraft(payload);
}

/** Domain/version prefix prevents accidental checksum reuse across stores. */
export function blogContentChecksumInput(payload: BlogSupportingDraft) {
	return `blog-supporting-content:v1:${serializeBlogSupportingDraft(payload)}`;
}
