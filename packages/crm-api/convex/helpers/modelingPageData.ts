import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type {
	ModelingImagePlacement,
	PublishedModelingPage,
} from "./modelingPageValidators";

type ModelingPageCtx = QueryCtx | MutationCtx;

export async function requireReadyModelingAssets(
	ctx: ModelingPageCtx,
	siteUrl: string,
	galleries: Array<{ images?: ModelingImagePlacement[] }>,
	seoImageAssetId?: Id<"mediaAssets">,
) {
	const ids = [
		...new Set([
			...galleries.flatMap((gallery) =>
				(gallery.images ?? []).map((image) => image.assetId)
			),
			...(seoImageAssetId ? [seoImageAssetId] : []),
		]),
	];
	const assets = await Promise.all(ids.map((id) => ctx.db.get(id)));
	const assetMap = new Map<Id<"mediaAssets">, Doc<"mediaAssets">>();
	for (const [index, asset] of assets.entries()) {
		if (!asset || asset.siteUrl !== siteUrl || asset.status !== "ready") {
			throw new Error(
				"Modeling content requires ready media assets from the same site",
			);
		}
		assetMap.set(ids[index], asset);
	}
	return assetMap;
}

export async function projectPublishedModelingPage(
	ctx: QueryCtx,
	siteUrl: string,
	state: {
		revisionId: Id<"contentRevisions">;
		publishedAt: number;
		payload: PublishedModelingPage;
	},
) {
	const assets = await requireReadyModelingAssets(
		ctx,
		siteUrl,
		state.payload.galleries,
		state.payload.seoImageAssetId,
	);
	const projectAsset = (assetId: Id<"mediaAssets">) => {
		const asset = assets.get(assetId);
		if (!asset) throw new Error("Published Modeling asset not found");
		return {
			assetId: asset.assetId,
			source: {
				width: asset.source.width,
				height: asset.source.height,
			},
			derivatives: asset.derivatives,
		};
	};
	const { seoImageAssetId, ...content } = state.payload;
	return {
		...state,
		payload: {
			...content,
			seoImage: seoImageAssetId ? projectAsset(seoImageAssetId) : undefined,
			galleries: state.payload.galleries.map((gallery, order) => ({
				key: gallery.key,
				order,
				title: gallery.title,
				slug: gallery.slug,
				description: gallery.description,
				images: gallery.images.map((image, imageOrder) => ({
					key: image.key,
					order: imageOrder,
					altText: image.altText,
					decorative: image.decorative,
					asset: projectAsset(image.assetId),
				})),
			})),
		},
	};
}
