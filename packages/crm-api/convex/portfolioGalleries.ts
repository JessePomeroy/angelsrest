import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx, query } from "./_generated/server";
import { requireDocumentSiteAdmin, requireSiteAdmin } from "./authHelpers";
import {
	assertExpectedDraft,
	assertRevisionOwnership,
	checksumPortfolioDraft,
	getPortfolioPlacements,
	getPortfolioRevision,
	loadEditorRevision,
	portfolioDraftFromRevision,
	requireReadyPortfolioAssets,
	requireReadyPortfolioSeoAsset,
	toEditorRevision,
	loadPublicPortfolioGallery,
} from "./helpers/portfolioData";
import { isInitialSanityPortfolioImport } from "./helpers/portfolioMigrationStore";
import {
	PORTFOLIO_GALLERY_MAX,
	PORTFOLIO_PUBLIC_PLACEMENT_MAX,
	portfolioGalleryDraftValidator,
	serializePortfolioGalleryDraft,
	toPublishedPortfolioGallery,
	validatePortfolioGalleryDraft,
} from "./helpers/portfolioValidators";

const REMOVE_BATCH_SIZE = 64;

function assertGalleryActive(gallery: Doc<"portfolioGalleries">) {
	if (gallery.deletionRequestedAt !== undefined) {
		throw new Error("Portfolio gallery is being deleted");
	}
}

async function requirePortfolioEditorUnlocked(ctx: MutationCtx, siteUrl: string) {
	const galleries = (await ctx.db
		.query("portfolioGalleries")
		.withIndex("by_siteUrl_and_portfolioOrder", (q) => q.eq("siteUrl", siteUrl))
		.take(PORTFOLIO_GALLERY_MAX + 1))
		.filter((gallery) => gallery.deletionRequestedAt === undefined);
	if (galleries.length > PORTFOLIO_GALLERY_MAX) {
		throw new Error("Portfolio gallery limit exceeded");
	}
	if (galleries.some(isInitialSanityPortfolioImport)) {
		throw new Error("Imported Portfolio requires fixed initial publication");
	}
}

