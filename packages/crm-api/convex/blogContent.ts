import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
	getBlogEditorState,
	getPublishedBlogBySlug,
	listBlogEditorDocuments,
	listPublishedBlogDocuments,
	resolvePublishedBlogSlug,
} from "./helpers/blogContentQueries";
import {
	createBlogDraft,
	discardBlogDraft,
	publishBlogDraft,
	saveBlogDraft,
} from "./helpers/blogContentStore";
import {
	blogSupportingDraftValidator,
	blogSupportingKindValidator,
} from "./helpers/blogContentValidators";
import { publishedSlugChangeValidator } from "./helpers/contentValidators";

/** Create one idempotently keyed Author or Category draft for a verified site. */
export const createDraft = mutation({
	args: {
		siteUrl: v.string(),
		documentKey: v.string(),
		draft: blogSupportingDraftValidator,
	},
	handler: async (ctx, args) => await createBlogDraft(ctx, args),
});

/** Save an immutable revision of exactly one authorized supporting document. */
export const saveDraft = mutation({
	args: {
		documentId: v.id("contentDocuments"),
		expectedDraftRevisionId: v.optional(v.id("contentRevisions")),
		draft: blogSupportingDraftValidator,
	},
	handler: async (ctx, args) => await saveBlogDraft(ctx, args),
});

/** Publish only the current complete draft; an exact retry is harmless. */
export const publish = mutation({
	args: {
		documentId: v.id("contentDocuments"),
		draftRevisionId: v.id("contentRevisions"),
		publishedSlugChange: v.optional(publishedSlugChangeValidator),
	},
	handler: async (ctx, args) => await publishBlogDraft(ctx, args),
});

/** Clear only the exact active draft pointer while retaining immutable history. */
export const discardDraft = mutation({
	args: {
		documentId: v.id("contentDocuments"),
		draftRevisionId: v.id("contentRevisions"),
	},
	handler: async (ctx, args) => await discardBlogDraft(ctx, args),
});

/** Authenticated Author/Category editor state derived from document ownership. */
export const getEditorState = query({
	args: { documentId: v.id("contentDocuments") },
	handler: async (ctx, { documentId }) =>
		await getBlogEditorState(ctx, documentId),
});

/** Bounded, server-ranked supporting records for one authorized tenant. */
export const listForEditor = query({
	args: {
		siteUrl: v.string(),
		kind: blogSupportingKindValidator,
	},
	handler: async (ctx, { siteUrl, kind }) =>
		await listBlogEditorDocuments(ctx, siteUrl, kind),
});

/** Public-safe exact slug read; drafts and private media fields are absent. */
export const getPublishedBySlug = query({
	args: {
		siteUrl: v.string(),
		kind: blogSupportingKindValidator,
		slug: v.string(),
	},
	handler: async (ctx, args) => await getPublishedBlogBySlug(ctx, args),
});

/** Public-safe current-or-retained slug resolution for host-owned HTTP routing. */
export const resolvePublishedSlug = query({
	args: {
		siteUrl: v.string(),
		kind: blogSupportingKindValidator,
		slug: v.string(),
	},
	handler: async (ctx, args) => await resolvePublishedBlogSlug(ctx, args),
});

/** Bounded public supporting-content projection in server-assigned rank order. */
export const listPublished = query({
	args: {
		siteUrl: v.string(),
		kind: blogSupportingKindValidator,
	},
	handler: async (ctx, { siteUrl, kind }) =>
		await listPublishedBlogDocuments(ctx, siteUrl, kind),
});
