import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
	getPostEditorState,
	getPublishedPostBySlug,
	listPostEditorDocuments,
	listPublishedPosts,
} from "./helpers/postContentQueries";
import {
	createPostDraft,
	discardPostDraft,
	publishPostDraft,
	savePostDraft,
} from "./helpers/postContentStore";
import { postDraftValidator } from "./helpers/postContentValidators";

/** Create one idempotently keyed Post draft for a verified tenant. */
export const createDraft = mutation({
	args: {
		siteUrl: v.string(),
		documentKey: v.string(),
		draft: postDraftValidator,
	},
	handler: async (ctx, args) => await createPostDraft(ctx, args),
});

/** Save one immutable, conflict-checked Post graph revision. */
export const saveDraft = mutation({
	args: {
		documentId: v.id("contentDocuments"),
		expectedDraftRevisionId: v.optional(v.id("contentRevisions")),
		draft: postDraftValidator,
	},
	handler: async (ctx, args) => await savePostDraft(ctx, args),
});

/** Publish only the exact complete draft graph; an exact retry is harmless. */
export const publish = mutation({
	args: {
		documentId: v.id("contentDocuments"),
		draftRevisionId: v.id("contentRevisions"),
	},
	handler: async (ctx, args) => await publishPostDraft(ctx, args),
});

/** Clear only the exact active draft pointer while retaining immutable rows. */
export const discardDraft = mutation({
	args: {
		documentId: v.id("contentDocuments"),
		draftRevisionId: v.id("contentRevisions"),
	},
	handler: async (ctx, args) => await discardPostDraft(ctx, args),
});

/** Authenticated full graph state for one tenant-owned Post. */
export const getEditorState = query({
	args: { documentId: v.id("contentDocuments") },
	handler: async (ctx, { documentId }) =>
		await getPostEditorState(ctx, documentId),
});

/** Bounded Post headers for one authorized Editor workspace. */
export const listForEditor = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) =>
		await listPostEditorDocuments(ctx, siteUrl),
});

/** Public-safe exact slug read of a complete published Post graph. */
export const getPublishedBySlug = query({
	args: { siteUrl: v.string(), slug: v.string() },
	handler: async (ctx, args) => await getPublishedPostBySlug(ctx, args),
});

/** Newest published Post summaries, explicitly bounded for public routes. */
export const listPublished = query({
	args: { siteUrl: v.string(), limit: v.number() },
	handler: async (ctx, { siteUrl, limit }) =>
		await listPublishedPosts(ctx, siteUrl, limit),
});