export const saveDraft = mutation({
	args: {
		siteUrl: v.string(),
		galleryId: v.optional(v.id("portfolioGalleries")),
		expectedDraftRevisionId: v.optional(v.id("portfolioGalleryRevisions")),
		draft: portfolioGalleryDraftValidator,
	},
	handler: async (ctx, args) => {
		const { identity, client } = await requireSiteAdmin(ctx, args.siteUrl);
		await requirePortfolioEditorUnlocked(ctx, client.siteUrl);
		validatePortfolioGalleryDraft(args.draft);
		const checksum = await checksumPortfolioDraft(serializePortfolioGalleryDraft(args.draft));
		const actor = identity.tokenIdentifier;
		const now = Date.now();
		let gallery: Doc<"portfolioGalleries"> | null = null;
		let retainedRevision: Doc<"portfolioGalleryRevisions"> | null = null;
		let retainedPlacements = new Map<string, Doc<"portfolioPlacements">>();

		if (args.galleryId) {
			gallery = await ctx.db.get(args.galleryId);
			if (!gallery || gallery.siteUrl !== client.siteUrl) {
				throw new Error("Portfolio gallery not found");
			}
			assertGalleryActive(gallery);
			const currentDraft = await getPortfolioRevision(ctx, gallery.draftRevisionId);
			if (currentDraft) {
				assertRevisionOwnership(currentDraft, gallery);
				if (currentDraft.checksum === checksum) {
					return { galleryId: gallery._id, revisionId: currentDraft._id };
				}
			}
			assertExpectedDraft(gallery, args.expectedDraftRevisionId);
			if (gallery.isPublished && gallery.slug !== args.draft.slug) {
				throw new Error("Published gallery slug changes require redirect support");
			}
			retainedRevision = currentDraft
				?? await getPortfolioRevision(ctx, gallery.publishedRevisionId);
			if (retainedRevision) {
				assertRevisionOwnership(retainedRevision, gallery);
				retainedPlacements = new Map(
					(await getPortfolioPlacements(ctx, retainedRevision._id)).map((placement) => [
						`${placement.placementKey}:${placement.assetId}`,
						placement,
					]),
				);
			}
		} else if (args.expectedDraftRevisionId !== undefined) {
			throw new Error("Portfolio draft conflict: gallery does not exist");
		}

		const slugOwner = await ctx.db
			.query("portfolioGalleries")
			.withIndex("by_siteUrl_and_slug", (q) =>
				q.eq("siteUrl", client.siteUrl).eq("slug", args.draft.slug),
			)
			.unique();
		if (slugOwner && slugOwner._id !== gallery?._id) {
			throw new Error(`Portfolio gallery slug "${args.draft.slug}" already exists`);
		}
		await requireReadyPortfolioAssets(ctx, client.siteUrl, args.draft.placements);

		if (!gallery) {
			const siteGalleries = await ctx.db
				.query("portfolioGalleries")
				.withIndex("by_siteUrl_and_portfolioOrder", (q) => q.eq("siteUrl", client.siteUrl))
				.order("desc")
				.take(PORTFOLIO_GALLERY_MAX + 1);
			if (siteGalleries.length >= PORTFOLIO_GALLERY_MAX) {
				throw new Error(`A site cannot exceed ${PORTFOLIO_GALLERY_MAX} portfolio galleries`);
			}
			const galleryId = await ctx.db.insert("portfolioGalleries", {
				siteUrl: client.siteUrl,
				slug: args.draft.slug,
				portfolioOrder: (siteGalleries[0]?.portfolioOrder ?? -1) + 1,
				isPublished: false,
				isVisible: true,
				createdAt: now,
				createdBy: actor,
				updatedAt: now,
				updatedBy: actor,
			});
			gallery = await ctx.db.get(galleryId);
			if (!gallery) throw new Error("Portfolio gallery creation failed");
		}

		const revisionId = await ctx.db.insert("portfolioGalleryRevisions", {
			siteUrl: client.siteUrl,
			galleryId: gallery._id,
			schemaVersion: 1,
			title: args.draft.title,
			description: args.draft.description,
			slug: args.draft.slug,
			seoDescription: retainedRevision?.seoDescription,
			seoOgImageAssetId: retainedRevision?.seoOgImageAssetId,
			seoOgSourceAssetRef: retainedRevision?.seoOgSourceAssetRef,
			placementCount: args.draft.placements.length,
			checksum,
			source: "admin",
			createdAt: now,
			createdBy: actor,
		});
		await requireReadyPortfolioSeoAsset(
			ctx,
			client.siteUrl,
			retainedRevision?.seoOgImageAssetId,
		);
		for (const [order, placement] of args.draft.placements.entries()) {
			const retained = retainedPlacements.get(`${placement.key}:${placement.assetId}`);
			await ctx.db.insert("portfolioPlacements", {
				siteUrl: client.siteUrl,
				galleryId: gallery._id,
				revisionId,
				assetId: placement.assetId,
				placementKey: placement.key,
				order,
				altText: placement.altText,
				caption: placement.caption,
				focalPoint: placement.focalPoint,
				sourceAssetRef: retained?.sourceAssetRef,
				sourceAltAbsent: retained?.sourceAltAbsent,
				sourceCropCanonical: retained?.sourceCropCanonical,
				sourceHotspotCanonical: retained?.sourceHotspotCanonical,
			});
		}
		await ctx.db.patch(gallery._id, {
			slug: args.draft.slug,
			draftRevisionId: revisionId,
			updatedAt: now,
			updatedBy: actor,
		});
		return { galleryId: gallery._id, revisionId };
	},
});

