import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
	createCatalogProductGraphV2Draft,
	discardCatalogProductGraphV2Draft,
	getCatalogProductGraphV2EditorState,
	getCatalogProductGraphV2RetirementEligibility,
	importSanityCatalogGraphV2Drafts,
	listCatalogProductGraphsV2ForEditor,
	replaceCatalogProductGraphV2DraftPrivateAsset,
	saveCatalogProductGraphV2Draft,
} from "./helpers/catalogProductGraphStore";
import {
	catalogGraphV2PrivateAssetReplacementValidator,
	catalogProductGraphV2DraftValidator,
} from "./helpers/catalogProductGraphValidators";
import { catalogProductKindValidator } from "./helpers/catalogProductValidators";
import { sanityCatalogV2GraphPlanValidator } from "./helpers/sanityCatalogGraphPlan";

/** Create the first private, immutable V2 graph for one catalog product. */
export const createDraft = mutation({
	args: {
		siteUrl: v.string(),
		productKey: v.string(),
		draft: catalogProductGraphV2DraftValidator,
	},
	handler: async (ctx, args) => await createCatalogProductGraphV2Draft(ctx, args),
});

/** Import the complete Sanity catalog as dormant, unpublished private V2 drafts. */
export const importSanityDrafts = mutation({
	args: {
		siteUrl: v.string(),
		plan: sanityCatalogV2GraphPlanValidator,
	},
	handler: async (ctx, args) => await importSanityCatalogGraphV2Drafts(ctx, args),
});

/** Save a replacement private draft without mutating historical graph rows. */
export const saveDraft = mutation({
	args: {
		productId: v.id("catalogProducts"),
		expectedDraftRevisionId: v.optional(v.id("catalogProductRevisions")),
		draft: catalogProductGraphV2DraftValidator,
	},
	handler: async (ctx, args) => await saveCatalogProductGraphV2Draft(ctx, args),
});

/** Switch one existing private draft relation to an already verified tenant asset. */
export const replaceDraftPrivateAsset = mutation({
	args: {
		productId: v.id("catalogProducts"),
		expectedDraftRevisionId: v.id("catalogProductRevisions"),
		relation: catalogGraphV2PrivateAssetReplacementValidator,
	},
	handler: async (ctx, args) =>
		await replaceCatalogProductGraphV2DraftPrivateAsset(ctx, args),
});

/** Clear the active draft pointer while retaining immutable V2 history. */
export const discardDraft = mutation({
	args: {
		productId: v.id("catalogProducts"),
		draftRevisionId: v.id("catalogProductRevisions"),
	},
	handler: async (ctx, args) => await discardCatalogProductGraphV2Draft(ctx, args),
});

/** Authenticated Editor-only detail read; no storefront read exists here. */
export const getEditorState = query({
	args: { productId: v.id("catalogProducts") },
	handler: async (ctx, { productId }) =>
		await getCatalogProductGraphV2EditorState(ctx, productId),
});

/** Read-only retirement and external cleanup eligibility proof; deletes nothing. */
export const getRetirementEligibility = query({
	args: { productId: v.id("catalogProducts") },
	handler: async (ctx, { productId }) =>
		await getCatalogProductGraphV2RetirementEligibility(ctx, productId),
});

/** Bounded private headers for one authenticated tenant and product kind. */
export const listForEditor = query({
	args: {
		siteUrl: v.string(),
		productKind: catalogProductKindValidator,
	},
	handler: async (ctx, { siteUrl, productKind }) =>
		await listCatalogProductGraphsV2ForEditor(ctx, siteUrl, productKind),
});
