import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
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
	toEditorRevision,
} from "./helpers/portfolioData";
import {
	PORTFOLIO_GALLERY_MAX,
	portfolioGalleryDraftValidator,
	serializePortfolioGalleryDraft,
	toPublishedPortfolioGallery,
	validatePortfolioGalleryDraft,
} from "./helpers/portfolioValidators";

export const saveDraft = mutation({
	args: {
		siteUrl: v.string(),
		galleryId: v.optional(v.id("portfolioGalleries")),
		expectedDraftRevisionId: v.optional(v.id("portfolioGalleryRevisions")),
		draft: portfolioGalleryDraftValidator,
	},
	handler: async (ctx, args) => {
		const { identity, client } = await requireSiteAdmin(ctx, args.siteUrl);
		validatePortfolioGalleryDraft(args.draft);
		const checksum = await checksumPortfolioDraft(serializePortfolioGalleryDraft(args.draft));
		const actor = identity.tokenIdentifier;
		const now = Date.now();
		let gallery: Doc<"portfolioGalleries"> | null = null;

		if (args.galleryId) {
			gallery = await ctx.db.get(args.galleryId);
			if (!gallery || gallery.siteUrl !== client.siteUrl) {
				throw new Error("Portfolio gallery not found");
			}
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
			placementCount: args.draft.placements.length,
			checksum,
			source: "admin",
			createdAt: now,
			createdBy: actor,
		});
		for (const [order, placement] of args.draft.placements.entries()) {
			await ctx.db.insert("portfolioPlacements", {
				siteUrl: client.siteUrl,
				galleryId: gallery._id,
				revisionId,
				assetId: placement.assetId,
				placementKey: placement.key,
				order,
				altText: placement.altText,
				decorative: placement.decorative,
				caption: placement.caption,
				focalPoint: placement.focalPoint,
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
		assertExpectedDraft(gallery, args.draftRevisionId);
		const revision = await getPortfolioRevision(ctx, args.draftRevisionId);
		if (!revision) throw new Error("Portfolio draft revision not found");
		assertRevisionOwnership(revision, gallery);
		const placements = await getPortfolioPlacements(ctx, revision._id);
		const draft = portfolioDraftFromRevision(revision, placements);
		toPublishedPortfolioGallery(draft);
		await requireReadyPortfolioAssets(ctx, gallery.siteUrl, draft.placements);
		if (gallery.publishedRevisionId === revision._id) {
			return { galleryId: gallery._id, revisionId: revision._id };
		}

		const identity = await ctx.auth.getUserIdentity();
		if (!identity) throw new Error("Not authenticated");
		const now = Date.now();
		await ctx.db.patch(gallery._id, {
			publishedRevisionId: revision._id,
			isPublished: true,
			publishedAt: now,
			publishedBy: identity.tokenIdentifier,
			updatedAt: now,
			updatedBy: identity.tokenIdentifier,
		});
		return { galleryId: gallery._id, revisionId: revision._id };
	},
});

export const getEditorState = query({
	args: { galleryId: v.id("portfolioGalleries") },
	handler: async (ctx, { galleryId }) => {
		const gallery = await requireDocumentSiteAdmin(ctx, "portfolioGalleries", galleryId);
		const [draft, published] = await Promise.all([
			loadEditorRevision(ctx, gallery, gallery.draftRevisionId),
			loadEditorRevision(ctx, gallery, gallery.publishedRevisionId),
		]);
		return {
			galleryId: gallery._id,
			slug: gallery.slug,
			portfolioOrder: gallery.portfolioOrder,
			isPublished: gallery.isPublished,
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
		return await Promise.all(galleries.map(async (gallery) => {
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
		const galleries = await ctx.db
			.query("portfolioGalleries")
			.withIndex("by_siteUrl_and_portfolioOrder", (q) => q.eq("siteUrl", client.siteUrl))
			.take(PORTFOLIO_GALLERY_MAX + 1);
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
			.withIndex("by_siteUrl_and_isPublished_and_portfolioOrder", (q) =>
				q.eq("siteUrl", siteUrl).eq("isPublished", true),
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

export const getPublishedBySlug = query({
	args: { siteUrl: v.string(), slug: v.string() },
	handler: async (ctx, { siteUrl, slug }) => {
		const gallery = await ctx.db
			.query("portfolioGalleries")
			.withIndex("by_siteUrl_and_slug", (q) => q.eq("siteUrl", siteUrl).eq("slug", slug))
			.unique();
		if (!gallery?.isPublished || !gallery.publishedRevisionId) return null;
		const revision = await getPortfolioRevision(ctx, gallery.publishedRevisionId);
		if (!revision) throw new Error("Published portfolio revision not found");
		assertRevisionOwnership(revision, gallery);
		const placements = await getPortfolioPlacements(ctx, revision._id);
		const draft = portfolioDraftFromRevision(revision, placements);
		const published = toPublishedPortfolioGallery(draft);
		const assets = await requireReadyPortfolioAssets(ctx, siteUrl, draft.placements);

		return {
			galleryId: gallery._id,
			revisionId: revision._id,
			title: published.title,
			description: published.description,
			slug: published.slug,
			portfolioOrder: gallery.portfolioOrder,
			publishedAt: gallery.publishedAt ?? revision.createdAt,
			placements: published.placements.map((placement, order) => {
				const asset = assets.get(placement.assetId);
				if (!asset) throw new Error("Published portfolio asset not found");
				return {
					key: placement.key,
					order,
					altText: placement.altText,
					decorative: placement.decorative,
					caption: placement.caption,
					focalPoint: placement.focalPoint ?? null,
					asset: {
						assetId: asset.assetId,
						source: {
							width: asset.source.width,
							height: asset.source.height,
						},
						derivatives: asset.derivatives,
					},
				};
			}),
		};
	},
});