export const publish = mutation({
	args: {
		galleryId: v.id("portfolioGalleries"),
		draftRevisionId: v.id("portfolioGalleryRevisions"),
	},
	handler: async (ctx, args) => {
		const gallery = await requireDocumentSiteAdmin(ctx, "portfolioGalleries", args.galleryId);
		assertGalleryActive(gallery);
		await requirePortfolioEditorUnlocked(ctx, gallery.siteUrl);
		assertExpectedDraft(gallery, args.draftRevisionId);
		const revision = await getPortfolioRevision(ctx, args.draftRevisionId);
		if (!revision) throw new Error("Portfolio draft revision not found");
		assertRevisionOwnership(revision, gallery);
		const placements = await getPortfolioPlacements(ctx, revision._id);
		const draft = portfolioDraftFromRevision(revision, placements);
		toPublishedPortfolioGallery(draft);
		await requireReadyPortfolioAssets(ctx, gallery.siteUrl, draft.placements);
		await requireReadyPortfolioSeoAsset(ctx, gallery.siteUrl, revision.seoOgImageAssetId);
		const publishedGalleries = await ctx.db
			.query("portfolioGalleries")
			.withIndex("by_siteUrl_and_isPublished_and_portfolioOrder", (q) =>
				q.eq("siteUrl", gallery.siteUrl).eq("isPublished", true),
			)
			.take(PORTFOLIO_GALLERY_MAX);
		const otherPublishedGalleries = publishedGalleries.filter(
			(publishedGallery) => publishedGallery._id !== gallery._id,
		);
		const publishedRevisions = await Promise.all(
			otherPublishedGalleries.map((publishedGallery) =>
				getPortfolioRevision(ctx, publishedGallery.publishedRevisionId)
			),
		);
		const publishedPlacementCount = publishedRevisions.reduce((total, publishedRevision, index) => {
			if (!publishedRevision) throw new Error("Published portfolio revision not found");
			assertRevisionOwnership(publishedRevision, otherPublishedGalleries[index]);
			return total + publishedRevision.placementCount;
		}, revision.placementCount);
		if (publishedPlacementCount > PORTFOLIO_PUBLIC_PLACEMENT_MAX) {
			throw new Error(
				`A published portfolio cannot exceed ${PORTFOLIO_PUBLIC_PLACEMENT_MAX} images`,
			);
		}
		if (gallery.publishedRevisionId === revision._id) {
			return { galleryId: gallery._id, revisionId: revision._id };
		}

		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		const now = Date.now();
		await ctx.db.patch(gallery._id, {
			publishedRevisionId: revision._id,
			isPublished: true,
			isVisible: gallery.isVisible ?? true,
			publishedAt: now,
			publishedBy: identity.tokenIdentifier,
			updatedAt: now,
			updatedBy: identity.tokenIdentifier,
		});
		return { galleryId: gallery._id, revisionId: revision._id };
	},
});

export const setVisibility = mutation({
	args: {
		galleryId: v.id("portfolioGalleries"),
		isVisible: v.boolean(),
	},
	handler: async (ctx, { galleryId, isVisible }) => {
		const gallery = await requireDocumentSiteAdmin(ctx, "portfolioGalleries", galleryId);
		assertGalleryActive(gallery);
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		await ctx.db.patch(galleryId, {
			isVisible,
			updatedAt: Date.now(),
			updatedBy: identity.tokenIdentifier,
		});
		return { isVisible };
	},
});

export const remove = mutation({
	args: { galleryId: v.id("portfolioGalleries") },
	handler: async (ctx, { galleryId }) => {
		const gallery = await requireDocumentSiteAdmin(ctx, "portfolioGalleries", galleryId);
		if (gallery.deletionRequestedAt === undefined) {
			await ctx.db.patch(galleryId, {
				isPublished: false,
				isVisible: false,
				deletionRequestedAt: Date.now(),
			});
		}
		await ctx.runMutation(internal.portfolioGalleries._removeBatch, { galleryId });
		return null;
	},
});

