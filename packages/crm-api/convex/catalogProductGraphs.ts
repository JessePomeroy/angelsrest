import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
	createCatalogProductGraphV2Draft,
	discardCatalogProductGraphV2Draft,
	getCatalogProductGraphV2EditorState,
	getCatalogProductGraphV2RetirementEligibility,
	getPublishedCatalogProductGraphV2BySlug,
	importSanityCatalogGraphV2Drafts,
	listCatalogProductGraphV2DraftPrivateAssetCandidates,
	listCatalogProductGraphsV2ForEditor,
	listPublishedCatalogProductGraphsV2,
	publishCatalogProductGraphV2Draft,
	replaceCatalogProductGraphV2DraftPrivateAsset,
	saveCatalogProductGraphV2Draft,
	unpublishCatalogProductGraphV2,
} from "./helpers/catalogProductGraphStore";
import {
	catalogGraphV2PrivateAssetRelationValidator,
	catalogGraphV2PrivateAssetReplacementValidator,
	catalogProductGraphV2DraftValidator,
	catalogProductGraphV2PublicValidator,
	catalogProductPublicationResultValidator,
	catalogProductPublicationRevisionValidator,
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

/** List verified tenant assets compatible with one proven active draft relation. */
export const listDraftPrivateAssetCandidates = query({
	args: {
		productId: v.id("catalogProducts"),
		expectedDraftRevisionId: v.id("catalogProductRevisions"),
		relation: catalogGraphV2PrivateAssetRelationValidator,
		paginationOpts: paginationOptsValidator,
	},
	handler: async (ctx, args) =>
		await listCatalogProductGraphV2DraftPrivateAssetCandidates(ctx, args),
});

/** Clear the active draft pointer while retaining immutable V2 history. */
export const discardDraft = mutation({
	args: {
		productId: v.id("catalogProducts"),
		draftRevisionId: v.id("catalogProductRevisions"),
	},
	handler: async (ctx, args) => await discardCatalogProductGraphV2Draft(ctx, args),
});

const publicationCasArgs = {
	productId: v.id("catalogProducts"),
	expectedDraftRevisionId: catalogProductPublicationRevisionValidator,
	expectedPublishedRevisionId: catalogProductPublicationRevisionValidator,
	expectedUpdatedAt: v.number(),
};

/** Publish the exact active complete draft; stale or duplicate submissions conflict. */
export const publishDraft = mutation({
	args: publicationCasArgs,
	returns: catalogProductPublicationResultValidator,
	handler: async (ctx, args) => await publishCatalogProductGraphV2Draft(ctx, args),
});

/** Clear the exact publication pointer; stale or duplicate submissions conflict. */
export const unpublish = mutation({
	args: publicationCasArgs,
	returns: catalogProductPublicationResultValidator,
	handler: async (ctx, args) => await unpublishCatalogProductGraphV2(ctx, args),
});

/** Unauthenticated, fixed-cap projection of the current published catalog. */
export const listPublished = query({
	args: { siteUrl: v.string() },
	returns: v.array(catalogProductGraphV2PublicValidator),
	handler: async (ctx, { siteUrl }) =>
		await listPublishedCatalogProductGraphsV2(ctx, siteUrl),
});

/** Unauthenticated exact-slug projection of one current published product. */
export const getPublishedBySlug = query({
	args: { siteUrl: v.string(), slug: v.string() },
	returns: v.union(catalogProductGraphV2PublicValidator, v.null()),
	handler: async (ctx, args) =>
		await getPublishedCatalogProductGraphV2BySlug(ctx, args),
});

/** Authenticated Editor-only detail read; public reads are separately bounded. */
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
