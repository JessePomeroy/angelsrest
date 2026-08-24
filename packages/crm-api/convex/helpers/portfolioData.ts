import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
	PORTFOLIO_PLACEMENT_MAX,
	type PortfolioGalleryDraft,
	toPublishedImportedPortfolioGallery,
	toPublishedPortfolioGallery,
} from "./portfolioValidators";

type PortfolioCtx = QueryCtx | MutationCtx;

export async function checksumPortfolioDraft(serialized: string) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(serialized),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export function assertRevisionOwnership(
	revision: Doc<"portfolioGalleryRevisions">,
	gallery: Doc<"portfolioGalleries">,
) {
	if (revision.galleryId !== gallery._id || revision.siteUrl !== gallery.siteUrl) {
		throw new Error("Portfolio revision ownership mismatch");
	}
}

export function assertExpectedDraft(
	gallery: Doc<"portfolioGalleries">,
	expectedDraftRevisionId: Id<"portfolioGalleryRevisions"> | undefined,
) {
	if (gallery.draftRevisionId !== expectedDraftRevisionId) {
		throw new Error("Portfolio draft conflict: reload before saving or publishing");
	}
}

export async function getPortfolioRevision(
	ctx: PortfolioCtx,
	id: Id<"portfolioGalleryRevisions"> | undefined,
) {
	return id ? await ctx.db.get(id) : null;
}

export async function getPortfolioPlacements(
	ctx: PortfolioCtx,
	revisionId: Id<"portfolioGalleryRevisions">,
) {
	const placements = await ctx.db
		.query("portfolioPlacements")
		.withIndex("by_revisionId_and_order", (q) => q.eq("revisionId", revisionId))
		.take(PORTFOLIO_PLACEMENT_MAX + 1);
	if (placements.length > PORTFOLIO_PLACEMENT_MAX) {
		throw new Error("Portfolio placement limit exceeded");
	}
	return placements;
}

export function portfolioDraftFromRevision(
	revision: Doc<"portfolioGalleryRevisions">,
	placements: Doc<"portfolioPlacements">[],
): PortfolioGalleryDraft {
	return {
		title: revision.title,
		description: revision.description,
		slug: revision.slug,
		placements: placements.map((placement) => ({
			key: placement.placementKey,
			assetId: placement.assetId,
			altText: placement.altText,
			caption: placement.caption,
			focalPoint: placement.focalPoint,
		})),
	};
}

export async function requireReadyPortfolioAssets(
	ctx: PortfolioCtx,
	siteUrl: string,
	placements: PortfolioGalleryDraft["placements"],
) {
	const ids = [...new Set(placements.map((placement) => placement.assetId))];
	const assets = await Promise.all(ids.map((id) => ctx.db.get(id)));
	const assetMap = new Map<Id<"mediaAssets">, Doc<"mediaAssets">>();
	for (const [index, asset] of assets.entries()) {
		if (!asset || asset.siteUrl !== siteUrl || asset.status !== "ready") {
			throw new Error("Portfolio placements require ready media assets from the same site");
		}
		assetMap.set(ids[index], asset);
	}
	return assetMap;
}

export async function requireReadyPortfolioSeoAsset(
	ctx: PortfolioCtx,
	siteUrl: string,
	assetId: Id<"mediaAssets"> | undefined,
) {
	if (!assetId) return null;
	const asset = await ctx.db.get(assetId);
	if (
		!asset
		|| asset.siteUrl !== siteUrl
		|| asset.intent !== "web"
		|| asset.status !== "ready"
	) throw new Error("Portfolio SEO image requires a ready web asset from the same site");
	return asset;
}

export function toEditorRevision(
	revision: Doc<"portfolioGalleryRevisions"> | null,
	placements: Doc<"portfolioPlacements">[] = [],
) {
	if (!revision) return null;
	return {
		revisionId: revision._id,
		title: revision.title ?? null,
		description: revision.description ?? null,
		slug: revision.slug,
		placementCount: revision.placementCount,
		checksum: revision.checksum,
		createdAt: revision.createdAt,
		placements: placements.map((placement) => ({
			key: placement.placementKey,
			assetId: placement.assetId,
			order: placement.order,
			altText: placement.altText ?? null,
			caption: placement.caption ?? null,
			focalPoint: placement.focalPoint ?? null,
		})),
	};
}

export async function loadEditorRevision(
	ctx: QueryCtx,
	gallery: Doc<"portfolioGalleries">,
	id: Id<"portfolioGalleryRevisions"> | undefined,
) {
	const revision = await getPortfolioRevision(ctx, id);
	if (!revision) return null;
	assertRevisionOwnership(revision, gallery);
	return toEditorRevision(
		revision,
		await getPortfolioPlacements(ctx, revision._id),
	);
}

export async function loadPublicPortfolioGallery(
	ctx: QueryCtx,
	gallery: Doc<"portfolioGalleries">,
	revision: Doc<"portfolioGalleryRevisions">,
) {
	assertRevisionOwnership(revision, gallery);
	const placements = await getPortfolioPlacements(ctx, revision._id);
	const draft = portfolioDraftFromRevision(revision, placements);
	const legacyMissingAltKeys = new Set(
		placements
			.filter((placement) => placement.sourceAltAbsent === true)
			.map((placement) => placement.placementKey),
	);
	const published = revision.source === "admin"
		? toPublishedPortfolioGallery(draft)
		: toPublishedImportedPortfolioGallery(draft, legacyMissingAltKeys);
	const assets = await requireReadyPortfolioAssets(ctx, gallery.siteUrl, draft.placements);
	const seoAsset = await requireReadyPortfolioSeoAsset(
		ctx,
		gallery.siteUrl,
		revision.seoOgImageAssetId,
	);

	return {
		galleryId: gallery._id,
		revisionId: revision._id,
		sourceDocumentId: gallery.sourceDocumentId ?? null,
		sourceDocumentRevision: revision.sourceDocumentRevision ?? null,
		title: published.title,
		description: published.description,
		slug: published.slug,
		portfolioOrder: gallery.portfolioOrder,
		isVisible: gallery.isVisible === true,
		publishedAt: gallery.publishedAt ?? revision.createdAt,
		seo: {
			description: revision.seoDescription?.trim() || null,
			ogImage: seoAsset
				? {
						assetId: seoAsset.assetId,
						sourceAssetRef: revision.seoOgSourceAssetRef ?? null,
						source: {
							width: seoAsset.source.width,
							height: seoAsset.source.height,
							sha256: seoAsset.source.sha256 ?? null,
						},
						derivatives: seoAsset.derivatives,
					}
				: null,
		},
		placements: published.placements.map((placement, order) => {
			const asset = assets.get(placement.assetId);
			const storedPlacement = placements[order];
			if (!asset) throw new Error("Published portfolio asset not found");
			if (
				!storedPlacement
				|| storedPlacement.placementKey !== placement.key
				|| storedPlacement.assetId !== placement.assetId
			) throw new Error("Published portfolio placement projection mismatch");
			return {
				key: placement.key,
				order,
				altText: placement.altText,
				caption: placement.caption,
				focalPoint: placement.focalPoint ?? null,
				sourceAssetRef: storedPlacement.sourceAssetRef ?? null,
				sourceCropCanonical: storedPlacement.sourceCropCanonical ?? null,
				sourceHotspotCanonical: storedPlacement.sourceHotspotCanonical ?? null,
				asset: {
					assetId: asset.assetId,
					source: {
						width: asset.source.width,
						height: asset.source.height,
						sha256: asset.source.sha256 ?? null,
					},
					derivatives: asset.derivatives,
				},
			};
		}),
	};
}