export const _removeBatch = internalMutation({
	args: { galleryId: v.id("portfolioGalleries") },
	handler: async (ctx, { galleryId }) => {
		const gallery = await ctx.db.get(galleryId);
		if (!gallery?.deletionRequestedAt) return;
		let remaining = REMOVE_BATCH_SIZE;
		const placements = await ctx.db
			.query("portfolioPlacements")
			.withIndex("by_galleryId_and_revisionId", (q) => q.eq("galleryId", galleryId))
			.take(remaining);
		for (const placement of placements) await ctx.db.delete(placement._id);
		remaining -= placements.length;
		if (remaining > 0) {
			const revisions = await ctx.db
				.query("portfolioGalleryRevisions")
				.withIndex("by_galleryId_and_createdAt", (q) => q.eq("galleryId", galleryId))
				.take(remaining);
			for (const revision of revisions) await ctx.db.delete(revision._id);
			remaining -= revisions.length;
		}
		if (remaining > 0) {
			await ctx.db.delete(galleryId);
			return;
		}
		await ctx.scheduler.runAfter(0, internal.portfolioGalleries._removeBatch, { galleryId });
	},
});

export const getEditorState = query({
	args: { galleryId: v.id("portfolioGalleries") },
	handler: async (ctx, { galleryId }) => {
		const gallery = await requireDocumentSiteAdmin(ctx, "portfolioGalleries", galleryId);
		assertGalleryActive(gallery);
		const [draft, published] = await Promise.all([
			loadEditorRevision(ctx, gallery, gallery.draftRevisionId),
			loadEditorRevision(ctx, gallery, gallery.publishedRevisionId),
		]);
		return {
			galleryId: gallery._id,
			slug: gallery.slug,
			portfolioOrder: gallery.portfolioOrder,
			isPublished: gallery.isPublished,
			isVisible: gallery.isVisible ?? true,
			draft,
			published,
			updatedAt: gallery.updatedAt,
			publishedAt: gallery.publishedAt ?? null,
		};
	},
});

export const listForEditor = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const { client } = await requireSiteAdmin(ctx, siteUrl);
		const galleries = await ctx.db
			.query("portfolioGalleries")
			.withIndex("by_siteUrl_and_portfolioOrder", (q) => q.eq("siteUrl", client.siteUrl))
			.take(PORTFOLIO_GALLERY_MAX + 1);
		if (galleries.length > PORTFOLIO_GALLERY_MAX) {
			throw new Error("Portfolio gallery limit exceeded");
		}
		return await Promise.all(galleries.filter((gallery) =>
			gallery.deletionRequestedAt === undefined
		).map(async (gallery) => {
			const [draft, published] = await Promise.all([
				getPortfolioRevision(ctx, gallery.draftRevisionId),
				getPortfolioRevision(ctx, gallery.publishedRevisionId),
			]);
			if (draft) assertRevisionOwnership(draft, gallery);
			if (published) assertRevisionOwnership(published, gallery);
			return {
				galleryId: gallery._id,
				slug: gallery.slug,
				portfolioOrder: gallery.portfolioOrder,
				isPublished: gallery.isPublished,
				isVisible: gallery.isVisible ?? true,
				draft: toEditorRevision(draft),
				published: toEditorRevision(published),
				updatedAt: gallery.updatedAt,
			};
		}));
	},
});

