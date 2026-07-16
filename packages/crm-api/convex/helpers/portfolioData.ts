import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
	PORTFOLIO_PLACEMENT_MAX,
	type PortfolioGalleryDraft,
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
			decorative: placement.decorative,
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
			decorative: placement.decorative,
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
