import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { catalogProductDraftValidator } from "./helpers/catalogProductValidators";
import {
	createCatalogProductDraft,
	discardCatalogProductDraft,
	getCatalogProductEditorState,
	saveCatalogProductDraft,
} from "./helpers/catalogProductStore";

/** Create the first private, immutable draft graph for one single print. */
export const createDraft = mutation({
	args: {
		siteUrl: v.string(),
		productKey: v.string(),
		draft: catalogProductDraftValidator,
	},
	handler: async (ctx, args) => await createCatalogProductDraft(ctx, args),
});

/** Save a replacement draft without mutating any historical revision or variant. */
export const saveDraft = mutation({
	args: {
		productId: v.id("catalogProducts"),
		expectedDraftRevisionId: v.optional(v.id("catalogProductRevisions")),
		draft: catalogProductDraftValidator,
	},
	handler: async (ctx, args) => await saveCatalogProductDraft(ctx, args),
});

/** Clear only the current draft pointer; immutable history remains retained. */
export const discardDraft = mutation({
	args: {
		productId: v.id("catalogProducts"),
		draftRevisionId: v.id("catalogProductRevisions"),
	},
	handler: async (ctx, args) => await discardCatalogProductDraft(ctx, args),
});

/** Authenticated editor-only read. CMS-5.2 intentionally exports no public read. */
export const getEditorState = query({
	args: { productId: v.id("catalogProducts") },
	handler: async (ctx, { productId }) =>
		await getCatalogProductEditorState(ctx, productId),
});