export const reorder = mutation({
	args: {
		siteUrl: v.string(),
		galleryIds: v.array(v.id("portfolioGalleries")),
	},
	handler: async (ctx, { siteUrl, galleryIds }) => {
		const { identity, client } = await requireSiteAdmin(ctx, siteUrl);
		const galleries = (await ctx.db
			.query("portfolioGalleries")
			.withIndex("by_siteUrl_and_portfolioOrder", (q) => q.eq("siteUrl", client.siteUrl))
			.take(PORTFOLIO_GALLERY_MAX + 1))
			.filter((gallery) => gallery.deletionRequestedAt === undefined);
		if (galleries.some(isInitialSanityPortfolioImport)) {
			throw new Error("Imported Portfolio requires fixed initial publication");
		}
		if (
			galleries.length > PORTFOLIO_GALLERY_MAX
			|| galleryIds.length !== galleries.length
			|| new Set(galleryIds).size !== galleryIds.length
			|| galleries.some((gallery) => !galleryIds.includes(gallery._id))
		) throw new Error("Portfolio order must include every site gallery exactly once");

		const now = Date.now();
		for (const [portfolioOrder, galleryId] of galleryIds.entries()) {
			await ctx.db.patch(galleryId, {
				portfolioOrder,
				updatedAt: now,
				updatedBy: identity.tokenIdentifier,
			});
		}
		return null;
	},
});

export const listPublished = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const galleries = await ctx.db
			.query("portfolioGalleries")
			.withIndex("by_siteUrl_and_isPublished_and_isVisible_and_portfolioOrder", (q) =>
				q.eq("siteUrl", siteUrl).eq("isPublished", true).eq("isVisible", true),
			)
			.take(PORTFOLIO_GALLERY_MAX);
		return await Promise.all(galleries.map(async (gallery) => {
			const revision = await getPortfolioRevision(ctx, gallery.publishedRevisionId);
			if (!revision) throw new Error("Published portfolio revision not found");
			assertRevisionOwnership(revision, gallery);
			const title = revision.title?.trim() ?? "";
			if (!title) throw new Error("Published portfolio title is missing");
			return {
				galleryId: gallery._id,
				revisionId: revision._id,
				title,
				description: revision.description?.trim() || null,
				slug: revision.slug,
				portfolioOrder: gallery.portfolioOrder,
				placementCount: revision.placementCount,
				publishedAt: gallery.publishedAt ?? revision.createdAt,
			};
		}));
	},
});

export const listPublishedWithPlacements = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		const galleries = await ctx.db
			.query("portfolioGalleries")
			.withIndex("by_siteUrl_and_isPublished_and_isVisible_and_portfolioOrder", (q) =>
				q.eq("siteUrl", siteUrl).eq("isPublished", true).eq("isVisible", true),
			)
			.take(PORTFOLIO_GALLERY_MAX);
		const revisions = await Promise.all(
			galleries.map((gallery) => getPortfolioRevision(ctx, gallery.publishedRevisionId)),
		);
		const placementCount = revisions.reduce((total, revision, index) => {
			if (!revision) throw new Error("Published portfolio revision not found");
			assertRevisionOwnership(revision, galleries[index]);
			return total + revision.placementCount;
		}, 0);
		if (placementCount > PORTFOLIO_PUBLIC_PLACEMENT_MAX) {
			throw new Error("Published portfolio image limit exceeded");
		}
		return await Promise.all(galleries.map(async (gallery, index) => {
			const revision = revisions[index];
			if (!revision) throw new Error("Published portfolio revision not found");
			return await loadPublicPortfolioGallery(ctx, gallery, revision);
		}));
	},
});

export const getPublishedBySlug = query({
	args: { siteUrl: v.string(), slug: v.string() },
	handler: async (ctx, { siteUrl, slug }) => {
		const gallery = await ctx.db
			.query("portfolioGalleries")
			.withIndex("by_siteUrl_and_slug", (q) => q.eq("siteUrl", siteUrl).eq("slug", slug))
			.unique();
		if (!gallery?.isPublished || gallery.isVisible !== true || !gallery.publishedRevisionId) return null;
		const revision = await getPortfolioRevision(ctx, gallery.publishedRevisionId);
		if (!revision) throw new Error("Published portfolio revision not found");
		return await loadPublicPortfolioGallery(ctx, gallery, revision);
	},
});
