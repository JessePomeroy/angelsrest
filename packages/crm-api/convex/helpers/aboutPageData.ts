import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type {
	AboutPortraitPlacement,
	PublishedAboutPage,
} from "./aboutPageValidators";

type AboutPageCtx = QueryCtx | MutationCtx;

export async function requireReadyAboutAssets(
	ctx: AboutPageCtx,
	siteUrl: string,
	portraits: AboutPortraitPlacement[],
	seoImageAssetId?: Id<"mediaAssets">,
) {
	const ids = [
		...new Set([
			...portraits.map((portrait) => portrait.assetId),
			...(seoImageAssetId ? [seoImageAssetId] : []),
		]),
	];
	const assets = await Promise.all(ids.map((id) => ctx.db.get(id)));
	const assetMap = new Map<Id<"mediaAssets">, Doc<"mediaAssets">>();
	for (const [index, asset] of assets.entries()) {
		if (!asset || asset.siteUrl !== siteUrl || asset.status !== "ready") {
			throw new Error("About portraits require ready media assets from the same site");
		}
		assetMap.set(ids[index], asset);
	}
	return assetMap;
}

export async function projectPublishedAboutPage(
	ctx: QueryCtx,
	siteUrl: string,
	state: {
		revisionId: Id<"contentRevisions">;
		publishedAt: number;
		payload: PublishedAboutPage;
	},
) {
	const assets = await requireReadyAboutAssets(
		ctx,
		siteUrl,
		state.payload.portraits,
		state.payload.seoImageAssetId,
	);
	const projectAsset = (assetId: Id<"mediaAssets">) => {
		const asset = assets.get(assetId);
		if (!asset) throw new Error("Published About asset not found");
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
			portraits: state.payload.portraits.map((portrait, order) => {
				return {
					key: portrait.key,
					order,
					altText: portrait.altText,
					decorative: portrait.decorative,
					asset: projectAsset(portrait.assetId),
				};
			}),
		},
	};
}
